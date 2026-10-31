import 'dotenv/config';
import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  outputDir: join(tmpdir(), 'framerelay-playwright-results'),
  use: {
    actionTimeout: 15_000,
    baseURL: 'http://127.0.0.1:3401',
    viewport: { width: 1194, height: 834 },
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx tsx tests/serve.ts',
    url: 'http://127.0.0.1:3401/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
