import { test, expect } from '@playwright/test';

for (const director of [false, true]) {
  test(`competition list does not wait for session; director=${director}`, async ({ page }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/session', async route => {
      await pending;
      await route.fulfill({ json: { admin: director, director } });
    });
    await page.route('**/api/competitions', route => route.fulfill({ json: { competitions: [{
      id: 'public-fixture', name: 'Performance fixture', prefix: '', venue: '',
      date: '2026-10-25', archived: false, stages: [],
    }] } }));
    const sessionResponse = page.waitForResponse(response => response.url().endsWith('/api/session'));
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Performance fixture', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '建立賽事', exact: true })).toHaveCount(0);
    } finally {
      release();
      await sessionResponse;
    }
    if (director) {
      await expect(page.getByRole('button', { name: '建立賽事', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: '建立賽事', exact: true })).toHaveCount(0);
    }
  });
}
