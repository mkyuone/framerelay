import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

async function setup(page: Page) {
  const login = await page.request.post('/api/login', {
    data: { kind: 'operator', passcode: 'browser-test-operator-passcode' },
  });
  expect(login.ok()).toBeTruthy();
  const result = await page.request.post('/api/settings', {
    data: {
      eventName: 'Connection test',
      primaryColor: '#101D40',
      accentColor: '#1162D4',
      footerText: '',
      selectionLimit: 1,
      printEnabled: true,
      digitalEnabled: true,
      printWidth: 6,
      printHeight: 4,
      copies: 1,
      staffPasscode: 'browser-staff-passcode',
    },
  });
  expect(result.ok()).toBeTruthy();
}

test('short outages stay in place; longer outages cover the screen and recover', async ({
  page,
  context,
}) => {
  await setup(page);
  await page.goto('/registration');
  await expect(page.getByRole('button', { name: 'Create first ticket' })).toBeVisible();
  const overlay = page.getByRole('alertdialog', { name: 'Connection lost' });
  await context.setOffline(true);
  await page.waitForTimeout(3000);
  await expect(overlay).toHaveCount(0);
  await context.setOffline(false);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await context.setOffline(true);
  await expect(overlay).toBeVisible({ timeout: 9000 });
  await expect(page.locator('.station-shell')).toBeAttached();
  await expect(page.locator('.connection-overlay')).toHaveCSS('position', 'fixed');
  await context.setOffline(false);
  await expect(overlay).toHaveCount(0, { timeout: 7000 });
  await expect(page.getByRole('button', { name: 'Create first ticket' })).toBeVisible();
});

test('image remains hidden with a spinner until it has finished loading', async ({ page }) => {
  await setup(page);
  const ticket = await (
    await page.request.post('/api/tickets', { data: { key: randomUUID() } })
  ).json();
  await page.request.post(`/api/tickets/${ticket.id}/start`);
  const jpeg = await sharp({
    create: { width: 300, height: 200, channels: 3, background: '#4488bb' },
  })
    .jpeg()
    .toBuffer();
  const uploaded = await page.request.post(`/api/tickets/${ticket.id}/photos`, {
    multipart: { file: { name: 'image.jpg', mimeType: 'image/jpeg', buffer: jpeg } },
  });
  expect(uploaded.ok()).toBeTruthy();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/photos/*/image?size=thumbnail', async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.goto('/photography');
  await page.getByLabel('Ticket ID or QR link').fill(ticket.code);
  await page.getByRole('button', { name: 'Find ticket' }).click();
  const img = page.getByAltText('Image 01');
  await expect(img).toHaveCSS('visibility', 'hidden');
  await expect(page.getByRole('status', { name: 'Loading image' })).toBeVisible();
  release();
  await expect(img).toHaveCSS('visibility', 'visible');
  await expect(page.getByRole('status', { name: 'Loading image' })).toHaveCount(0);
});
