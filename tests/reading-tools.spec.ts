import { test, expect } from '@playwright/test';
const suffix = (process.env.BLOG_BASE || '/') === '/' ? 'root' : 'subpath';

test('真实浏览器剪贴板能够复制完整代码', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./posts/static-garden/');
  const original = await page.locator('pre code').textContent();
  await page.getByRole('button', { name: '复制第 1 段代码' }).click();
  await expect(page.locator('.copy-code')).toHaveText('已复制');
  // Windows 系统剪贴板将 LF 规范化为 CRLF；比较内容时仅统一换行，不去掉空格或空行。
  expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n')).toBe(
    original,
  );
});

test('图片支持键盘、关闭按钮、Escape、背景关闭与焦点恢复', async ({ page }, info) => {
  await page.goto('./posts/static-garden/');
  await expect(page.locator('.skip-link')).not.toBeFocused();
  const trigger = page.getByRole('button', { name: /^放大图片/ }).first();
  const dialog = page.getByRole('dialog', { name: '图片查看器' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  const image = dialog.locator('img');
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBeTruthy();
  await expect(dialog.getByRole('button', { name: '关闭图片查看器' })).toBeFocused();
  expect(await page.locator('html').evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '关闭图片查看器' })).toBeFocused();
  await page.screenshot({
    path: `docs/screenshots/phase2-${suffix}-${info.project.name}-image.png`,
  });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('button', { name: '关闭图片查看器' }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.mouse.click(2, 2);
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.locator('html').evaluate((el) => getComputedStyle(el).overflow)).not.toBe(
    'hidden',
  );
  await page.goto('./moments/afternoon/');
  await page.getByRole('button', { name: /^放大图片/ }).click();
  await expect(dialog).toBeVisible();
});

test('复制代码成功时保留换行，失败时选中原文且不假报成功', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).__copiedCode = text;
        },
      },
    });
  });
  await page.goto('./posts/static-garden/');
  const code = await page.locator('pre code').first().textContent();
  const button = page.getByRole('button', { name: '复制第 1 段代码' });
  await button.click();
  await expect(button).toHaveText('已复制');
  expect(await page.evaluate(() => (window as any).__copiedCode)).toBe(code);
  await expect(page.locator('#copy-status')).toContainText('已复制');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    });
  });
  await button.click();
  await expect(button).toHaveText('请手动复制');
  await expect(page.locator('#copy-status')).toContainText('未能自动复制');
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(code);
});

test('目录随滚动更新，直接锚点和浏览器历史可定位，暗色工具可见', async ({ page }, info) => {
  await page.goto('./posts/static-garden/');
  const links = page.locator('.toc a');
  const last = links.last();
  const hash = await last.getAttribute('href');
  await expect(links.first()).toHaveAttribute('aria-current', 'location');
  await page.evaluate(() =>
    scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
  );
  await expect(last).toHaveAttribute('aria-current', 'location');
  await expect(page.locator('.toc [aria-current="location"]')).toHaveCount(1);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await expect(links.first()).toHaveAttribute('aria-current', 'location');
  await last.click();
  await expect(last).toHaveAttribute('aria-current', 'location');
  await page.reload();
  await expect(last).toHaveAttribute('aria-current', 'location');
  expect(decodeURIComponent(new URL(page.url()).hash)).toBe(hash);
  await page.goto('./posts/static-garden/');
  await links.first().click();
  await last.click();
  await page.goBack();
  await expect(links.first()).toHaveAttribute('aria-current', 'location');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.copy-code').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/screenshots/phase2-${suffix}-${info.project.name}-reading-dark.png`,
  });
  await page
    .getByRole('button', { name: /^放大图片/ })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({
    path: `docs/screenshots/phase2-${suffix}-${info.project.name}-image-dark.png`,
  });
});

test('更新时间可选，列表、详情、SEO 和 sitemap 一致，排序不受更新影响', async ({
  page,
  request,
}) => {
  await page.goto('./posts/markdown-notes/');
  await expect(page.locator('.article-heading .updated-date')).toContainText('更新于');
  await expect(page.locator('.updated-date time')).toHaveAttribute(
    'datetime',
    '2026-09-26T08:00:00.000Z',
  );
  await expect(page.locator('meta[property="article:modified_time"]')).toHaveAttribute(
    'content',
    '2026-09-26T08:00:00.000Z',
  );
  await page.goto('./posts/static-garden/');
  await expect(page.locator('.updated-date')).toHaveCount(0);
  await expect(page.locator('meta[property="article:modified_time"]')).toHaveCount(0);
  await page.goto('./posts/');
  await expect(page.locator('.post-card').first()).toContainText('把想法种在自己的小站里');
  await expect(
    page
      .locator('.post-card')
      .filter({ hasText: 'Markdown 笔记，从记录到整理' })
      .locator('.updated-date'),
  ).toContainText('更新');
  const xml = await (await request.get('./sitemap.xml')).text();
  expect(xml).toMatch(/posts\/markdown-notes\/<\/loc><lastmod>2026-09-26T08:00:00.000Z<\/lastmod>/);
});

test('生产环境不存在草稿入口或索引，禁用脚本不出现无效工具', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  await page.goto('./');
  await expect(page.getByRole('link', { name: '草稿箱', exact: true })).toHaveCount(0);
  expect((await request.get('./drafts/')).status()).toBe(404);
  for (const path of ['search-index.json', 'rss.xml', 'sitemap.xml']) {
    const text = await (await request.get('./' + path)).text();
    expect(text).not.toContain('草稿练习');
    expect(text).not.toContain('unpublished');
  }
  const context = await browser.newContext({ javaScriptEnabled: false });
  const plain = await context.newPage();
  await plain.goto(new URL('posts/static-garden/', baseURL).href);
  await expect(plain.locator('.prose img')).toBeVisible();
  await expect(plain.locator('.prose pre')).toBeVisible();
  await expect(plain.locator('.image-zoom, .copy-code')).toHaveCount(0);
  await context.close();
});
