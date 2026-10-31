import {
  test,
  expect,
  type Page,
  type APIRequestContext,
  type BrowserContext,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import type { EventConfig, Ticket } from '../shared/types';

const artifacts = process.env.QA_ARTIFACT_DIR ?? join(tmpdir(), 'framerelay-qa');
let operatorCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];
const settings = {
  eventName: 'Portrait Afternoon',
  primaryColor: '#101D40',
  accentColor: '#1162D4',
  footerText: 'Make a little memory.',
  selectionLimit: 1,
  printEnabled: true,
  digitalEnabled: true,
  printWidth: 6,
  printHeight: 4,
  copies: 1,
  staffPasscode: 'browser-staff-passcode',
};
async function login(request: APIRequestContext) {
  if ((await (await request.get('/api/bootstrap')).json()).operator) return;
  const response = await request.post('/api/login', {
    data: { kind: 'operator', passcode: 'browser-test-operator-passcode' },
  });
  expect(response.ok()).toBeTruthy();
}
async function event(request: APIRequestContext, limit = 1) {
  await login(request);
  const events = (await (await request.get('/api/events')).json()) as EventConfig[];
  for (const e of events)
    if (e.status === 'active') await request.post(`/api/events/${e.id}/close`);
  const e = (await (
    await request.post('/api/events', { data: { ...settings, selectionLimit: limit } })
  ).json()) as EventConfig;
  expect((await request.post(`/api/events/${e.id}/activate`)).ok()).toBeTruthy();
  return e;
}
async function image(index = 0, width = 1200, height = 800) {
  const source = process.env.QA_PHOTO_PATH
    ? sharp(process.env.QA_PHOTO_PATH).resize(width, height)
    : sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: (40 + index * 20) % 256, g: 90, b: 130 },
        },
      });
  return source
    .withExif({ IFD0: { ImageDescription: `FrameRelay test image ${index}` } })
    .jpeg({ quality: 85 })
    .toBuffer();
}
async function seedTicket(
  request: APIRequestContext,
  count = 8,
  width = 1200,
  height = 800,
  finish = true,
) {
  const t = (await (
    await request.post('/api/tickets', { data: { key: randomUUID() } })
  ).json()) as Ticket;
  await request.post(`/api/tickets/${t.id}/start`);
  let latest = t;
  for (let i = 0; i < count; i++) {
    const response = await request.post(`/api/tickets/${t.id}/photos`, {
      multipart: {
        file: {
          name: `capture-${i}.jpg`,
          mimeType: 'image/jpeg',
          buffer: await image(i, width, height),
        },
      },
    });
    expect(response.ok()).toBeTruthy();
    latest = await response.json();
  }
  if (finish) await request.post(`/api/tickets/${t.id}/finish`);
  return latest;
}
async function lookup(page: Page, ticket: Ticket) {
  await page.getByLabel('Ticket ID or QR link').fill(ticket.code);
  await page.getByRole('button', { name: 'Find ticket', exact: true }).click();
}
async function shot(page: Page, name: string) {
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: join(artifacts, name), fullPage: false, animations: 'disabled' });
}
async function shellFits(page: Page) {
  await expect(page.locator('.station-header')).toBeVisible();
  await expect(page.locator('.station-footer')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
  ).toBeTruthy();
  const header = await page.locator('.station-header').boundingBox(),
    footer = await page.locator('.station-footer').boundingBox();
  expect(header!.y).toBe(0);
  expect(Math.round(footer!.y + footer!.height)).toBe(page.viewportSize()!.height);
}

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  if (operatorCookies.length) await page.context().addCookies(operatorCookies);
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('400 (Bad Request)'))
      errors.push(message.text());
  });
});

test.afterEach(async ({ page }) => {
  const cookies = (await page.context().cookies()).filter(
    (cookie) => cookie.name === 'fr_operator',
  );
  if (cookies.length) operatorCookies = cookies;
  expect(browserErrors.get(page)).toEqual([]);
  await expect(page).toHaveTitle('FrameRelay');
});

