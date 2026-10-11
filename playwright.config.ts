import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4318',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4318',
    reuseExistingServer: !process.env.CI,
    env: { STUDIO_DEMO: '1', STUDIO_PORT: '4318', STUDIO_WRITES: '0' },
  },
});
