import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  workers: 1,
  snapshotPathTemplate: '{testDir}/baselines/{projectName}/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:3107',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    colorScheme: 'light',
  },
  projects: [
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3107',
    url: 'http://127.0.0.1:3107/design-preview',
    reuseExistingServer: false,
    timeout: 120000,
    env: { NEXT_DIST_DIR: '.next-visual' },
  },
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.002 } },
});