test('setup and complete a one-photo customer through all four stations', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/settings');
  await page.getByLabel('Operator passcode').fill('browser-test-operator-passcode');
  await page.getByRole('button', { name: 'Unlock setup' }).click();
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByLabel('Event name (optional)', { exact: true }).fill(settings.eventName);
  await page.getByText('Appearance', { exact: true }).click();
  await page.getByLabel('Default footer text').fill(settings.footerText);
  await page.getByLabel('Shared event passcode').fill(settings.staffPasscode);
  await page.getByRole('button', { name: 'Activate event' }).click();
  await expect(page.getByRole('heading', { name: 'Your event is running.' })).toBeVisible();
  await page.goto('/registration');
  await page.getByRole('button', { name: 'Create first ticket' }).click();
  await expect(page.locator('.qr-block img')).toBeVisible();
  let tickets = (await (await page.request.get('/api/tickets/recent')).json()) as Ticket[];
  const ticket = tickets[0];
  await shellFits(page);
  await shot(page, 'registration-ipad.png');
  await page.goto('/photography');
  await lookup(page, ticket);
  await page.locator('input[type=file]').setInputFiles(
    [0, 1, 2].map((i) => ({
      name: `capture-${i}.jpg`,
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(0),
    })),
  ); // Failed files must have a visible retry, not a silent disappearance.
  await expect(page.getByRole('button', { name: 'Retry', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Remove failed upload/ })).toHaveCount(3);
  await expect(page.locator('.upload-error')).toHaveText([
    'Only valid JPEG photographs are accepted.',
    'Only valid JPEG photographs are accepted.',
    'Only valid JPEG photographs are accepted.',
  ]);
  for (const i of [0, 1, 2]) {
    const remove = page.getByRole('button', {
      name: `Remove failed upload capture-${i}.jpg`,
      exact: true,
    });
    await remove.click();
    await expect(remove).toHaveCount(0);
  }
  const files = await Promise.all(
    [0, 1, 2].map(async (i) => ({
      name: `capture-${i}.jpg`,
      mimeType: 'image/jpeg',
      buffer: await image(i),
    })),
  );
  await page.locator('input[type=file]').setInputFiles(files);
  await expect(page.locator('.photo-card')).toHaveCount(3);
  await expect(page.locator('.upload-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Exclude image 3', exact: true }).click();
  await expect(page.locator('.photo-card.excluded')).toHaveCount(1);
  await shot(page, 'photography-ipad.png');
  await page.getByRole('button', { name: 'Finish customer', exact: true }).click();
  await page.getByRole('button', { name: 'Exports finished — continue' }).click();
  await expect(page.getByRole('heading', { name: 'Scan customer ticket' })).toBeVisible();
  await page.goto('/selection');
  await lookup(page, ticket);
  await expect(page.locator('.photo-card')).toHaveCount(3);
  await expect(page.locator('.selection-excluded')).toHaveCount(1);
  await expect(page.locator('.selection-excluded .excluded-strike line')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Show excluded|Hide excluded/ })).toHaveCount(0);
  await page.locator('.photo-card').first().locator('.photo-card-meta .image-number').click();
  await expect(page.getByRole('button', { name: 'Unchoose image 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit chosen photo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Preview image 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Inspect detail' })).toBeVisible();
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.reload();
  await expect(page.locator('.photo-card.chosen')).toHaveCount(1);
  await page.getByRole('button', { name: 'Edit chosen photo', exact: true }).click();
  await expect(page.locator('.iu-root')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rotate left', exact: true })).toBeVisible();
  await expect(
    page.locator('.iu-root').getByRole('button', { name: 'Annotate', exact: true }),
  ).toHaveCount(0);
  await shot(page, 'editor-ipad.png');
  await page.getByRole('button', { name: 'Save and review' }).click();
  await expect(page.getByRole('button', { name: 'Submit final photos' })).toBeEnabled({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Submit final photos' }).click();
  await expect(
    page.getByRole('heading', { name: 'Collect your prints later.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Optional digital copy', exact: true }),
  ).toBeVisible();
  for (const viewport of [
    { width: 1194, height: 834 },
    { width: 390, height: 844 },
    { width: 938, height: 480 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.locator('.delivery-content').evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
      )
      .toBeTruthy();
    const qr = (await page.locator('.digital-copy .qr-block').boundingBox())!;
    expect(qr.width).toBeLessThanOrEqual(176);
    await shellFits(page);
    await shot(page, `print-handoff-${viewport.width}x${viewport.height}.png`);
  }
  await page.setViewportSize({ width: 1194, height: 834 });
  await shot(page, 'delivery-ipad.png');
  const submitted = (await (await page.request.get(`/api/tickets/${ticket.id}`)).json()) as Ticket;
  expect(submitted.photos.find((p) => p.chosen)?.finalFilename).toMatch(
    new RegExp(`^${ticket.code}_01_`),
  );
  await page.goto('/printing');
  await page.getByRole('button', { name: new RegExp(ticket.code) }).click();
  await expect(page.locator('.station-header .customer-context')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Finish customer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark printed', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download JPEG' }).click();
  expect((await download).suggestedFilename()).toMatch(new RegExp(`^${ticket.code}_01_`));
  expect(
    ((await (await page.request.get(`/api/tickets/${ticket.id}`)).json()) as Ticket).photos[0]
      .printed,
  ).toBe(false);
  await shot(page, 'printing-desktop.png');
  await page.getByRole('button', { name: 'Mark printed', exact: true }).click();
  await expect(page.getByText('All prints released', { exact: true })).toBeVisible();
  await page.goto('/selection');
  await expect(
    page.getByRole('heading', { name: 'Your prints are ready to collect.', exact: true }),
  ).toBeVisible();
  const customer = await page
      .context()
      .browser()!
      .newContext({ viewport: { width: 390, height: 844 } }),
    customerPage = await customer.newPage();
  await customerPage.goto(`http://127.0.0.1:3401${submitted.deliveryPath}`);
  await expect(
    customerPage.getByRole('link', { name: 'Download photo', exact: true }),
  ).toBeVisible();
  await expect(customerPage.getByRole('button', { name: 'Station settings' })).toHaveCount(0);
  await shot(customerPage, 'customer-mobile.png');
  await customer.close();
  expect(errors).toEqual([]);
});

test('grid, comparison, local settings and responsive shell', async ({ page }) => {
  const e = await event(page.request),
    ticket = await seedTicket(page.request);
  await page.goto('/selection');
  await lookup(page, ticket);
  await expect(page.locator('.photo-card')).toHaveCount(8);
  await page.getByRole('button', { name: 'Choose image 1', exact: true }).click();
  await shot(page, 'selection-ipad.png');
  await shellFits(page);
  expect(
    await page.locator('.photo-grid').evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open comparison', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Choose image 1', exact: true })).toHaveCount(0);
  await page.locator('.photo-card').first().locator('.photo-card-meta .image-number').click();
  await page.getByRole('button', { name: 'Compare image 2', exact: true }).click();
  await expect(page.locator('.compare-pick-badge')).toHaveText(['1', '2']);
  await shot(page, 'comparison-picks.png');
  await page.getByRole('button', { name: 'Open comparison', exact: true }).click();
  await expect(page.locator('.compare-grid img')).toHaveCount(2);
  await shot(page, 'comparison-ipad.png');
  // Regions inside the panel support the same wheel / navigator inspection as the main viewer.
  const panel = page.locator('.compare-pane').nth(1);
  const frames = () =>
    page.locator('.compare-pane .inspector-stage-wrap').evaluateAll((elements) =>
      elements.map((el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    );
  const framesBefore = await frames();
  await panel.getByRole('button', { name: 'Choose image 2', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Unchoose image 2', exact: true })).toBeVisible();
  const switched = (await (await page.request.get(`/api/tickets/${ticket.id}`)).json()) as Ticket;
  expect(switched.photos.filter((p) => p.chosen).map((p) => p.number)).toEqual([2]);
  expect(await frames()).toEqual(framesBefore);
  await panel.getByRole('button', { name: '100%', exact: true }).click();
  await expect(panel.getByRole('region', { name: 'Zoom navigator', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator('.compare-modal .mantine-Modal-content')
        .evaluate(
          (el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1,
        ),
    )
    .toBeTruthy();
  await shot(page, 'comparison-phone.png');
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Station settings', exact: true }).click();
  await page.getByLabel('Footer text override').fill('Selection desk 2');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.locator('.footer-copy')).toHaveText('Selection desk 2');
  await page.goto('/photography');
  await expect(page.locator('.footer-copy')).toHaveText(settings.footerText);
  await page.goto('/selection');
  await page.getByRole('button', { name: 'Station settings', exact: true }).click();
  await page.getByRole('button', { name: 'Reset station preferences' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.footer-copy')).toHaveText(settings.footerText);
  await page.setViewportSize({ width: 1440, height: 960 });
  await shellFits(page);
  await shot(page, 'selection-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.photo-card')).toHaveCount(8);
  await shellFits(page);
  await shot(page, 'selection-portrait.png');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  expect(e.selectionLimit).toBe(1);
});

test('five finals and full-resolution server export', async ({ page }) => {
  await event(page.request, 5);
  const ticket = await seedTicket(page.request, 5, 6000, 4000);
  await page.goto('/selection');
  await lookup(page, ticket);
  await expect(page.locator('.photo-card')).toHaveCount(5);
  for (let i = 1; i <= 5; i++) {
    await page.getByRole('button', { name: `Choose image ${i}`, exact: true }).click();
    await expect(page.locator('.photo-card.chosen')).toHaveCount(i);
  }
  await page.getByRole('button', { name: 'Edit chosen photos', exact: true }).click();
  await expect(page.locator('.iu-root')).toBeVisible();
  await page.locator('.iu-root').getByRole('tab', { name: 'Finetune', exact: true }).click();
  await page.getByRole('slider', { name: 'Brightness', exact: true }).press('ArrowRight');
  await page.getByRole('tab', { name: 'Filter', exact: true }).click();
  await page.getByRole('radio', { name: 'Chrome', exact: true }).click();
  await page.getByRole('tab', { name: 'Sticker', exact: true }).click();
  await page.getByRole('button', { name: 'Star', exact: true }).click();
  await expect
    .poll(async () => {
      const t = (await (await page.request.get(`/api/tickets/${ticket.id}`)).json()) as Ticket;
      return (t.photos[0].recipe as { annotations?: unknown[] })?.annotations?.length;
    })
    .toBe(1);
  await page.getByRole('button', { name: 'Save and next', exact: true }).click();
  await expect(page.locator('.footer-status')).toContainText('Image 02 · 2/5', { timeout: 45000 });
  const edited = (await (await page.request.get(`/api/tickets/${ticket.id}`)).json()) as Ticket;
  const state = edited.photos[0].recipe;
  for (let i = 1; i < 5; i++) {
    const response = await page.request.post(`/api/photos/${ticket.photos[i].id}/render`, {
      headers: {
        'x-station-id': await page.evaluate(() => localStorage.getItem('framerelay.device')!),
      },
      data: { recipe: state },
    });
    expect(response.ok()).toBeTruthy();
  }
  await expect
    .poll(
      async () => {
        const t = (await (await page.request.get(`/api/tickets/${ticket.id}`)).json()) as Ticket;
        return t.photos.filter((p) => p.renderStatus === 'ready').length;
      },
      { timeout: 90000 },
    )
    .toBe(5);
  const ready = (await (await page.request.get(`/api/tickets/${ticket.id}`)).json()) as Ticket;
  expect(ready.photos.every((p) => p.finalWidth === 6000 && p.finalHeight === 4000)).toBeTruthy();
  const browserPixels = await sharp(
    await (await page.request.get(`/api/photos/${ticket.photos[0].id}/image?size=final`)).body(),
  )
    .resize(120, 80)
    .raw()
    .toBuffer();
  const serverPixels = await sharp(
    await (await page.request.get(`/api/photos/${ticket.photos[1].id}/image?size=final`)).body(),
  )
    .resize(120, 80)
    .raw()
    .toBuffer();
  const averageDifference =
    browserPixels.reduce((sum, value, index) => sum + Math.abs(value - serverPixels[index]), 0) /
    browserPixels.length;
  expect(averageDifference).toBeLessThan(1);
  const owner = await page.evaluate(() => localStorage.getItem('framerelay.device')!);
  const submission = await page.request.post(`/api/tickets/${ticket.id}/submit`, {
    headers: { 'x-station-id': owner },
  });
  expect(submission.ok()).toBeTruthy();
  const result = (await submission.json()) as Ticket;
  const publicResult = await (
    await page.request.get(`/api/delivery/${result.deliveryPath!.split('/').at(-1)}`)
  ).json();
  expect(publicResult.photos).toHaveLength(5);
});

test('watched folder ignores the baseline, survives refresh and separates customers', async ({
  page,
}) => {
  await event(page.request);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => navigator.storage.getDirectory(),
    });
  });
  await page.goto('/photography');
  async function writePhoto(name: string, index: number) {
    const data = (await image(index)).toString('base64');
    await page.evaluate(
      async ({ name, data }) => {
        const folder = await navigator.storage.getDirectory(),
          handle = await folder.getFileHandle(name, { create: true }),
          writer = await handle.createWritable();
        await writer.write(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
        await writer.close();
      },
      { name, data },
    );
  }
  await writePhoto('existing.jpg', 0);
  await page.getByRole('button', { name: 'Connect export folder', exact: true }).click();
  await expect(page.locator('.footer-status')).toHaveText('Folder connected');
  const first = (await (
    await page.request.post('/api/tickets', { data: { key: randomUUID() } })
  ).json()) as Ticket;
  await lookup(page, first);
  await expect(page.getByRole('heading', { name: 'Capture the moment.' })).toBeVisible();
  await writePhoto('customer-one.jpg', 1);
  await expect(page.locator('.photo-card')).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator('.upload-card')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.photo-card')).toHaveCount(1);
  await expect(page.locator('.footer-status')).toHaveText('Folder connected');
  await writePhoto('customer-one-second.jpg', 2);
  await expect(page.locator('.photo-card')).toHaveCount(2, { timeout: 15000 });
  await page.getByRole('button', { name: 'Finish customer', exact: true }).click();
  await page.getByRole('button', { name: 'Exports finished — continue' }).click();
  await expect(page.getByRole('heading', { name: 'Scan customer ticket' })).toBeVisible();
  const second = (await (
    await page.request.post('/api/tickets', { data: { key: randomUUID() } })
  ).json()) as Ticket;
  await lookup(page, second);
  await expect(page.getByRole('heading', { name: 'Capture the moment.' })).toBeVisible();
  await writePhoto('customer-two.jpg', 3);
  await expect(page.locator('.photo-card')).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator('.upload-card')).toHaveCount(0);
  await expect(page.locator('.photo-state')).toHaveText('Ready');
  const result = (await (await page.request.get(`/api/tickets/${second.id}`)).json()) as Ticket;
  expect(result.photos[0].sourceName).toBe('customer-two.jpg');
  expect(
    ((await (await page.request.get(`/api/tickets/${first.id}`)).json()) as Ticket).photos,
  ).toHaveLength(2);
});

test('optional event name, Inter typography, footer role switching and scanner spacing', async ({
  page,
}) => {
  await login(page.request);
  const events = (await (await page.request.get('/api/events')).json()) as EventConfig[];
  for (const event of events)
    if (event.status === 'active') await page.request.post(`/api/events/${event.id}/close`);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  await expect(page.getByLabel('Event name (optional)', { exact: true })).not.toHaveAttribute(
    'required',
  );
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Photobooth display name', { exact: true })).toHaveCount(0);
  await page.getByLabel('Shared event passcode').fill(settings.staffPasscode);
  await page.getByRole('button', { name: 'Activate event', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your event is running.' })).toBeVisible();
  await page.goto('/selection');
  await expect(
    page.getByRole('heading', { name: 'Scan customer ticket', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.locator('.scanner-heading h1').evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain('Inter Variable');
  expect(await page.evaluate(() => document.fonts.check('16px "Inter Variable"'))).toBeTruthy();
  await expect(page.locator('.station-name small')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Switch station', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Station settings', exact: true }).hover();
  await shot(page, 'station-footer-settings-hover.png');
  await page.getByRole('button', { name: 'Station settings', exact: true }).click();
  const roles = page.getByRole('navigation', { name: 'Station role', exact: true });
  await expect(roles.getByRole('link')).toHaveCount(4);
  await expect(roles.getByRole('link')).toHaveText([
    'Registration Station',
    'Photography Station',
    'Select & Edit Station',
    'Print Station',
  ]);
  await roles.getByRole('link', { name: 'Print Station', exact: true }).click();
  await expect(page).toHaveURL(/\/printing$/);
  await expect(page.locator('.station-title-text')).toHaveText('Print Station');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Station settings', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Station role', exact: true })
    .getByRole('link', { name: 'Select & Edit Station', exact: true })
    .click();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1194, height: 834 },
    { width: 938, height: 667 },
    { width: 390, height: 844 },
    { width: 938, height: 480 },
  ]) {
    await page.setViewportSize(viewport);
    if (viewport.width === 1440 || viewport.width === 390) {
      await expect(page.locator('.station-title-text')).toHaveText(
        viewport.width === 1440 ? 'Select & Edit Station' : 'Select & Edit',
      );
      await shot(
        page,
        viewport.width === 1440 ? 'station-title-full.png' : 'station-title-compact.png',
      );
    }
    const heading = await page.locator('.scanner-heading').boundingBox(),
      camera = await page.getByRole('button', { name: 'Start camera', exact: true }).boundingBox(),
      lookup = await page.locator('.lookup-form').boundingBox();
    expect(camera!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height + 8);
    expect(lookup!.y).toBeGreaterThanOrEqual(camera!.y + camera!.height + 8);
    await shellFits(page);
    expect(
      await page.locator('.scanner-page').evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 1194, height: 834 });
  await shot(page, 'scanner-inter-ipad.png');
  await page.getByRole('button', { name: 'Station settings', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Station role', exact: true })).toBeVisible();
  await shot(page, 'station-role-settings.png');
});

test('3:2 filled thumbnails, upload status beneath each image and visible crossed-out exclusions', async ({
  page,
}) => {
  await event(page.request);
  const ticket = (await (
    await page.request.post('/api/tickets', { data: { key: randomUUID() } })
  ).json()) as Ticket;
  await page.goto('/photography');
  await lookup(page, ticket);
  let releaseUpload!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const intercept = '**/api/tickets/*/photos';
  await page.route(intercept, async (route) => {
    await gate;
    await route.continue();
  });
  const original = await image(0, 1200, 1800);
  try {
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'portrait.jpg', mimeType: 'image/jpeg', buffer: original });
    const pending = page.locator('.upload-card');
    await expect(pending).toHaveCount(1);
    await expect(pending.getByRole('status')).toContainText(/Uploading|Processing/);
    await expect(pending.locator('.photo-preview img')).toBeVisible();
    await expect
      .poll(() =>
        pending
          .locator('img')
          .evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
      )
      .toBeTruthy();
    const preview = await pending.locator('.photo-preview').boundingBox(),
      status = await pending.locator('.photo-card-meta').boundingBox();
    expect(preview!.width / preview!.height).toBeCloseTo(1.5, 2);
    expect(status!.y).toBeGreaterThanOrEqual(preview!.y + preview!.height - 1);
    expect(await pending.locator('img').evaluate((el) => getComputedStyle(el).objectFit)).toBe(
      'cover',
    );
    await expect(page.locator('.upload-list,.upload-row')).toHaveCount(0);
    await shot(page, 'photography-upload-crop.png');
  } finally {
    releaseUpload();
  }
  await expect(page.locator('.upload-card')).toHaveCount(0);
  await expect(page.locator('.photo-card .photo-state')).toHaveText('Ready');
  await page.unroute(intercept);
  const saved = (await (await page.request.get(`/api/tickets/${ticket.id}`)).json()) as Ticket;
  expect(saved.photos[0].width).toBe(1200);
  expect(saved.photos[0].height).toBe(1800);
  const downloadedOriginal = await (
    await page.request.get(`/api/photos/${saved.photos[0].id}/image?size=original`)
  ).body();
  expect(downloadedOriginal.equals(original)).toBeTruthy();
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 1194, height: 834 },
    { width: 938, height: 667 },
    { width: 390, height: 844 },
    { width: 938, height: 480 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.locator('.photo-grid').evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
      )
      .toBeTruthy();
    const preview = await page.locator('.photo-preview').boundingBox();
    expect(preview!.width / preview!.height).toBeCloseTo(1.5, 2);
  }
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.getByRole('button', { name: 'Finish customer', exact: true }).click();
  await page.getByRole('button', { name: 'Exports finished — continue' }).click();
  await expect(page.getByRole('heading', { name: 'Scan customer ticket' })).toBeVisible();
  await page.goto('/selection');
  await lookup(page, ticket);
  await page.getByRole('button', { name: 'Exclude image 1', exact: true }).click();
  const excluded = page.locator('.selection-excluded');
  await expect(excluded).toHaveCount(1);
  await expect(excluded.locator('.excluded-strike line')).toHaveCount(1);
  await expect(excluded.locator('.image-overlay')).toHaveCount(0);
  expect(await excluded.locator('img').evaluate((el) => getComputedStyle(el).filter)).toBe(
    'brightness(0.35)',
  );
  await expect(page.getByRole('button', { name: /Show excluded|Hide excluded/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose image 1', exact: true })).toBeDisabled();
  await shot(page, 'selection-excluded-strike.png');
  await page.getByRole('button', { name: 'Restore image 1', exact: true }).click();
  await expect(page.locator('.photo-card')).toHaveCount(1);
  await expect(page.locator('.excluded-strike')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose image 1', exact: true })).toBeEnabled();
});

test('photography scrolls only its images area and Finish customer stays blue on hover', async ({
  page,
}) => {
  await event(page.request);
  const ticket = await seedTicket(page.request, 12, 600, 400, false);
  await page.goto('/photography');
  await lookup(page, ticket);
  await expect(page.locator('.photo-card')).toHaveCount(12);
  await expect(page.locator('.pagination')).toHaveCount(0);
  await expect(page.locator('.status-dot')).toHaveCount(0);
  const grid = page.locator('.photo-grid');
  await expect.poll(() => grid.evaluate((el) => el.scrollHeight > el.clientHeight)).toBeTruthy();
  const before = {
    header: await page.locator('.station-header').boundingBox(),
    footer: await page.locator('.station-footer').boundingBox(),
    controls: await page.locator('.workspace-toolbar').boundingBox(),
  };
  await grid.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    page.getByRole('button', { name: 'Preview image 12', exact: true }),
  ).toBeInViewport();
  expect(await grid.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('.station-header').boundingBox()).toEqual(before.header);
  expect(await page.locator('.station-footer').boundingBox()).toEqual(before.footer);
  expect(await page.locator('.workspace-toolbar').boundingBox()).toEqual(before.controls);
  await shellFits(page);
  const card = page.locator('.photo-card').last();
  const exclude = card.getByRole('button', { name: 'Exclude image 12', exact: true });
  await exclude.hover();
  const buttonBox = await exclude.boundingBox();
  const metaBox = await card.locator('.photo-card-meta').boundingBox();
  expect(buttonBox!.y - metaBox!.y).toBeGreaterThanOrEqual(6);
  expect(metaBox!.y + metaBox!.height - buttonBox!.y - buttonBox!.height).toBeGreaterThanOrEqual(6);
  expect(metaBox!.x + metaBox!.width - buttonBox!.x - buttonBox!.width).toBeGreaterThanOrEqual(8);
  await shot(page, 'photography-button-padding.png');
  const finishButton = page.getByRole('button', { name: 'Finish customer', exact: true });
  await finishButton.hover();
  await expect(finishButton).toHaveCSS('background-color', 'rgb(17, 98, 212)');
  await expect(finishButton).toHaveCSS('border-top-color', 'rgb(17, 98, 212)');
  await expect(finishButton).toHaveCSS('filter', 'brightness(1.12)');
  await shot(page, 'photography-scroll-blue-hover.png');
  await finishButton.click();
  await page.getByRole('button', { name: 'Exports finished — continue' }).click();
  await expect(page.getByRole('heading', { name: 'Scan customer ticket' })).toBeVisible();
  await page.goto('/selection');
  await lookup(page, ticket);
  await expect(page.locator('.pagination')).toHaveCount(0);
  await expect(page.locator('.photo-card')).toHaveCount(12);
  await expect
    .poll(() => page.locator('.photo-grid').evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBeTruthy();
  await page
    .getByRole('button', { name: 'Preview image 12', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole('button', { name: 'Preview image 12', exact: true }),
  ).toBeInViewport();
  await shellFits(page);
});

test('detail zoom anchors the pointer, pans, navigates and resets; zebras flag only bright JPEG pixels', async ({
  page,
}) => {
  await event(page.request);
  const ticket = await seedTicket(page.request, 1, 600, 400, false);
  const original = await sharp(await image(50, 4000, 2667))
    .composite([
      {
        input: await sharp({
          create: { width: 900, height: 900, channels: 3, background: '#ffffff' },
        })
          .png()
          .toBuffer(),
        left: 0,
        top: 0,
      },
      {
        input: await sharp({
          create: { width: 900, height: 900, channels: 3, background: '#202020' },
        })
          .png()
          .toBuffer(),
        left: 3100,
        top: 0,
      },
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
  const response = await page.request.post(`/api/tickets/${ticket.id}/photos`, {
    multipart: { file: { name: 'highlight-test.jpg', mimeType: 'image/jpeg', buffer: original } },
  });
  expect(response.ok()).toBeTruthy();
  const saved = (await response.json()) as Ticket;
  await page.goto('/photography');
  await lookup(page, ticket);
  const zebra = page.getByRole('button', { name: 'Highlight zebras', exact: true });
  await expect(zebra).toHaveAttribute('aria-pressed', 'true');
  const mask = page.locator('.photo-card').nth(1).locator('canvas');
  await expect
    .poll(() =>
      mask.evaluate((el: HTMLCanvasElement) => {
        const context = el.getContext('2d')!;
        return [
          context.getImageData(Math.floor(el.width * 0.1), Math.floor(el.height * 0.1), 1, 1)
            .data[3],
          context.getImageData(Math.floor(el.width * 0.9), Math.floor(el.height * 0.1), 1, 1)
            .data[3],
        ];
      }),
    )
    .toEqual([220, 0]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Highlight zebras', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Preview image 2', exact: true }).click();
  const viewer = page.getByRole('region', { name: 'Photo detail viewer', exact: true });
  const photo = page.locator('.inspector-photo');
  const box = (await viewer.boundingBox())!;
  const point = { x: box.x + box.width * 0.65, y: box.y + box.height * 0.45 };
  await page.getByRole('button', { name: 'Inspect detail', exact: true }).click();
  await expect(page.getByLabel('Image zoom', { exact: true })).toHaveText('100%');
  const before = (await photo.boundingBox())!;
  const fraction = {
    x: (point.x - before.x) / before.width,
    y: (point.y - before.y) / before.height,
  };
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -160);
  await expect(page.getByRole('region', { name: 'Zoom navigator', exact: true })).toBeVisible();
  const after = (await photo.boundingBox())!;
  expect((point.x - after.x) / after.width).toBeCloseTo(fraction.x, 2);
  expect((point.y - after.y) / after.height).toBeCloseTo(fraction.y, 2);
  const wheelZoom = Number(await photo.getAttribute('data-zoom'));
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -10);
  await page.keyboard.up('Control');
  await expect
    .poll(async () => Number(await photo.getAttribute('data-zoom')))
    .toBeGreaterThan(wheelZoom);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  await viewer.focus();
  await page.keyboard.press('1');
  await expect(page.getByLabel('Image zoom', { exact: true })).toHaveText('100%');
  await expect(page.locator('.inspector-original.loaded')).toBeVisible();
  const panBefore = Number(await photo.getAttribute('data-pan-x'));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  expect(Number(await photo.getAttribute('data-pan-x')) - panBefore).toBeCloseTo(90, 0);
  const navigator = page.getByRole('region', { name: 'Zoom navigator', exact: true });
  const navBox = (await navigator.boundingBox())!;
  await navigator.click({ position: { x: navBox.width * 0.8, y: navBox.height * 0.7 } });
  expect(Number(await photo.getAttribute('data-pan-x'))).toBeLessThan(0);
  expect(Number(await photo.getAttribute('data-pan-y'))).toBeLessThan(0);
  await shot(page, 'photo-detail-navigator.png');
  await viewer.focus();
  await page.keyboard.press('0');
  await expect(navigator).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspect detail', exact: true }).click();
  const navHighlight = (await navigator.boundingBox())!;
  await navigator.click({
    position: { x: navHighlight.width * 0.1, y: navHighlight.height * 0.1 },
  });
  await shot(page, 'photo-detail-zebras.png');
  await page.getByRole('button', { name: 'Next image', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Inspect detail', exact: true })).toBeVisible();
  await expect(navigator).toHaveCount(0);
  await expect(page.getByLabel('Image zoom', { exact: true })).toHaveText('100%');
  await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  await page.getByRole('button', { name: 'Highlight zebras', exact: true }).click();
  await expect(page.locator('.zebra-overlay')).toHaveCount(0);
  const untouched = await (
    await page.request.get(`/api/photos/${saved.photos[1].id}/image?size=original`)
  ).body();
  expect(untouched.equals(original)).toBeTruthy();
});

test('detail viewer supports touch pinch and remains contained on tablet and phone', async ({
  page,
}) => {
  await event(page.request);
  const ticket = await seedTicket(page.request, 1, 2000, 3000, false);
  await page.goto('/photography');
  await lookup(page, ticket);
  await page.getByRole('button', { name: 'Preview image 1', exact: true }).click();
  const viewer = page.getByRole('region', { name: 'Photo detail viewer', exact: true });
  const box = (await viewer.boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: x - 45, y, id: 1 },
      { x: x + 45, y, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: x - 100, y, id: 1 },
      { x: x + 100, y, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('region', { name: 'Zoom navigator', exact: true })).toBeVisible();
  expect(Number(await page.locator('.inspector-photo').getAttribute('data-zoom'))).toBeGreaterThan(
    1.9,
  );
  await cdp.detach();
  for (const viewport of [
    { width: 1194, height: 834 },
    { width: 938, height: 667 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const content = page.locator('.preview-modal .mantine-Modal-content');
    await expect
      .poll(() =>
        content.evaluate(
          (el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1,
        ),
      )
      .toBeTruthy();
    const nav = (await page.locator('.photo-navigator').boundingBox())!;
    expect(nav.width / nav.height).toBeCloseTo(2 / 3, 1);
    await expect(page.getByRole('button', { name: 'Close preview', exact: true })).toBeInViewport();
    await expect(viewer).toBeInViewport();
    await shot(page, `photo-detail-${viewport.width}.png`);
  }
});

test('photo actions lock safely without flashing unrelated controls; only text fields select', async ({
  page,
}) => {
  await event(page.request);
  const ticket = await seedTicket(page.request, 3, 1200, 800, false);
  await page.goto('/photography');
  await lookup(page, ticket);
  const finish = page.getByRole('button', { name: 'Finish customer', exact: true });
  const other = page.getByRole('button', { name: 'Exclude image 2', exact: true });
  const finishBefore = await finish.boundingBox();
  const otherBefore = await other.boundingBox();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercept = '**/api/photos/*';
  await page.route(intercept, async (route) => {
    if (route.request().method() === 'PATCH') await gate;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Exclude image 1', exact: true }).click();
    await expect(other).toBeDisabled();
    await expect(other).toHaveCSS('opacity', '1');
    await expect(finish).toBeDisabled();
    await expect(finish).toHaveCSS('opacity', '1');
    await expect(finish.locator('.spin')).toHaveCount(0);
    expect(await finish.boundingBox()).toEqual(finishBefore);
    expect(await other.boundingBox()).toEqual(otherBefore);
    await shot(page, 'station-controls-pending.png');
  } finally {
    release();
  }
  await expect(page.getByRole('button', { name: 'Restore image 1', exact: true })).toBeVisible();
  await expect(other).toBeEnabled();
  await page.unroute(intercept);
  const title = page.locator('.station-title-text');
  const titleBox = (await title.boundingBox())!;
  await page.mouse.move(titleBox.x + 2, titleBox.y + titleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(titleBox.x + titleBox.width - 2, titleBox.y + titleBox.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await page.getByRole('button', { name: 'Station settings', exact: true }).click();
  const field = page.getByLabel('Footer text override', { exact: true });
  await field.fill('Text fields remain editable');
  await field.press('ControlOrMeta+a');
  expect(
    await field.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!),
  ).toBe('Text fields remain editable'.length);
});

test('station unlock is one message, one field and one button', async ({ page }) => {
  await event(page.request);
  await page.context().clearCookies();
  await page.goto('/selection');
  await expect(
    page.getByRole('heading', { name: 'Enter the event passcode', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.access-card h1')).toHaveCount(1);
  await expect(page.locator('.access-card input')).toHaveCount(1);
  await expect(page.locator('.access-card button')).toHaveCount(1);
  await expect(page.locator('.access-page a, .access-brand, .access-icon')).toHaveCount(0);
  for (const viewport of [
    { width: 1194, height: 834 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: 'Open station', exact: true })).toBeInViewport();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    ).toBeTruthy();
    await shot(page, `simple-unlock-${viewport.width}.png`);
  }
  await page.getByLabel('Event passcode', { exact: true }).fill(settings.staffPasscode);
  await page.getByRole('button', { name: 'Open station', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Scan customer ticket', exact: true }),
  ).toBeVisible();
});

test('native editor fills the workspace, locks crop ratios and preserves finetune, filters and stickers', async ({
  page,
}) => {
  const e = await event(page.request);
  const ticket = await seedTicket(page.request, 1, 2000, 1333);
  const savedPhoto = async () =>
    ((await (await page.request.get(`/api/tickets/${ticket.id}`)).json()) as Ticket).photos[0];
  await page.goto('/selection');
  await lookup(page, ticket);
  await page.getByRole('button', { name: 'Choose image 1', exact: true }).click();
  await page.getByRole('button', { name: 'Edit chosen photo', exact: true }).click();
  await expect(page.locator('.iu-root')).toBeVisible();
  await expect(page.locator('.iu-stage__overlay')).toHaveCount(0);
  await expect(page.locator('.iu-rail').getByRole('tab')).toHaveText([
    'Adjust',
    'Finetune',
    'Filter',
    'Sticker',
  ]);
  await expect(page.locator('.editor-step')).toHaveCount(0);
  await expect(page.locator('.footer-status')).toContainText('Image 01 · 1/1');
  const ratios = page.getByRole('radiogroup', { name: 'Aspect ratio', exact: true });
  await expect(ratios.getByRole('radio')).toHaveCount(2);
  await ratios.getByRole('radio', { name: '2:3', exact: true }).click();
  await expect
    .poll(
      async () =>
        ((await savedPhoto()).recipe as { geometry: { cropAspect: number } })?.geometry.cropAspect,
    )
    .toBeCloseTo(2 / 3, 5);
  await page.locator('.iu-topbar__reset').click();
  await expect
    .poll(
      async () =>
        ((await savedPhoto()).recipe as { geometry: { cropAspect: number } })?.geometry.cropAspect,
    )
    .toBe(1.5);
  await ratios.getByRole('radio', { name: '3:2', exact: true }).press('ArrowRight');
  await expect(ratios.getByRole('radio', { name: '2:3', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await ratios.getByRole('radio', { name: '2:3', exact: true }).press('ArrowLeft');
  await expect(ratios.getByRole('radio', { name: '3:2', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('radio', { name: 'Horizontal', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Horizontal', exact: true })).toHaveCSS(
    'background-color',
    'rgb(17, 98, 212)',
  );
  await expect(page.getByRole('radio', { name: 'Horizontal', exact: true })).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  );
  await shot(page, 'editor-native-adjust.png');
  await page.getByRole('tab', { name: 'Finetune', exact: true }).click();
  const brightness = page.getByRole('slider', { name: 'Brightness', exact: true });
  await expect(brightness).toBeVisible();
  expect(
    (await brightness.locator('.iu-ruler__track').boundingBox())!.width,
  ).toBeGreaterThanOrEqual(600);
  const range = (await brightness.boundingBox())!;
  await page.mouse.move(range.x + range.width / 2, range.y + range.height / 2);
  await page.mouse.down();
  await page.mouse.move(range.x + range.width / 2 - 90, range.y + range.height / 2, { steps: 12 });
  await page.mouse.up();
  const dragged = Number(await brightness.getAttribute('aria-valuenow'));
  expect(dragged).toBeGreaterThan(15);
  expect(dragged).toBeLessThan(45);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(brightness).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(brightness).toHaveAttribute('aria-valuenow', String(dragged));
  await brightness.press('ArrowLeft');
  await expect(brightness).toHaveAttribute('aria-valuenow', String(dragged - 5));
  await page.getByRole('radio', { name: 'Saturation', exact: true }).click();
  const saturation = page.getByRole('slider', { name: 'Saturation', exact: true });
  for (let i = 0; i < 7; i++) await saturation.press('ArrowRight');
  await expect(saturation).toHaveAttribute('aria-valuenow', '35');
  await expect
    .poll(async () => ((await savedPhoto()).recipe as { finetune: unknown })?.finetune)
    .toMatchObject({ brightness: (dragged - 5) / 100, saturation: 0.35 });
  for (const viewport of [
    { width: 1194, height: 834 },
    { width: 938, height: 667 },
    { width: 390, height: 844 },
    { width: 938, height: 480 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(async () => {
        const editor = (await page.locator('.photo-editor').boundingBox())!,
          header = (await page.locator('.station-header').boundingBox())!,
          footer = (await page.locator('.station-footer').boundingBox())!;
        return (
          Math.abs(editor.x) < 1 &&
          Math.abs(editor.y - header.height) < 1 &&
          Math.abs(editor.width - viewport.width) < 1 &&
          Math.abs(editor.y + editor.height - footer.y) < 1
        );
      })
      .toBeTruthy();
    await expect
      .poll(() =>
        page
          .locator('.iu-root')
          .evaluate(
            (el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1,
          ),
      )
      .toBeTruthy();
    await expect(saturation).toBeInViewport();
    expect((await saturation.boundingBox())!.width).toBeGreaterThan(120);
    const heights = await page
      .locator('.header-actions .button')
      .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().height));
    expect(heights[0]).toBe(heights[1]);
    await shellFits(page);
    await shot(page, `editor-native-finetune-${viewport.width}x${viewport.height}.png`);
  }
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.getByRole('tab', { name: 'Filter', exact: true }).click();
  await page.getByRole('radio', { name: 'Chrome', exact: true }).click();
  await expect
    .poll(async () => ((await savedPhoto()).recipe as { filter?: { id: string } })?.filter?.id)
    .toBe('chrome');
  await shot(page, 'editor-native-filter.png');
  await page.getByRole('tab', { name: 'Sticker', exact: true }).click();
  await page.getByRole('button', { name: 'Star', exact: true }).click();
  await expect
    .poll(
      async () => ((await savedPhoto()).recipe as { annotations?: unknown[] })?.annotations?.length,
    )
    .toBe(1);
  await shot(page, 'editor-native-sticker.png');
  await page.getByRole('button', { name: 'Back to photos', exact: true }).click();
  await page.evaluate(
    (key) => localStorage.removeItem(key),
    `framerelay.edit.${e.id}.${ticket.photos[0].id}`,
  );
  await page.getByRole('button', { name: 'Edit chosen photo', exact: true }).click();
  await expect(page.locator('.iu-root')).toBeVisible();
  await expect(page.locator('.iu-stage__overlay')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save and review', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Submit final photos', exact: true })).toBeEnabled({
    timeout: 45000,
  });
  await expect(page.getByRole('heading', { name: 'Confirm Image', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit again', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Exclude', exact: true })).toHaveCount(0);
  await expect(page.locator('.review-card')).toHaveText('');
  for (const viewport of [
    { width: 1194, height: 834 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const card = (await page.locator('.review-card').boundingBox())!,
      image = (await page.locator('.review-card img').boundingBox())!;
    expect(card.width - image.width).toBeCloseTo(2, 0);
    expect(card.height - image.height).toBeCloseTo(2, 0);
    expect(image.height).toBeLessThanOrEqual(361);
    const heights = await page
      .locator('.header-actions .button')
      .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().height));
    expect(heights[0]).toBe(heights[1]);
    await shellFits(page);
    await shot(page, `confirm-image-${viewport.width}.png`);
  }
});
