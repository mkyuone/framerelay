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

test('PWA launch remembers the last station independently on each device', async ({
  page,
  context,
  browser,
}) => {
  expect(
    (
      await page.request.post('/api/login', {
        data: { kind: 'operator', passcode: 'browser-test-operator-passcode' },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.post('/api/settings', {
        data: {
          eventName: '',
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
      })
    ).ok(),
  ).toBeTruthy();
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  await page.goto(manifest.start_url);
  await expect(page).toHaveURL(/\/registration$/);
  await page.getByRole('button', { name: 'Station settings' }).click();
  await page.getByRole('link', { name: 'Print Station', exact: true }).click();
  await expect(page).toHaveURL(/\/printing$/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('framerelay.station-role')))
    .toBe('printing');
  await page.close();

  const relaunched = await context.newPage();
  await relaunched.goto(manifest.start_url);
  await expect(relaunched).toHaveURL(/\/printing$/);
  await expect(relaunched.locator('.station-title-text')).toHaveText(/Print/);
  await relaunched.goto('/settings');
  await relaunched.goto(manifest.start_url);
  await expect(relaunched).toHaveURL(/\/printing$/);
  await relaunched.goto('/selection');
  await expect(relaunched).toHaveURL(/\/selection$/);
  await expect
    .poll(() => relaunched.evaluate(() => localStorage.getItem('framerelay.station-role')))
    .toBe('selection');
  await relaunched.goto(manifest.start_url);
  await expect(relaunched).toHaveURL(/\/selection$/);

  const freshDevice = await browser.newContext();
  try {
    const fresh = await freshDevice.newPage();
    await fresh.goto(new URL(manifest.start_url, relaunched.url()).toString());
    await expect(fresh).toHaveURL(/\/registration$/);
  } finally {
    await freshDevice.close();
  }
});

test('existing standalone installations reopen their remembered station', async ({ page }) => {
  await page.goto('/printing');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('framerelay.station-role')))
    .toBe('printing');
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      query === '(display-mode: standalone)'
        ? {
            ...original(query),
            matches: true,
            media: query,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {
              return true;
            },
            onchange: null,
          }
        : original(query);
  });
  await page.goto('/registration');
  await expect(page).toHaveURL(/\/printing$/);
});

test('the page and overscroll background follow the configured theme', async ({ page }) => {
  expect(
    (
      await page.request.post('/api/login', {
        data: { kind: 'operator', passcode: 'browser-test-operator-passcode' },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.post('/api/settings', {
        data: {
          eventName: '',
          primaryColor: '#173568',
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
      })
    ).ok(),
  ).toBeTruthy();
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/printing');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(23, 53, 104)');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(23, 53, 104)');
  await expect(page.locator('html')).toHaveCSS('overscroll-behavior-y', 'none');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#173568');
});
