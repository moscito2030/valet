import { test, expect } from '@playwright/test';

test('a slow Google Fonts stylesheet does not hold the homepage first paint', async ({ page }) => {
  let release!: () => void;
  let requests = 0;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('https://fonts.googleapis.com/**', async (route) => {
    requests++;
    await pending;
    await route.fulfill({ contentType: 'text/css', body: '/* Deliberately delayed font CSS. */' });
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => requests).toBe(2);
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() =>
      performance.getEntriesByName('first-contentful-paint').length,
    )).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  } finally {
    release();
    await page.waitForLoadState('load');
  }
});
