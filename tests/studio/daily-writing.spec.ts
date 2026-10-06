import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('创建响应丢失后恢复重试不重复发文，服务端恢复副本可跨浏览器读取', async ({
  page,
  context,
  browser,
}) => {
  const api = await connect(page);
  const title = '丢失响应 ' + crypto.randomUUID();
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (args[0] === '/api/create') {
        window.fetch = original;
        throw new TypeError('模拟响应丢失');
      }
      return response;
    };
  });
  await page.locator('#title').fill(title);
  await page.locator('#description').fill('请求只创建一次');
  await page.locator('#body').fill('第一次输入');
  await page.locator('#save').click();
  await expect(page.locator('#message')).toContainText('模拟响应丢失');
  expect((await api('list', { query: title })).data).toHaveLength(1);
  await page.close();
  const reopened = await context.newPage();
  const resumedApi = await connect(reopened);
  await reopened
    .locator('.recovery-item')
    .filter({ hasText: title })
    .getByText('恢复编辑', { exact: true })
    .click();
  await expect(reopened.locator('#save-state')).toContainText('已自动保存', { timeout: 12000 });
  expect((await resumedApi('list', { query: title })).data).toHaveLength(1);
  const serverTitle = '本机持久恢复 ' + crypto.randomUUID();
  await resumedApi('checkpoint', {
    sessionId: crypto.randomUUID(),
    expectedVersion: null,
    id: null,
    baseRevision: null,
    requestId: crypto.randomUUID(),
    form: {
      kind: 'posts',
      slug: '',
      title: serverTitle,
      description: '',
      date: '',
      updated: '',
      tags: '',
      body: '未完成但需要找回',
    },
  });
  const isolated = await browser.newContext();
  try {
    const fresh = await isolated.newPage();
    await connect(fresh);
    await fresh
      .locator('.recovery-item')
      .filter({ hasText: serverTitle })
      .getByText('恢复编辑', { exact: true })
      .click();
    await expect(fresh.locator('#body')).toHaveValue('未完成但需要找回');
  } finally {
    await isolated.close();
  }
});

async function connect(page: Page) {
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
test('自动保存、外部冲突比较、版本恢复与移动端布局', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const api = await connect(page);
  await page.locator('#kind').selectOption('moments');
  await page.locator('#body').fill('自动保存第一版 ' + info.project.name);
  await expect(page.locator('#save-state')).toContainText('已自动保存', { timeout: 12000 });
  const id = 'moments/' + (await page.locator('#slug').inputValue());
  const first = (await api('read', { id })).data;
  expect(first.data.draft).toBe(true);
  await page.locator('#body').fill('自动保存第二版');
  await expect(page.locator('#save-state')).toContainText('已自动保存', { timeout: 12000 });
  await page.locator('#load-history').click();
  await page.locator('#history-version').selectOption(first.revision);
  await page.locator('#compare-version').click();
  await expect(page.locator('#version-diff')).toContainText('自动保存第二版');
  await expect(page.locator('#version-diff')).toContainText('自动保存第一版');
  page.once('dialog', (d) => d.accept());
  await page.locator('#restore-version').click();
  await expect(page.locator('#body')).toHaveValue(/自动保存第一版/);
  const before = (await api('read', { id })).data;
  expect(
    (
      await api('update', {
        id,
        body: 'Hermes 外部修改',
        expectedRevision: before.revision,
        requestId: crypto.randomUUID(),
      })
    ).ok,
  ).toBe(true);
  await page.locator('#body').fill('浏览器尚未合并的修改');
  await expect(page.locator('#conflict-panel')).toBeVisible({ timeout: 12000 });
  expect((await api('read', { id })).data.body).toContain('Hermes 外部修改');
  await expect(page.locator('#body')).toHaveValue('浏览器尚未合并的修改');
  await page.locator('#compare-external').click();
  await expect(page.locator('#external-content')).toContainText('Hermes 外部修改');
  await page.locator('#body').fill('Hermes 外部修改\n浏览器合并后的修改');
  page.once('dialog', (d) => d.accept());
  await page.locator('#accept-merge').click();
  await expect(page.locator('#message')).toContainText('已保存');
  expect((await api('read', { id })).data.body).toContain('浏览器合并后的修改');
  await page.locator('#load-history').click();
  await page.locator('#history-version').selectOption(first.revision);
  await page.locator('#compare-version').click();
  await page.locator('#version-diff').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `docs/screenshots/daily-${info.project.name}-history-light.png` });
  await page.locator('#theme').click();
  await page.locator('#version-diff').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `docs/screenshots/daily-${info.project.name}-history-dark.png` });
  expect(errors).toEqual([]);
});

