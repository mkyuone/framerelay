import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import statics from '@fastify/static';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { createStore, demand, digest, Problem } from './store.ts';
import type { EventConfig } from '../shared/types.ts';
import { safeRecipe } from './recipe.ts';
import {
  checkOperatorPasscode,
  hashOperatorPasscode,
  operatorHash,
  setOperatorHash,
} from './operator-auth.ts';

export function hashPasscode(passcode: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(passcode, salt, 32).toString('hex')}`;
}
export function checkPasscode(passcode: string, hash: string | undefined) {
  if (!hash) return false;
  const [salt, key] = hash.split(':');
  return timingSafeEqual(scryptSync(passcode, salt, 32), Buffer.from(key, 'hex'));
}
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const eventSchema = z
  .object({
    id: z.string().uuid().optional(),
    eventName: z.string().trim().max(160).default(''),
    primaryColor: color,
    accentColor: color,
    footerText: z.string().max(240),
    selectionLimit: z.number().int().min(1).max(5),
    printEnabled: z.boolean(),
    digitalEnabled: z.boolean(),
    printWidth: z.number().min(1).max(36),
    printHeight: z.number().min(1).max(36),
    copies: z.number().int().min(1).max(10),
    staffPasscode: z.union([z.literal(''), z.string().min(8).max(128)]).default(''),
  })
  .refine(
    (value) => value.printEnabled || value.digitalEnabled,
    'Enable printing or digital delivery.',
  );
const identifier = z.object({ identifier: z.string().trim().min(1).max(1000) });
const patchSchema = z.object({
  excludedPhotography: z.boolean().optional(),
  excludedSelection: z.boolean().optional(),
  chosen: z.boolean().optional(),
  recipe: z.unknown().optional(),
});

export async function createApp(options: {
  root?: string;
  setupPasscode?: string;
  origin?: string;
  production?: boolean;
  serveClient?: boolean;
}) {
  const store = createStore(resolve(options.root ?? './data'));
  if (!operatorHash(store.sql)) {
    if (
      !options.setupPasscode ||
      options.setupPasscode.length < 12 ||
      options.setupPasscode.length > 128
    ) {
      store.close();
      throw new Error('Set SETUP_PASSCODE (12–128 characters) to initialize the operator account.');
    }
    setOperatorHash(store.sql, hashOperatorPasscode(options.setupPasscode));
  }
  const app = Fastify({
    logger: false,
    bodyLimit: 55 * 1024 * 1024,
    trustProxy: options.production ?? false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, fieldSize: 12 * 1024 * 1024, files: 1, fields: 4 },
  });
  const uploads = new Map<string, number>();
  let activeWrites = 0;
  app.addHook('onRequest', async (req) => {
    if (
      req.url.startsWith('/api/') &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.url !== '/api/reset'
    ) {
      activeWrites++;
      (req as typeof req & { countedWrite?: boolean }).countedWrite = true;
    }
  });
  app.addHook('onResponse', async (req) => {
    if ((req as typeof req & { countedWrite?: boolean }).countedWrite) activeWrites--;
  });
  const owner = (req: { headers: Record<string, unknown> }) => {
    const value = req.headers['x-station-id'];
    demand(
      typeof value === 'string' && value.length >= 16 && value.length <= 100,
      'Missing station identifier.',
      400,
    );
    return value;
  };
  const operator = (req: { cookies: Record<string, string | undefined> }) =>
    demand(
      store.authenticate(req.cookies.fr_operator, 'operator'),
      'Unlock operator settings first.',
      401,
    );
  const staff = (req: { cookies: Record<string, string | undefined> }) => {
    const event = store.active();
    demand(event, 'Stations are not configured. Open setup first.', 409);
    demand(
      store.authenticate(req.cookies.fr_staff, 'staff', event.id) ||
        store.authenticate(req.cookies.fr_operator, 'operator'),
      'Enter the staff passcode to continue.',
      401,
    );
    return event;
  };
  const ticket = (id: string, eventId: string) => {
    const t = store.ticket(id);
    demand(t.eventId === eventId, 'Ticket not found.', 404);
    return t;
  };
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: options.production ?? false,
    path: '/',
    maxAge: 7 * 86400,
  };
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('Cache-Control', 'no-store');
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (options.production)
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob:; worker-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    if (req.url.startsWith('/api') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      demand(
        !origin || origin === options.origin || origin === `${req.protocol}://${req.host}`,
        'Request origin is not allowed.',
        403,
      );
      demand(
        req.headers['sec-fetch-site'] !== 'cross-site',
        'Cross-site requests are not allowed.',
        403,
      );
    }
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof z.ZodError)
      return reply.status(400).send({ message: error.issues.map((i) => i.message).join(' ') });
    const status =
      error instanceof Problem
        ? error.status
        : ((error as { statusCode?: number }).statusCode ?? 500);
    const message = error instanceof Error ? error.message : 'Request failed.';
    if (status >= 500) console.error('Request failed:', req.method, req.routeOptions.url, message);
    return reply.status(status).send({
      message: status >= 500 ? 'The server could not complete this action. Please retry.' : message,
    });
  });
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/bootstrap', async (req) => {
    const event = store.active(),
      isOperator = store.authenticate(req.cookies.fr_operator, 'operator');
    return {
      event,
      operator: isOperator,
      staff: isOperator || (!!event && store.authenticate(req.cookies.fr_staff, 'staff', event.id)),
    };
  });
  app.post(
    '/api/login',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z
        .object({ passcode: z.string().max(128), kind: z.enum(['staff', 'operator']) })
        .parse(req.body);
      const event = store.active();
      const verifiedHash = body.kind === 'operator' ? operatorHash(store.sql) : undefined;
      demand(
        body.kind === 'operator'
          ? checkOperatorPasscode(body.passcode, verifiedHash)
          : !!event && checkPasscode(body.passcode, store.staffHash(event.id)),
        'Passcode not recognized.',
        401,
      );
      const token =
        body.kind === 'operator'
          ? store.sql
              .transaction(() => {
                demand(
                  operatorHash(store.sql) === verifiedHash,
                  'Passcode changed. Please sign in again.',
                  401,
                );
                return store.login('operator', null);
              })
              .immediate()
          : store.login('staff', event!.id);
      reply.setCookie(body.kind === 'operator' ? 'fr_operator' : 'fr_staff', token, cookieOptions);
      return { ok: true };
    },
  );
  app.post(
    '/api/operator/passcode',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (req, reply) => {
      operator(req);
      const body = z
        .object({ currentPasscode: z.string().max(128), newPasscode: z.string().min(12).max(128) })
        .parse(req.body);
      const verifiedHash = operatorHash(store.sql);
      demand(
        checkOperatorPasscode(body.currentPasscode, verifiedHash),
        'Current operator passcode is incorrect.',
        403,
      );
      const replacementHash = hashOperatorPasscode(body.newPasscode);
      store.sql
        .transaction(() => {
          operator(req);
          demand(
            operatorHash(store.sql) === verifiedHash,
            'Passcode changed. Please sign in again.',
            401,
          );
          setOperatorHash(store.sql, replacementHash);
        })
        .immediate();
      reply.clearCookie('fr_operator', { path: '/' });
      return { ok: true };
    },
  );
  app.post('/api/logout', async (req, reply) => {
    store.logout(req.cookies.fr_staff);
    store.logout(req.cookies.fr_operator);
    reply.clearCookie('fr_staff', { path: '/' }).clearCookie('fr_operator', { path: '/' });
    return { ok: true };
  });
  app.post('/api/settings', async (req) => {
    operator(req);
    const body = eventSchema.parse(req.body);
    const current = store.active();
    demand(current || body.staffPasscode, 'Set a staff passcode of at least 8 characters.', 400);
    const { staffPasscode, id: _id, ...fields } = body;
    const settings = {
      ...fields,
      id: current?.id ?? randomUUID(),
      status: 'active',
      downloadsEnabled: true,
    } as EventConfig;
    const hash = staffPasscode ? hashPasscode(staffPasscode) : store.staffHash(settings.id)!;
    if (staffPasscode && current) store.sql.prepare("DELETE FROM auth WHERE kind = 'staff'").run();
    return store.saveSettings(settings, hash);
  });
  app.post('/api/reset', async (req) => {
    operator(req);
    demand(
      activeWrites === 0,
      'Wait for ongoing uploads and edits to finish before clearing data.',
    );
    return store.resetData();
  });
  app.post('/api/assets', async (req) => {
    operator(req);
    const file = await req.file();
    demand(file, 'Choose an image.', 400);
    const buffer = await file.toBuffer();
    const id = randomUUID();
    await sharp(buffer, { limitInputPixels: 40_000_000 })
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .png()
      .toFile(join(store.root, 'assets', `${id}.png`));
    return { id };
  });
  app.get<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
    const id = z.string().uuid().parse(req.params.id),
      path = join(store.root, 'assets', `${id}.png`);
    demand(existsSync(path), 'Image not found.', 404);
    return reply.type('image/png').send(readFileSync(path));
  });
  app.get('/api/tickets/recent', async (req) => store.recentTickets(staff(req).id));
  app.post('/api/tickets', async (req) => {
    const event = staff(req);
    const { key } = z.object({ key: z.string().uuid() }).parse(req.body);
    return store.createTicket(event.id, key);
  });
  app.post('/api/tickets/lookup', async (req) =>
    store.resolveTicket(identifier.parse(req.body).identifier, staff(req).id),
  );
  app.get<{ Params: { id: string } }>('/api/tickets/:id', async (req) =>
    ticket(req.params.id, staff(req).id),
  );
  app.post<{ Params: { id: string } }>('/api/tickets/:id/start', async (req) => {
    ticket(req.params.id, staff(req).id);
    return store.beginPhotography(req.params.id);
  });
  app.post<{ Params: { id: string } }>('/api/tickets/:id/finish', async (req) => {
    ticket(req.params.id, staff(req).id);
    demand(!(uploads.get(req.params.id) ?? 0), 'Wait for uploads to finish.');
    return store.finishPhotography(req.params.id);
  });
  app.post<{ Params: { id: string } }>('/api/tickets/:id/claim', async (req) => {
    const t = ticket(req.params.id, staff(req).id);
    demand(t.status === 'ready' || t.status === 'submitted', 'Photography is not complete.');
    store.claim(t.id, owner(req));
    return t;
  });
  app.post<{ Params: { id: string } }>('/api/tickets/:id/release', async (req) => {
    ticket(req.params.id, staff(req).id);
    store.sql
      .prepare(
        'UPDATE sessions SET claim_owner = NULL, claim_until = NULL WHERE id = ? AND claim_owner = ?',
      )
      .run(req.params.id, owner(req));
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/tickets/:id/photos', async (req) => {
    const t = ticket(req.params.id, staff(req).id);
    demand(t.status === 'photographing', 'Photography is not active.');
    uploads.set(t.id, (uploads.get(t.id) ?? 0) + 1);
    let inserted: string | null = null;
    try {
      const file = await req.file();
      demand(file, 'Choose a JPEG.', 400);
      const buffer = await file.toBuffer();
      demand(
        buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8,
        'Only valid JPEG photographs are accepted.',
        400,
      );
      const metadata = await sharp(buffer, { limitInputPixels: 60_000_000 }).metadata();
      demand(metadata.format === 'jpeg', 'Only JPEG photographs are accepted.', 400);
      const normalized = sharp(buffer, { limitInputPixels: 60_000_000 })
        .rotate()
        .toColourspace('srgb');
      const [preview, thumbnail] = await Promise.all([
        normalized
          .clone()
          .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 87 })
          .toBuffer(),
        normalized
          .clone()
          .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer(),
      ]);
      const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
      const result = store.addPhoto(
        t.id,
        digest(buffer),
        file.filename.slice(0, 240),
        rotated ? metadata.height! : metadata.width!,
        rotated ? metadata.width! : metadata.height!,
      );
      if (!result.duplicate) {
        inserted = result.photo.id;
        writeFileSync(join(store.root, 'originals', result.photo.filename), buffer);
        writeFileSync(join(store.root, 'previews', `${result.photo.id}.jpg`), preview);
        writeFileSync(join(store.root, 'thumbnails', `${result.photo.id}.jpg`), thumbnail);
      }
      return store.ticket(t.id);
    } catch (error) {
      if (inserted) store.sql.prepare('DELETE FROM photos WHERE id = ?').run(inserted);
      throw error;
    } finally {
      uploads.set(t.id, Math.max(0, (uploads.get(t.id) ?? 1) - 1));
    }
  });
  app.patch<{ Params: { id: string } }>('/api/photos/:id', async (req) => {
    const event = staff(req),
      body = patchSchema.parse(req.body);
    if (body.recipe !== undefined) {
      const p = store.ownPhoto(req.params.id, event.id);
      body.recipe = safeRecipe(body.recipe, p.width, p.height);
    }
    return store.patchPhoto(req.params.id, event.id, owner(req), body);
  });
  app.get<{ Params: { id: string }; Querystring: { size?: string } }>(
    '/api/photos/:id/image',
    async (req, reply) => {
      const p = store.ownPhoto(req.params.id, staff(req).id),
        size = req.query.size;
      const path =
        size === 'original'
          ? join(store.root, 'originals', p.filename)
          : size === 'final' && p.final_filename
            ? join(store.root, 'finals', p.final_filename)
            : join(store.root, size === 'thumbnail' ? 'thumbnails' : 'previews', `${p.id}.jpg`);
      demand(existsSync(path), 'Image is not ready.', 404);
      return reply.type('image/jpeg').send(readFileSync(path));
    },
  );
  app.post<{ Params: { id: string } }>('/api/photos/:id/final', async (req) => {
    const event = staff(req),
      p = store.ownPhoto(req.params.id, event.id);
    demand(store.ticket(p.session_id).status === 'ready', 'This ticket cannot be edited.');
    store.requireClaim(p.session_id, owner(req));
    const file = await req.file();
    demand(file, 'Upload the edited JPEG.', 400);
    const buffer = await file.toBuffer();
    const field = file.fields.recipe;
    demand(
      field && !Array.isArray(field) && field.type === 'field',
      'Save the edit recipe with the image.',
      400,
    );
    const recipe = safeRecipe(JSON.parse(String(field.value)), p.width, p.height);
    const signature = digest(`${JSON.stringify(recipe)}:${digest(buffer)}`);
    if (p.final_filename && p.final_signature === signature) {
      store.finishRender(p.id, p.final_filename, p.final_width!, p.final_height!, signature);
      return store.ticket(p.session_id);
    }
    const metadata = await sharp(buffer, { limitInputPixels: 60_000_000 }).metadata();
    demand(metadata.format === 'jpeg', 'The final must be a JPEG.', 400);
    const session = store.ticket(p.session_id);
    const filename = `${session.code}_${String(p.number).padStart(2, '0')}_${new Date().toISOString().replace(/[-:.]/g, '')}.jpg`;
    const output = await sharp(buffer)
      .rotate()
      .toColourspace('srgb')
      .jpeg({ quality: 96 })
      .toBuffer({ resolveWithObject: true });
    const rotated = recipe.geometry.rotation % 180 !== 0,
      expectedWidth = recipe.geometry.crop?.width ?? (rotated ? p.height : p.width),
      expectedHeight = recipe.geometry.crop?.height ?? (rotated ? p.width : p.height);
    demand(
      Math.abs(output.info.width - expectedWidth) <= 2 &&
        Math.abs(output.info.height - expectedHeight) <= 2,
      'The edited image must preserve the crop’s full resolution. Retry full-resolution export.',
      400,
    );
    store.requireClaim(p.session_id, owner(req));
    demand(
      store.ticket(p.session_id).status === 'ready',
      'This ticket has already been submitted.',
    );
    const path = join(store.root, 'finals', filename);
    writeFileSync(`${path}.tmp`, output.data);
    renameSync(`${path}.tmp`, path);
    store.sql
      .prepare('UPDATE photos SET recipe = ? WHERE id = ?')
      .run(JSON.stringify(recipe), p.id);
    store.finishRender(p.id, filename, output.info.width, output.info.height, signature);
    return store.ticket(p.session_id);
  });
  app.post<{ Params: { id: string } }>('/api/photos/:id/render', async (req) => {
    const p = store.ownPhoto(req.params.id, staff(req).id);
    store.requireClaim(p.session_id, owner(req));
    demand(store.ticket(p.session_id).status === 'ready', 'Submitted images are read-only.');
    const { recipe } = z.object({ recipe: z.unknown() }).parse(req.body);
    const state = safeRecipe(recipe, p.width, p.height);
    store.sql
      .prepare(
        "UPDATE photos SET recipe = ?, render_status = 'pending', render_error = NULL WHERE id = ?",
      )
      .run(JSON.stringify(state), p.id);
    return store.ticket(p.session_id);
  });
  app.post<{ Params: { id: string } }>('/api/tickets/:id/submit', async (req) => {
    ticket(req.params.id, staff(req).id);
    return store.submit(req.params.id, owner(req));
  });
  app.get('/api/queue', async (req) => store.queue(staff(req).id));
  app.patch<{ Params: { id: string } }>('/api/photos/:id/print', async (req) => {
    const { printed, revision } = z
      .object({ printed: z.boolean(), revision: z.number().int().min(0) })
      .parse(req.body);
    return store.print(req.params.id, staff(req).id, printed, revision);
  });
  app.get<{ Params: { id: string } }>('/api/photos/:id/download', async (req, reply) => {
    const p = store.ownPhoto(req.params.id, staff(req).id);
    demand(
      p.final_filename && store.ticket(p.session_id).status === 'submitted' && p.chosen,
      'Final not found.',
      404,
    );
    return reply
      .header('Content-Disposition', `attachment; filename="${p.final_filename}"`)
      .type('image/jpeg')
      .send(readFileSync(join(store.root, 'finals', p.final_filename)));
  });
  app.get<{ Params: { token: string } }>('/api/delivery/:token', async (req) => {
    const result = store.publicTicket(req.params.token);
    return {
      event: result.event,
      code: result.ticket.code,
      photos: result.photos.map((p) => ({
        id: p.id,
        number: p.number,
        filename: p.finalFilename,
        width: p.finalWidth,
        height: p.finalHeight,
      })),
    };
  });
  app.get<{ Params: { token: string; id: string }; Querystring: { download?: string } }>(
    '/api/delivery/:token/:id',
    async (req, reply) => {
      const { photos } = store.publicTicket(req.params.token),
        p = photos.find((p) => p.id === req.params.id);
      demand(p?.finalFilename, 'Photo not found.', 404);
      if (req.query.download === '1')
        reply.header('Content-Disposition', `attachment; filename="${p.finalFilename}"`);
      return reply
        .type('image/jpeg')
        .send(readFileSync(join(store.root, 'finals', p.finalFilename)));
    },
  );
  if (options.serveClient !== false && existsSync(resolve('dist'))) {
    await app.register(statics, { root: resolve('dist'), prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ message: 'Not found.' });
      return reply.sendFile('index.html');
    });
  }
  app.addHook('onClose', async () => store.close());
  return { app, store };
}
