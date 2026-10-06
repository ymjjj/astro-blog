import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function start(page: Page) {
  await page.goto('/');
  await expect(page.locator('#entries .entry').first()).toBeVisible();
  return async (op: string, args: unknown = {}) =>
    page.evaluate(
      async ({ op, args }) => {
        const token = document.querySelector<HTMLMetaElement>('meta[name=studio-token]')!.content;
        return (
          await fetch('/api/' + op, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token },
            body: JSON.stringify(args),
          })
        ).json();
      },
      { op, args },
    );
}
async function confirmPlan(page: Page) {
  await expect(page.locator('#maintenance-message')).toContainText('清单已生成');
  await expect(page.locator('#apply-plan')).toBeDisabled();
  await page.locator('#confirm-plan').check();
  await page.locator('#apply-plan').click();
  await expect(page.locator('#maintenance-message')).toContainText('已在本机执行', {
    timeout: 15000,
  });
}
async function generatePlan(page: Page, button: Locator) {
  const ready = page.waitForResponse((r) => r.url().endsWith('/api/plan'));
  await button.click();
  const result = await (await ready).json();
  expect(result.ok).toBe(true);
  await expect(page.locator('#plan-panel')).toHaveAttribute('data-plan-id', result.data.planId);
}

test('恢复中心搜索预览、确认清理与回收站撤销', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const api = await start(page),
    sessionId = crypto.randomUUID(),
    title = '恢复中心 ' + sessionId;
  expect(
    (
      await api('checkpoint', {
        sessionId,
        expectedVersion: null,
        id: null,
        baseRevision: null,
        requestId: crypto.randomUUID(),
        form: {
          kind: 'moments',
          slug: '',
          title,
          description: '',
          date: '',
          updated: '',
          tags: '',
          body: '需要恢复的私有正文',
        },
      })
    ).ok,
  ).toBe(true);
  await page.reload();
  await expect(page.locator('#recovery-panel')).toBeVisible();
  await page.locator('#recovery-query').fill(title);
  await expect(page.locator('.recovery-item')).toHaveCount(1);
  await page.locator('.recovery-item summary').click();
  await expect(page.locator('.recovery-item pre')).toContainText('需要恢复的私有正文');
  await expect(page.locator('#recovery-space')).toContainText('B');
  await generatePlan(page, page.locator('.recovery-item').getByText('预览清理', { exact: true }));
  await expect(page.locator('#plan-files')).toContainText(sessionId);
  await confirmPlan(page);
  expect((await api('recovery', { sessionId })).ok).toBe(false);
  const tx = page.locator('#trash-list .manage-row').filter({ hasText: sessionId }).first();
  await generatePlan(page, tx.getByText('预览撤销', { exact: true }));
  await confirmPlan(page);
  expect((await api('recovery', { sessionId })).data.form.body).toBe('需要恢复的私有正文');
  await page.locator('#recovery-panel').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `docs/screenshots/maintenance-${info.project.name}-recovery-light.png`,
  });
  await page.locator('#theme').click();
  await page.locator('#recovery-panel').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/screenshots/maintenance-${info.project.name}-recovery-dark.png`,
  });
  expect(errors).toEqual([]);
});

test('图片引用与缩略图、备份下载导入、预览恢复和过期计划拒绝', async ({ page }, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const api = await start(page),
    title = '备份图文 ' + crypto.randomUUID();
  const created = await api('create', {
    kind: 'moments',
    title,
    body: '备份中的正文',
    requestId: crypto.randomUUID(),
  });
  expect(created.ok).toBe(true);
  const entry = created.data;
  const imported = await api('image', {
    id: entry.id,
    base64: (await readFile('public/media/blue-notebook-sketch-small.webp')).toString('base64'),
    alt: '引用检查图',
    requestId: crypto.randomUUID(),
  });
  expect(imported.ok).toBe(true);
  const withImage = await api('update', {
    id: entry.id,
    body: '备份中的正文\n' + imported.data.markdown,
    expectedRevision: entry.revision,
    requestId: crypto.randomUUID(),
  });
  expect(withImage.ok).toBe(true);
  await page.locator('#manage-images').click();
  await page.locator('#asset-query').fill(imported.data.path);
  await page.locator('#refresh-assets').click();
  const card = page.locator('.asset-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('仍有引用');
  await card.locator('summary').click();
  await expect(card).toContainText('历史');
  await card.getByText('预览图片', { exact: true }).click();
  await expect(card.locator('img')).toBeVisible();
  expect(
    await card
      .locator('img')
      .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
  ).toBe(true);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `docs/screenshots/maintenance-${info.project.name}-images.png` });
  await page.locator('#manage-backups').click();
  await page.locator('#create-backup').click();
  await expect(page.locator('#maintenance-message')).toContainText('备份已生成', {
    timeout: 20000,
  });
  const first = page.locator('#backup-list .manage-row').first();
  await first.getByText('校验与查看清单', { exact: true }).click();
  await expect(page.locator('#backup-inspection')).toContainText('完整性校验通过');
  const downloadPromise = page.waitForEvent('download');
  await first.getByText('下载备份', { exact: true }).click();
  const downloaded = await downloadPromise;
  const file = await downloaded.path();
  expect(file).toBeTruthy();
  await page.locator('#import-backup').setInputFiles(file!);
  await expect(page.locator('#maintenance-message')).toContainText('导入校验通过', {
    timeout: 20000,
  });
  const changed = await api('update', {
    id: entry.id,
    body: '备份之后的新版本',
    expectedRevision: withImage.data.revision,
    requestId: crypto.randomUUID(),
  });
  expect(changed.ok).toBe(true);
  await generatePlan(
    page,
    page.locator('#backup-list .manage-row').first().getByText('预览恢复', { exact: true }),
  );
  await expect(page.locator('#plan-files')).toContainText('src/content/' + entry.id + '.md');
  await page
    .locator('#plan-files details')
    .filter({ hasText: 'src/content/' + entry.id + '.md' })
    .locator('summary')
    .click();
  await expect(page.locator('#plan-files')).toContainText('备份之后的新版本');
  await expect(page.locator('#plan-files')).toContainText('备份中的正文');
  await confirmPlan(page);
  expect((await api('read', { id: entry.id })).data.body).toContain('备份中的正文');
  // A stale plan must never silently overwrite a subsequent Hermes edit.
  await generatePlan(
    page,
    page.locator('#backup-list .manage-row').first().getByText('预览恢复', { exact: true }),
  );
  const current = (await api('read', { id: entry.id })).data;
  expect(
    (
      await api('update', {
        id: entry.id,
        body: '最后一次外部修改',
        expectedRevision: current.revision,
        requestId: crypto.randomUUID(),
      })
    ).ok,
  ).toBe(true);
  // Zero-change plans cannot be applied in the UI; exercise the same public core route for stale protection.
  const planned = await api('plan', {
    kind: 'restore',
    backupId: (await api('backups')).data[0].backupId,
    requestId: crypto.randomUUID(),
  });
  const again = (await api('read', { id: entry.id })).data;
  await api('update', {
    id: entry.id,
    body: '后续内容不能覆盖',
    expectedRevision: again.revision,
    requestId: crypto.randomUUID(),
  });
  await generatePlan(
    page,
    page.locator('#backup-list .manage-row').first().getByText('预览恢复', { exact: true }),
  );
  const last = (await api('read', { id: entry.id })).data;
  await api('update', {
    id: entry.id,
    body: '并发修改最终版',
    expectedRevision: last.revision,
    requestId: crypto.randomUUID(),
  });
  await page.locator('#confirm-plan').check();
  await page.locator('#apply-plan').click();
  await expect(page.locator('#maintenance-message')).toContainText('PLAN_STALE');
  expect((await api('read', { id: entry.id })).data.body).toContain('并发修改最终版');
  expect(
    (
      await api('apply', {
        planId: planned.data.planId,
        expectedPlan: planned.data.expectedPlan,
        confirm: true,
        requestId: crypto.randomUUID(),
      })
    ).error.code,
  ).toBe('PLAN_STALE');
  await page.locator('#plan-panel').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `docs/screenshots/maintenance-${info.project.name}-plan-light.png`,
  });
  await page.locator('#theme').click();
  await page.locator('#plan-panel').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/screenshots/maintenance-${info.project.name}-plan-dark.png`,
  });
  expect(errors).toEqual([]);
});
