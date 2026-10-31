import { test, expect } from '@playwright/test';

test('installs an offline shell without caching customer data', async ({ page, context }) => {
  await page.goto('/registration');
  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestUrl).toBe('/manifest.webmanifest');
  const manifest = await (await page.request.get(manifestUrl!)).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual([
    '192x192',
    '512x512',
  ]);
  for (const icon of manifest.icons) {
    const response = await page.request.get(icon.src);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('image/png');
  }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
    return requests.flat().map((request) => new URL(request.url).pathname);
  });
  expect(cached).toContain('/');
  expect(cached.some((path) => path.startsWith('/api/'))).toBeFalsy();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('alertdialog', { name: 'Connection lost' })).toBeVisible({
    timeout: 10000,
  });
  await context.setOffline(false);
});
