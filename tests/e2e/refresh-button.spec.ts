import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const origin = 'http://127.0.0.1:3117';

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
  const login = await page.request.post('/api/session', {
    headers: { origin },
    data: { password: 'local-e2e-director-2026' },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
});

async function createEvent(page: Page, name: string) {
  const response = await page.request.post('/api/events', {
    headers: { origin },
    data: {
      name,
      kind: 'teams',
      teamMethod: 'imp',
      teamFormat: 'league',
      names: ['甲隊', '乙隊', '丙隊', '丁隊'],
      date: '2026-11-28',
      venue: '本機',
      rounds: 2,
      boardsPerRound: 2,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).id as string;
}

async function openViewer(page: Page, id: string) {
  const context = page.context();
  // Viewer should be anonymous: drop the director cookie for this navigation by using a fresh context is hard.
  // Clear cookies then go, re-login is in beforeEach of the same page — use storageState-less request is already done.
  await context.clearCookies();
  await page.goto(`/?event=${id}&view=standings`);
  await expect(page.getByRole('button', { name: /更新成績/ })).toBeVisible();
}

test('click refreshes, long-press toggles auto-update without a trailing refresh, and a competition disable blocks the toggle', async ({
  page,
}, info) => {
  const id = await createEvent(page, `刷新按鈕 ${info.project.name}`);
  let progressCalls = 0;
  page.on('request', (request) => {
    if (request.url().includes('/progress') && request.method() === 'GET') progressCalls++;
  });
  await openViewer(page, id);
  const button = page.getByRole('button', { name: /更新成績/ });
  await expect(button).toHaveAttribute('aria-label', '更新成績，手動');
  await expect(button.getByText('手動', { exact: true })).toBeVisible();
  await expect(page.getByText('自動更新已關閉')).toBeVisible();
  const afterLoad = progressCalls;

  await button.dispatchEvent('pointerdown', { button: 0 });
  await page.waitForTimeout(600);
  await button.dispatchEvent('pointerup', { button: 0 });
  await button.dispatchEvent('click');
  await expect(button).toHaveAttribute('aria-label', '更新成績，自動');
  await expect(button.getByText('自動', { exact: true })).toBeVisible();
  await expect(page.getByText(/每 30 秒自動更新/)).toBeVisible();
  await expect.poll(() => progressCalls).toBe(afterLoad);

  const selected = await page.evaluate(() => document.getSelection()?.toString() ?? '');
  expect(selected).toBe('');

  await page.waitForTimeout(800);
  await button.click();
  await expect.poll(() => progressCalls).toBeGreaterThan(afterLoad);

  // Director disables auto-update for the competition, then a new viewer session should see 已禁用.
  const login = await page.request.post('/api/session', {
    headers: { origin },
    data: { password: 'local-e2e-director-2026' },
  });
  expect(login.ok()).toBeTruthy();
  const event = await (await page.request.get(`/api/admin/events/${id}`)).json();
  const competition = event.competition ?? { id, revision: event.revision, name: event.name, venue: event.venue ?? '' };
  const patch = await page.request.patch(`/api/competitions/${competition.id}`, {
    headers: { origin },
    data: {
      name: competition.name,
      venue: competition.venue ?? '',
      revision: competition.revision,
      requestId: randomUUID(),
      disableAutoRefresh: true,
    },
  });
  expect(patch.ok(), await patch.text()).toBeTruthy();

  await openViewer(page, id);
  const disabled = page.getByRole('button', { name: /更新成績/ });
  await expect(disabled).toHaveAttribute('aria-label', '更新成績，已禁用');
  const before = progressCalls;
  await disabled.dispatchEvent('pointerdown', { button: 0 });
  await page.waitForTimeout(600);
  await disabled.dispatchEvent('pointerup', { button: 0 });
  await disabled.dispatchEvent('click');
  await expect(disabled).toHaveAttribute('aria-label', '更新成績，已禁用');
  await expect(page.getByText('此賽事已禁用自動更新')).toBeVisible();
  await expect.poll(() => progressCalls).toBe(before);
  await page.waitForTimeout(800);
  await disabled.click();
  await expect.poll(() => progressCalls).toBeGreaterThan(before);
});
