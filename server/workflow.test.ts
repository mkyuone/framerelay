import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createEditState, FILTER_PRESETS, filterFromPreset } from '@image-ultra/react';
import { createApp } from './app.ts';
import type { EventConfig, Ticket } from '../shared/types.ts';

let root: string,
  app: Awaited<ReturnType<typeof createApp>>['app'],
  store: Awaited<ReturnType<typeof createApp>>['store'],
  operatorCookie: string,
  staffCookie: string,
  event: EventConfig;
const setupPasscode = 'test-operator-passcode',
  staffPasscode = 'test-event-passcode',
  device = randomUUID();
const settings = {
  eventName: 'Test event',
  primaryColor: '#101D40',
  accentColor: '#1162D4',
  footerText: 'Welcome',
  selectionLimit: 1,
  printEnabled: true,
  digitalEnabled: true,
  printWidth: 6,
  printHeight: 4,
  copies: 1,
  staffPasscode,
};
const headers = () => ({ cookie: operatorCookie, 'x-station-id': device });
async function call(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: unknown,
  customHeaders = headers(),
) {
  return app.inject({
    method,
    url: `/api${url}`,
    headers: customHeaders,
    payload: payload as never,
  });
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'framerelay-test-'));
  ({ app, store } = await createApp({ root, setupPasscode, serveClient: false }));
  const login = await call(
    'POST',
    '/login',
    { kind: 'operator', passcode: setupPasscode },
    {} as ReturnType<typeof headers>,
  );
  operatorCookie = `fr_operator=${login.cookies[0].value}`;
  event = (await call('POST', '/events', settings)).json();
  assert.equal((await call('POST', `/events/${event.id}/activate`)).statusCode, 200);
  const staff = await call(
    'POST',
    '/login',
    { kind: 'staff', passcode: staffPasscode },
    {} as ReturnType<typeof headers>,
  );
  staffCookie = `fr_staff=${staff.cookies[0].value}`;
});
afterEach(async () => {
  await app.close();
  const target = resolve(root),
    base = resolve(tmpdir()) + sep;
  assert.ok(target.startsWith(base) && target.includes('framerelay-test-'));
  await rm(target, { recursive: true, force: true });
});
async function newTicket() {
  return (await call('POST', '/tickets', { key: randomUUID() })).json<Ticket>();
}
function multipartImage(buffer: Buffer, name: string, recipe?: unknown) {
  const boundary = `test-${randomUUID()}`,
    parts: Buffer[] = [];
  if (recipe !== undefined)
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="recipe"\r\n\r\n${JSON.stringify(recipe)}\r\n`,
      ),
    );
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    headers: { ...headers(), 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(parts),
  };
}
async function withPhoto() {
  const t = await newTicket();
  await call('POST', `/tickets/${t.id}/start`);
  const buffer = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#4488bb' },
  })
    .jpeg()
    .toBuffer();
  const response = await app.inject({
    method: 'POST',
    url: `/api/tickets/${t.id}/photos`,
    ...multipartImage(buffer, 'camera.jpg'),
  });
  assert.equal(response.statusCode, 200, response.body);
  return { ticket: response.json<Ticket>(), buffer };
}
async function finalTicket() {
  let { ticket, buffer } = await withPhoto();
  await call('POST', `/tickets/${ticket.id}/finish`);
  await call('POST', `/tickets/${ticket.id}/claim`);
  const p = ticket.photos[0];
  await call('PATCH', `/photos/${p.id}`, { chosen: true });
  const result = await app.inject({
    method: 'POST',
    url: `/api/photos/${p.id}/final`,
    ...multipartImage(buffer, 'edited.jpg', createEditState()),
  });
  assert.equal(result.statusCode, 200, result.body);
  ticket = (await call('POST', `/tickets/${ticket.id}/submit`)).json<Ticket>();
  return ticket;
}

test('ticket creation is idempotent and staff cannot change operator settings', async () => {
  const key = randomUUID(),
    first = await call('POST', '/tickets', { key }),
    second = await call('POST', '/tickets', { key });
  assert.equal(first.json().id, second.json().id);
  assert.equal(store.recentTickets(event.id).length, 1);
  const denied = await call('GET', '/events', undefined, {
    cookie: staffCookie,
    'x-station-id': device,
  });
  assert.equal(denied.statusCode, 401);
  assert.equal(
    (await call('POST', '/tickets', { key: randomUUID() }, {} as ReturnType<typeof headers>))
      .statusCode,
    401,
  );
});

test('event names may be blank or omitted and legacy identity fields stay out of the interface', async () => {
  const { eventName: _, ...withoutName } = settings;
  const unnamed = await call('POST', '/events', withoutName);
  assert.equal(unnamed.statusCode, 200, unnamed.body);
  assert.equal(unnamed.json<EventConfig>().eventName, '');
  const blankName = await call('POST', '/events', { ...settings, eventName: '   ' });
  assert.equal(blankName.statusCode, 200, blankName.body);
  assert.equal(blankName.json<EventConfig>().eventName, '');
  store.sql.prepare('UPDATE events SET config = ? WHERE id = ?').run(
    JSON.stringify({
      ...store.config(event.id)!,
      organizationName: 'Legacy organization',
      boothName: 'Legacy booth',
      organizationLogo: null,
      eventLogo: null,
      eventDate: null,
    }),
    event.id,
  );
  const visible = (await call('GET', '/bootstrap')).json().event;
  assert.equal(visible.eventName, event.eventName);
  for (const key of ['organizationName', 'boothName', 'organizationLogo', 'eventLogo', 'eventDate'])
    assert.ok(!(key in visible));
});
test('activation locks settings and old staff authorization cannot access a later event', async () => {
  assert.equal(
    (await call('POST', '/events', { ...settings, id: event.id, eventName: 'Changed' })).statusCode,
    409,
  );
  await call('POST', `/events/${event.id}/close`);
  const second = (
    await call('POST', '/events', { ...settings, eventName: 'Next event' })
  ).json<EventConfig>();
  await call('POST', `/events/${second.id}/activate`);
  assert.equal(
    (
      await call('GET', '/tickets/recent', undefined, {
        cookie: staffCookie,
        'x-station-id': device,
      })
    ).statusCode,
    401,
  );
});
test('duplicate uploads are deduplicated and identifiers survive exclusions', async () => {
  const { ticket, buffer } = await withPhoto(),
    p = ticket.photos[0];
  const second = await app.inject({
    method: 'POST',
    url: `/api/tickets/${ticket.id}/photos`,
    ...multipartImage(buffer, 'different-name.jpg'),
  });
  assert.equal(second.json<Ticket>().photos.length, 1);
  assert.match(p.filename, new RegExp(`^${ticket.code}_01_\\d{8}T\\d{9}Z\\.jpg$`));
  assert.equal(
    (await call('PATCH', `/photos/${p.id}`, { excludedPhotography: true })).statusCode,
    200,
  );
  assert.equal((await call('POST', `/tickets/${ticket.id}/finish`)).statusCode, 409);
  await call('PATCH', `/photos/${p.id}`, { excludedPhotography: false });
  assert.equal((await call('POST', `/tickets/${ticket.id}/finish`)).statusCode, 200);
  assert.equal(store.ticket(ticket.id).photos[0].number, 1);
});
test('selection claim prevents concurrent writes and can expire', async () => {
  const { ticket } = await withPhoto();
  await call('POST', `/tickets/${ticket.id}/finish`);
  await call('POST', `/tickets/${ticket.id}/claim`);
  const rival = { ...headers(), 'x-station-id': randomUUID() };
  assert.equal((await call('POST', `/tickets/${ticket.id}/claim`, {}, rival)).statusCode, 423);
  assert.equal(
    (await call('PATCH', `/photos/${ticket.photos[0].id}`, { chosen: true }, rival)).statusCode,
    423,
  );
  store.sql.prepare('UPDATE sessions SET claim_until = 0 WHERE id = ?').run(ticket.id);
  assert.equal((await call('POST', `/tickets/${ticket.id}/claim`, {}, rival)).statusCode, 200);
});
test('a one-photo choice replaces the previous choice atomically and preserves other customers', async () => {
  const { ticket } = await withPhoto();
  const buffer = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#bb8844' },
  })
    .jpeg()
    .toBuffer();
  const upload = await app.inject({
    method: 'POST',
    url: `/api/tickets/${ticket.id}/photos`,
    ...multipartImage(buffer, 'second.jpg'),
  });
  assert.equal(upload.statusCode, 200, upload.body);
  const second = upload.json<Ticket>().photos[1];
  await call('POST', `/tickets/${ticket.id}/finish`);
  await call('POST', `/tickets/${ticket.id}/claim`);
  const first = ticket.photos[0];
  await call('PATCH', `/photos/${first.id}`, { chosen: true, recipe: createEditState() });
  const other = await withPhoto();
  await call('POST', `/tickets/${other.ticket.id}/finish`);
  await call('POST', `/tickets/${other.ticket.id}/claim`);
  await call('PATCH', `/photos/${other.ticket.photos[0].id}`, { chosen: true });
  await call('PATCH', `/photos/${second.id}`, { excludedSelection: true });
  const rejected = await call('PATCH', `/photos/${second.id}`, { chosen: true });
  assert.equal(rejected.statusCode, 409);
  assert.deepEqual(
    store
      .ticket(ticket.id)
      .photos.filter((p) => p.chosen)
      .map((p) => p.id),
    [first.id],
  );
  await call('PATCH', `/photos/${second.id}`, { excludedSelection: false });
  const switched = await call('PATCH', `/photos/${second.id}`, { chosen: true });
  assert.equal(switched.statusCode, 200, switched.body);
  assert.deepEqual(
    switched
      .json<Ticket>()
      .photos.filter((p) => p.chosen)
      .map((p) => p.id),
    [second.id],
  );
  assert.ok(store.ticket(ticket.id).photos[0].recipe);
  assert.equal(store.ticket(other.ticket.id).photos[0].chosen, true);
});
test('submission publishes only chosen finals, remains idempotent and print completion is explicit', async () => {
  const t = await finalTicket(),
    again = (await call('POST', `/tickets/${t.id}/submit`)).json<Ticket>();
  assert.equal(t.deliveryPath, again.deliveryPath);
  const token = t.deliveryPath!.split('/').at(-1)!;
  const delivery = await call(
    'GET',
    `/delivery/${token}`,
    undefined,
    {} as ReturnType<typeof headers>,
  );
  assert.equal(delivery.statusCode, 200);
  assert.equal(delivery.json().photos.length, 1);
  assert.equal(
    (
      await call(
        'GET',
        `/delivery/${t.identificationToken}`,
        undefined,
        {} as ReturnType<typeof headers>,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        'GET',
        `/photos/${t.photos[0].id}/image`,
        undefined,
        {} as ReturnType<typeof headers>,
      )
    ).statusCode,
    401,
  );
  await call('GET', `/photos/${t.photos[0].id}/download`);
  assert.equal(store.ticket(t.id).photos[0].printed, false);
  assert.equal(
    (await call('PATCH', `/photos/${t.photos[0].id}/print`, { printed: true, revision: 0 }))
      .statusCode,
    200,
  );
  assert.equal(
    (await call('PATCH', `/photos/${t.photos[0].id}/print`, { printed: true, revision: 0 }))
      .statusCode,
    409,
  );
  await call('PATCH', `/events/${event.id}/downloads`, { enabled: false });
  assert.equal(
    (await call('GET', `/delivery/${token}`, undefined, {} as ReturnType<typeof headers>))
      .statusCode,
    410,
  );
});
test('unrendered drafts cannot be submitted and server recipes discard external assets', async () => {
  const { ticket } = await withPhoto();
  await call('POST', `/tickets/${ticket.id}/finish`);
  await call('POST', `/tickets/${ticket.id}/claim`);
  await call('PATCH', `/photos/${ticket.photos[0].id}`, { chosen: true });
  assert.equal((await call('POST', `/tickets/${ticket.id}/submit`)).statusCode, 409);
  const recipe = createEditState();
  recipe.assets = {
    external: {
      kind: 'raster',
      src: 'https://example.invalid/private',
      width: 10,
      height: 10,
      mimeType: 'image/png',
    },
  };
  const response = await call('PATCH', `/photos/${ticket.photos[0].id}`, { recipe });
  assert.deepEqual(
    response.json<Ticket>().photos[0].recipe &&
      JSON.parse(store.rawPhoto(ticket.photos[0].id)!.recipe!).assets,
    {},
  );
});

test('native adjustments, filters and raster stickers survive saving while outside URLs stay blocked', async () => {
  const { ticket } = await withPhoto();
  const id = ticket.photos[0].id;
  await call('POST', `/tickets/${ticket.id}/finish`);
  await call('POST', `/tickets/${ticket.id}/claim`);
  const recipe = createEditState();
  recipe.geometry.flipX = true;
  recipe.geometry.straighten = 3;
  recipe.geometry.perspective.x = 0.05;
  recipe.finetune.highlights = 0.28;
  recipe.levels.black = 0.03;
  recipe.curves.rgb = [
    [0, 0],
    [0.5, 0.6],
    [1, 1],
  ];
  recipe.filter = filterFromPreset(FILTER_PRESETS[0]);
  const sticker = await sharp({
    create: { width: 32, height: 32, channels: 4, background: '#ffaa00' },
  })
    .webp()
    .toBuffer();
  recipe.assets.star = {
    kind: 'raster',
    src: `data:image/webp;base64,${sticker.toString('base64')}`,
    width: 32,
    height: 32,
    mimeType: 'image/webp',
  };
  recipe.annotations = [
    {
      id: 'star-shape',
      type: 'image',
      assetId: 'star',
      rotation: 0,
      opacity: 1,
      x: 100,
      y: 100,
      width: 160,
      height: 160,
    },
  ];
  const saved = await call('PATCH', `/photos/${id}`, { recipe });
  assert.equal(saved.statusCode, 200, saved.body);
  const restored = JSON.parse(store.rawPhoto(id)!.recipe!);
  assert.equal(restored.geometry.flipX, true);
  assert.equal(restored.geometry.straighten, 3);
  assert.equal(restored.geometry.perspective.x, 0.05);
  assert.equal(restored.geometry.cropAspect, 1.5);
  assert.equal(restored.finetune.highlights, 0.28);
  assert.equal(restored.filter.id, recipe.filter.id);
  assert.deepEqual(restored.curves.rgb, recipe.curves.rgb);
  assert.equal(restored.annotations[0].assetId, 'star');
  assert.equal(restored.assets.star.src, recipe.assets.star.src);
  recipe.assets.star.src = 'https://example.invalid/private';
  assert.equal((await call('PATCH', `/photos/${id}`, { recipe })).statusCode, 400);
  assert.equal(JSON.parse(store.rawPhoto(id)!.recipe!).assets.star.src, restored.assets.star.src);
  recipe.assets.star.src = `data:image/png;base64,${Buffer.from('<svg/>').toString('base64')}`;
  assert.equal((await call('PATCH', `/photos/${id}`, { recipe })).statusCode, 400);
});

test('saved crops are rectangular and limited to landscape or portrait photo ratios', async () => {
  const { ticket } = await withPhoto();
  const id = ticket.photos[0].id;
  await call('POST', `/tickets/${ticket.id}/finish`);
  await call('POST', `/tickets/${ticket.id}/claim`);
  const recipe = createEditState();
  recipe.geometry.crop = { x: 100, y: 100, width: 500, height: 500 };
  recipe.geometry.cropShape = 'ellipse';
  recipe.geometry.cropAspect = 1;
  const saved = await call('PATCH', `/photos/${id}`, { recipe });
  assert.equal(saved.statusCode, 200, saved.body);
  const geometry = JSON.parse(store.rawPhoto(id)!.recipe!).geometry;
  assert.equal(geometry.cropShape, 'rect');
  assert.equal(geometry.cropAspect, 1.5);
  assert.ok(Math.abs(geometry.crop.width / geometry.crop.height - 1.5) < 0.00001);
  recipe.geometry.cropAspect = 2 / 3;
  const portrait = await call('PATCH', `/photos/${id}`, { recipe });
  assert.equal(portrait.statusCode, 200, portrait.body);
  const restored = JSON.parse(store.rawPhoto(id)!.recipe!).geometry;
  assert.equal(restored.cropAspect, 2 / 3);
  assert.ok(Math.abs(restored.crop.width / restored.crop.height - 2 / 3) < 0.00001);
});
test('state survives restart and historical downloads retain their event branding', async () => {
  const t = await finalTicket();
  await call('POST', `/events/${event.id}/close`);
  const next = (
    await call('POST', '/events', {
      ...settings,
      eventName: 'Another event',
    })
  ).json<EventConfig>();
  await call('POST', `/events/${next.id}/activate`);
  await app.close();
  ({ app, store } = await createApp({ root, setupPasscode, serveClient: false }));
  const token = t.deliveryPath!.split('/').at(-1)!;
  const old = await call('GET', `/delivery/${token}`, undefined, {} as ReturnType<typeof headers>);
  assert.equal(old.json().event.eventName, settings.eventName);
  assert.equal(store.active()!.id, next.id);
});
