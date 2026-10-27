import { defineConfig } from '@playwright/test';

// Dedicated local server only. Never aim mutation tests at a deployed URL.
export default defineConfig({
  webServer: {
    command: 'node scripts/ko-e2e-server.mjs',
    url: 'http://127.0.0.1:3117/api/session',
    reuseExistingServer: false,
    timeout: 120000,
  },
  testDir: './tests/e2e',
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: 'http://127.0.0.1:3117',
    locale: 'zh-TW',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
