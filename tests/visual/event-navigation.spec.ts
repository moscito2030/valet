import { test, expect } from '@playwright/test';
import { seedEvents } from '../../lib/domain/demo-events';
import { audienceEvent } from '../../lib/read-models/public-event';

test('event deep links and the lazy board view remain usable', async ({ page }) => {
  const stored = seedEvents()[0];
  const event = stored.event;
  await page.route('**/api/session', route => route.fulfill({ json: {
    admin: false, director: false, configured: true, storage: 'demo',
  } }));
  await page.route('**/api/events', route => route.fulfill({ json: { storage: 'demo', events: [{
    id: event.id, name: event.name, kind: event.kind, date: event.date,
    status: event.status, demo: true, participants: event.participants.length,
    rounds: event.rounds, boards: event.boards.length,
    received: stored.projection.received, expected: stored.projection.expected,
  }] } }));
  await page.route(`**/api/events/${event.id}`, route => route.fulfill({
    json: audienceEvent(event, stored.projection),
  }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/?event=${event.id}&view=standings`);
  await expect(page.locator('main')).toContainText(event.name);
  await page.getByRole('button', { name: '逐副成績', exact: true }).filter({ visible: true }).click();
  await expect(page.locator('.board-information')).toBeVisible();
  await page.getByRole('button', { name: '總排名', exact: true }).filter({ visible: true }).click();
  await expect(page.locator('.ranking-table')).toBeVisible();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
