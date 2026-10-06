import { test, expect, type Page } from '@playwright/test';
async function start(page: Page) {
  await page.goto('/');
  await expect(page.locator('#setup-notice')).toContainText('已读取');
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
async function openEntry(page: Page, title: string) {
  await page.reload();
  await expect(page.locator('#setup-notice')).toContainText('已读取');
  await page.locator('#query').fill(title);
  await page.locator('#entries .entry').filter({ hasText: title }).click();
  await expect(page.locator('#editor-heading')).toContainText(title);
}
async function shots(page: Page, name: string) {
  const focus = name.endsWith('review') ? '#review-panel' : '#setup-panel';
  await page.locator(focus).evaluate((e) => e.scrollIntoView({ block: 'start' }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `docs/screenshots/publish-${name}-light.png`, scale: 'css' });
  await page.locator('#theme').click();
  await page.locator(focus).evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `docs/screenshots/publish-${name}-dark.png`, scale: 'css' });
}
test('配置向导检查保存、过期版本保护、深浅主题与手机布局', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const api = await start(page);
  await page.locator('#setup-panel').evaluate((e: HTMLDetailsElement) => (e.open = true));
  await page.locator('#setup-repository').fill('example/astro-blog');
  await page.locator('#setup-site').fill('https://example.github.io');
  await page.locator('#setup-base').fill('/astro-blog/');
  await page.locator('#check-setup').click();
  await expect(page.locator('#setup-notice')).toContainText('尚未保存');
  await page.locator('#save-setup').click();
  await expect(page.locator('#setup-notice')).toContainText('已保存到本机');
  await expect(page.locator('#publish')).toBeDisabled();
  await expect(page.locator('#withdraw')).toBeDisabled();
  const state = (await api('setup')).data;
  const external = await api('configure', {
    target: { ...state.target, base: '/' },
    expectedConfig: state.revision,
    requestId: crypto.randomUUID(),
  });
  expect(external.ok).toBe(true);
  await page.locator('#setup-base').fill('/stale/');
  await page.locator('#save-setup').click();
  await expect(page.locator('#publish-feedback')).toContainText('CONFIG_CONFLICT');
  expect((await api('setup')).data.target.base).toBe('/');
  await page.locator('#reload-setup').click();
  await expect(page.locator('#setup-base')).toHaveValue('/');
  await page.locator('#setup-base').fill('/astro-blog/');
  await page.locator('#save-setup').click();
  await expect(page.locator('#setup-notice')).toContainText('已保存到本机');
  await shots(page, info.project.name + '-setup');
  expect(errors).toEqual([]);
});
test('修改预览、完整隔离检查、演练任务与内容保持不变', async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const api = await start(page),
    title = '发布中心验收 ' + crypto.randomUUID();
  const e = (
    await api('create', {
      kind: 'moments',
      title,
      body: '这一段仍然保留为本地草稿。',
      requestId: crypto.randomUUID(),
    })
  ).data;
  await openEntry(page, title);
  await page.locator('#pending-panel summary').click();
  await page.locator('#pending-query').fill(title);
  await page.locator('#refresh-pending').click();
  await expect(page.locator('#pending-list .manage-row')).toHaveCount(1);
  await page.locator('#pending-list button').click();
  await expect(page.locator('#review-notice')).toContainText('检查通过');
  await page.locator('#review-panel summary').first().click();
  await expect(page.locator('#review-diff')).toContainText('draft: false');
  await expect(page.locator('#review-diff')).toContainText('这一段');
  await page.locator('#build-preflight').click();
  await expect(page.locator('#publish-feedback')).toContainText('完整检查通过', { timeout: 60000 });
  await expect(page.locator('#review-checks')).toContainText('产物扫描通过');
  await shots(page, info.project.name + '-review');
  const settings = (await api('setup')).data;
  expect(
    (
      await api('configure', {
        target: { ...settings.target, base: '/changed/' },
        expectedConfig: settings.revision,
        requestId: crypto.randomUUID(),
      })
    ).ok,
  ).toBe(true);
  await page.locator('#simulate').click();
  await expect(page.locator('#publish-feedback')).toContainText('REVIEW_STALE');
  const changed = (await api('setup')).data;
  await api('configure', {
    target: settings.target,
    expectedConfig: changed.revision,
    requestId: crypto.randomUUID(),
  });
  await page.locator('#inspect-publish').click();
  await expect(page.locator('#publish-feedback')).toContainText('快速检查通过');
  await page.locator('#simulate').click();
  await expect(page.locator('#publish-feedback')).toContainText('演练通过', { timeout: 60000 });
  const job = page.locator('#jobs .job').filter({ hasText: e.id }).first();
  await expect(job).toContainText('演练通过（未上线）');
  await job.locator('summary').click();
  await expect(job).toContainText('送检版本');
  await expect(job.locator('a')).toHaveCount(0);
  const after = (await api('read', { id: e.id })).data;
  expect(after.revision).toBe(e.revision);
  expect(after.data.draft).toBe(true);
  await page.locator('#review-action').selectOption('withdraw');
  await expect(page.locator('#simulate')).toHaveText('演练撤回');
  await page.locator('#inspect-publish').click();
  await expect(page.locator('#review-notice')).toContainText('撤回预览');
  await expect(page.locator('#review-diff')).toContainText('draft: true');
  await page.locator('#job-filter').selectOption('failed');
  await expect(page.locator('#jobs')).not.toContainText(e.id);
  expect(errors).toEqual([]);
});
test('损坏链接演练失败、展示处理建议并读取修复后版本重新检查', async ({ page }, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const api = await start(page),
    title = '失败处理验收 ' + crypto.randomUUID();
  const e = (
    await api('create', {
      kind: 'moments',
      title,
      body: '[坏链接](/missing-center-test/)',
      requestId: crypto.randomUUID(),
    })
  ).data;
  await openEntry(page, title);
  await page.locator('#simulate').click();
  await expect(page.locator('#publish-feedback')).toContainText('VERIFY_FAILED', {
    timeout: 60000,
  });
  const job = page.locator('#jobs .job').filter({ hasText: e.id }).first();
  await expect(job).toContainText('失败');
  await job.locator('summary').click();
  await expect(job).toContainText('不要把失败演练当作上线');
  await expect(job).toContainText('失败前阶段：检查中');
  await expect(job.locator('a')).toHaveCount(0);
  await job.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({
    path: `docs/screenshots/publish-${info.project.name}-failure.png`,
    scale: 'css',
  });
  expect((await api('read', { id: e.id })).data.revision).toBe(e.revision);
  expect(
    (
      await api('update', {
        id: e.id,
        expectedRevision: e.revision,
        body: '链接已经修复',
        requestId: crypto.randomUUID(),
      })
    ).ok,
  ).toBe(true);
  await job.getByRole('button', { name: '读取当前内容并重新检查' }).click();
  await expect(page.locator('#body')).toHaveValue(/链接已经修复/);
  await expect(page.locator('#review-notice')).toContainText('检查通过');
  expect(errors).toEqual([]);
});