test('误关恢复不完整新稿，迟到的自动保存响应不覆盖新输入', async ({ page, context }) => {
  await connect(page);
  const title = '误关时尚未完成的文章 ' + crypto.randomUUID();
  await page.locator('#title').fill(title);
  await page.locator('#body').fill('未填写摘要也需要找回');
  // Close before the debounce fires: only the synchronous browser recovery copy exists.
  await page.close();
  const reopened = await context.newPage();
  await connect(reopened);
  await expect(reopened.locator('#recovery-panel')).toContainText(title);
  await reopened
    .locator('.recovery-item')
    .filter({ hasText: title })
    .getByText('恢复编辑', { exact: true })
    .click();
  await expect(reopened.locator('#body')).toHaveValue('未填写摘要也需要找回');
  await expect(reopened.locator('#save-state')).toContainText('恢复副本已保存', { timeout: 10000 });
  await reopened.locator('#description').fill('补全摘要');
  await expect(reopened.locator('#save-state')).toContainText('已自动保存', { timeout: 10000 });
  await reopened.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (args[0] === '/api/autosave') {
        window.fetch = original;
        await new Promise<void>((resolve) => {
          (window as any).releaseSave = resolve;
        });
      }
      return response;
    };
  });
  await reopened.locator('#body').fill('请求中的版本');
  await reopened.waitForFunction(() => typeof (window as any).releaseSave === 'function');
  await reopened.locator('#body').fill('请求返回前继续输入的新版本');
  await reopened.evaluate(() => (window as any).releaseSave());
  await expect(reopened.locator('#body')).toHaveValue('请求返回前继续输入的新版本');
  await expect(reopened.locator('#save-state')).toContainText('已自动保存', { timeout: 15000 });
  const id = 'posts/' + (await reopened.locator('#slug').inputValue());
  const result = await reopened.evaluate(async (id) => {
    const token = document.querySelector<HTMLMetaElement>('meta[name=studio-token]')!.content;
    return (
      await fetch('/api/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token },
        body: JSON.stringify({ id }),
      })
    ).json();
  }, id);
  expect(result.data.body).toContain('请求返回前继续输入的新版本');
});

test('图片粘贴、多图拖拽和取消操作共用图片导入', async ({ page }) => {
  await connect(page);
  await page.locator('#kind').selectOption('moments');
  await page.locator('#body').fill('图片日记');
  await page.locator('#save').click();
  await expect(page.locator('#message')).toContainText('已保存');
  const bytes = (await readFile('public/media/blue-notebook-sketch-small.webp')).toString('base64');
  page.on('dialog', (d) => d.accept('手账配图'));
  async function send(type: string, count: number) {
    await page.locator('#body').evaluate(
      (el, { type, count, bytes }) => {
        const raw = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
        const transfer = new DataTransfer();
        for (let i = 0; i < count; i++)
          transfer.items.add(new File([raw], `sketch-${i}.webp`, { type: 'image/webp' }));
        el.dispatchEvent(
          type === 'paste'
            ? new ClipboardEvent('paste', {
                clipboardData: transfer,
                bubbles: true,
                cancelable: true,
              })
            : new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
        );
      },
      { type, count, bytes },
    );
  }
  await send('paste', 1);
  await expect(page.locator('#body')).toHaveValue(/!\[手账配图\]/);
  await expect(page.locator('#message')).toContainText('已插入 1 张');
  await send('drop', 2);
  await expect(page.locator('#message')).toContainText('已插入 2 张');
  expect((await page.locator('#body').inputValue()).match(/!\[手账配图\]/g)).toHaveLength(3);
  await expect(page.locator('#save-state')).toContainText('已自动保存', { timeout: 12000 });
  page.removeAllListeners('dialog');
  page.once('dialog', (d) => d.dismiss());
  await send('paste', 1);
  await expect(page.locator('#message')).toContainText('已插入 0 张');
  expect((await page.locator('#body').inputValue()).match(/!\[手账配图\]/g)).toHaveLength(3);
});
