import { test, expect } from '@playwright/test';
for (const theme of ['forest', 'light', 'sepia', 'nord', 'dracula']) {
  test(theme, async ({ page }) => {
    await page.addInitScript((theme) => localStorage.setItem('valet-theme', theme), theme);
    await page.goto('/design-preview');
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('heading', { name: '設計預覽' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    const colors = await page.locator('.play-keyboard').evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        text: style.color,
        black: getComputedStyle(el.querySelector('[data-suit="S"]')!).color,
        red: getComputedStyle(el.querySelector('[data-suit="H"]')!).color,
        diamond: getComputedStyle(el.querySelector('[data-suit="D"]')!).color,
      };
    });
    expect(colors.black).toBe(colors.text);
    expect(colors.red).toBe(colors.diamond);
    expect(colors.red).not.toBe(colors.text);
    await expect(page).toHaveScreenshot(theme + '.png', { fullPage: true });
    await page.getByRole('button', { name: '分數明細' }).click();
    await expect(page.locator('#preview-score-details')).toBeVisible();
    await expect(page.locator('#preview-score-details')).toHaveScreenshot(theme + '-popover.png');
  });
}
