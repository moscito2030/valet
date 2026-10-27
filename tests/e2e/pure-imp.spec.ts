import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { BridgeEvent } from '../../lib/model';
import { readFile } from 'node:fs/promises';

const origin = 'http://127.0.0.1:3117';
async function get(request: APIRequestContext, id: string): Promise<BridgeEvent> {
  const response = await request.get(`/api/admin/events/${id}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function mutate(request: APIRequestContext, id: string, command: object) {
  const event = await get(request, id);
  const response = await request.patch(`/api/events/${id}`, {
    headers: { origin },
    data: {
      revision: event.revision,
      requestId: randomUUID(),
      reason: '隔離本機驗證',
      ...command,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return get(request, id);
}
async function openAdmin(page: Page, id: string) {
  await page.goto(`/?event=${id}&view=standings`);
  await page.getByRole('button', { name: '登入身分：裁判', exact: true }).click();
  await page.locator('.identity-menu').click();
  await expect(page.getByRole('heading', { name: '裁判後台' })).toBeVisible();
}
async function openKo(page: Page, id: string) {
  await openAdmin(page, id);
  await page.locator('.admin-tabs').getByRole('button', { name: '淘汰賽', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
  const response = await page.request.get('/api/session');
  expect((await response.json()).storage).toBe('local');
  const login = await page.request.post('/api/session', {
    headers: { origin },
    data: { password: 'local-e2e-director-2026' },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
});

test('director configures a pure IMP final, adds overtime, applies a deciding penalty and exports results', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.request.post('/api/events', {
    headers: { origin },
    data: {
      name: `IMP 端到端 ${info.project.name}`,
      kind: 'teams',
      teamMethod: 'imp',
      teamFormat: 'knockout',
      names: [],
      date: '2026-10-28',
      venue: '',
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { id } = await response.json();
  await openAdmin(page, id);
  await page.getByRole('button', { name: '賽程與牌局管理', exact: true }).click();
  await page.getByLabel('隊伍名稱', { exact: false }).fill('Alpha\nBeta');
  await page.getByRole('button', { name: '儲存參賽名單', exact: true }).click();
  await expect.poll(async () => (await get(page.request, id)).participants.length).toBe(2);
  await page.locator('.admin-tabs').getByRole('button', { name: '淘汰賽', exact: true }).click();
  await page.getByLabel('預設每圈牌數', { exact: true }).fill('2');
  await page.getByRole('button', { name: '產生種子對戰表草稿', exact: true }).click();
  await page.getByRole('button', { name: '儲存完整對戰表', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '公布已確定雙方的對局', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '公布已確定雙方的對局', exact: true }).click();
  await expect.poll(async () => (await get(page.request, id)).assignments.length).toBe(2);
  let event = await get(page.request, id);
  const passRows = event.assignments.flatMap((a) =>
    a.boards.map((board) => ({
      assignmentId: a.id,
      board,
      level: 0,
      strain: 'NT',
      declarer: 'N',
      doubled: 1,
      tricks: 0,
      lead: '',
    })),
  );
  await mutate(page.request, id, { action: 'results', results: passRows });
  await openKo(page, id);
  const overtime = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: '平手加賽', exact: true }) });
  await overtime.getByLabel('原因', { exact: true }).fill('平手追加一牌');
  await overtime.getByRole('button', { name: '追加加賽', exact: true }).click();
  await expect
    .poll(async () => (await get(page.request, id)).knockout?.extraLegs?.s1m1?.length)
    .toBe(1);
  event = await get(page.request, id);
  const extra = event.knockout!.extraLegs!.s1m1[0];
  const rows = event.assignments
    .filter((a) => a.round === extra.round)
    .flatMap((a) =>
      a.boards.map((board) => ({
        assignmentId: a.id,
        board,
        level: a.room === 'open' ? 4 : 0,
        strain: a.room === 'open' ? 'S' : 'NT',
        declarer: 'N',
        doubled: 1,
        tricks: a.room === 'open' ? 10 : 0,
        lead: '',
      })),
    );
  await mutate(page.request, id, { action: 'results', results: rows });
  await openKo(page, id);
  const adjustment = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: '對局 IMP 調整' }) });
  await adjustment.getByLabel('Alpha 調整 IMP').fill('-20');
  await adjustment.getByLabel('原因', { exact: true }).fill('遲到扣二十 IMP');
  await adjustment.getByRole('button', { name: '儲存 IMP 調整' }).click();
  await expect
    .poll(async () => (await get(page.request, id)).knockout?.adjustments?.s1m1?.a)
    .toBe(-20);
  await page.getByRole('button', { name: '確認勝負', exact: true }).click();
  await expect
    .poll(async () => (await get(page.request, id)).knockout?.decisions.s1m1?.winner)
    .toBe('t2');
  await page.getByRole('button', { name: '總排名', exact: true }).filter({ visible: true }).click();
  await expect(page.locator('.knockout-grid')).toContainText('勝方：Beta');
  await expect(page.locator('main')).not.toContainText(/\bVP\b/);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: '列印淘汰賽成績' }).click();
  const popup = await popupPromise;
  await expect(popup.locator('table')).toContainText('加賽節');
  await expect(popup.locator('body')).not.toContainText(/\bVP\b/);
  await popup.close();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出淘汰賽成績 CSV' }).click();
  const download = await downloadPromise;
  const target = info.outputPath('knockout.csv');
  await download.saveAs(target);
  const csv = await readFile(target, 'utf8');
  expect(csv).toContain('加賽節');
  expect(csv).toContain('遲到扣二十 IMP');
  expect(csv).toContain('Beta');
  expect(csv).not.toMatch(/\bVP\b/);
  await page
    .getByRole('button', { name: '圈次與對戰', exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.locator('main')).not.toContainText(/\bVP\b/);
  await page
    .getByRole('button', { name: '隊伍成績', exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.locator('.player-results')).toBeVisible();
  await expect(page.locator('.player-results')).not.toContainText(/\bVP\b/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByLabel('選擇成績圈次').selectOption(String(extra.round));
  await page.locator('.match-context-trigger').click();
  await expect(page.locator('#player-preround-summary')).toContainText('遲到扣二十 IMP');
  await page.screenshot({ path: info.outputPath('pure-imp-player.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('unfinished match can forfeit through UI without fabricated scores and staff cannot decide', async ({
  page,
}) => {
  const response = await page.request.post('/api/events', {
    headers: { origin },
    data: {
      name: '棄權本機驗證',
      kind: 'teams',
      teamFormat: 'knockout',
      names: ['甲', '乙'],
      date: '2026-10-28',
      venue: '',
      rounds: 2,
      boardsPerRound: 2,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { id } = await response.json();
  await mutate(page.request, id, { action: 'knockout-publish' });
  await openKo(page, id);
  const forfeit = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: '棄權／退賽決勝' }) });
  await forfeit.getByLabel('棄權隊伍').selectOption('t1');
  await forfeit.getByLabel('原因', { exact: true }).fill('傷病無法繼續');
  await forfeit.getByRole('button', { name: '確認棄權決勝' }).click();
  await expect
    .poll(async () => (await get(page.request, id)).knockout?.decisions.s1m1?.method)
    .toBe('forfeit');
  expect((await get(page.request, id)).results).toEqual({});
  const finished = await mutate(page.request, id, { action: 'settings', status: 'finished' });
  expect(finished.status).toBe('finished');
  await page.request.post('/api/session', {
    headers: { origin },
    data: { password: 'local-e2e-admin-2026' },
  });
  const denied = await page.request.patch(`/api/events/${id}`, {
    headers: { origin },
    data: {
      action: 'knockout-reopen',
      nodeId: 's1m1',
      revision: finished.revision,
      requestId: randomUUID(),
      reason: '賽務不可決勝',
    },
  });
  expect(denied.status()).toBe(403);
});
