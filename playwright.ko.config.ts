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
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } }, testIgnore: /refresh-button/ },
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
      testIgnore: /refresh-button/,
    },
    { name: 'desktop-refresh', testMatch: /refresh-button/, use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'webkit-iphone',
      testMatch: /refresh-button/,
      use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
    },
  ],
});
