import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const suffix = (process.env.BLOG_BASE || '/') === '/' ? 'root' : 'subpath';
test('主要页面、图片和布局可用', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const routes = [
    '',
    'posts/',
    'posts/static-garden/',
    'moments/',
    'moments/afternoon/',
    'tags/',
    'tags/' + encodeURIComponent('学习笔记') + '/',
    'archives/',
    'about/',
    'search/',
    '404.html',
  ];
  await mkdir('docs/screenshots', { recursive: true });
  for (const route of routes) {
    const response = await page.goto(route ? './' + route : './');
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator('main h1')).toHaveCount(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    const images = page.locator('img');
    for (let i = 0; i < (await images.count()); i++) {
      await expect(images.nth(i)).toBeVisible();
      await images.nth(i).scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          images.nth(i).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
        )
        .toBeTruthy();
    }
    if (['', 'posts/static-garden/', 'moments/'].includes(route))
      await page.screenshot({
        path: `docs/screenshots/${suffix}-${info.project.name}-${route === '' ? 'home' : route.startsWith('posts') ? 'article' : 'moments'}.png`,
        fullPage: true,
      });
  }
  expect(errors).toEqual([]);
});
test('中文正文与标签搜索、空结果、清空、分享查询和失败提示', async ({ page }) => {
  await page.goto('./search/');
  const query = page.getByRole('searchbox');
  await query.fill('笔记');
  await expect(page.locator('#search-results li').first()).toBeVisible();
  await expect(page.locator('#search-status')).toContainText('找到');
  await query.fill('DRAFT_SECRET');
  await expect(page.locator('#search-status')).toContainText('还没有找到');
  await query.fill('完全不存在的关键词');
  await expect(page.locator('#search-results li')).toHaveCount(0);
  await page.getByRole('button', { name: '清空' }).click();
  await expect(query).toHaveValue('');
  await page.goto('./search/?q=' + encodeURIComponent('留白'));
  await expect(page.locator('#search-results')).toContainText('留白，是页面里的呼吸');
  await page.locator('#search-results a').first().click();
  await expect(page.locator('main h1')).toContainText('留白');
  await page.route('**/search-index.json', (route) => route.abort());
  await page.goto('./search/?q=' + encodeURIComponent('笔记'));
  await expect(page.locator('#search-status')).toContainText('无法读取');
});
test('明暗主题持久化、目录跳转、公式与无标题动态', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./');
  await page.getByRole('button', { name: '切换明暗主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({
    path: `docs/screenshots/${suffix}-${info.project.name}-dark.png`,
    fullPage: true,
  });
  await page.goto('./posts/static-garden/');
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.locator('pre.astro-code')).toBeVisible();
  const toc = page.locator('.toc a').first();
  const hash = await toc.getAttribute('href');
  await toc.click();
  expect(decodeURIComponent(new URL(page.url()).hash)).toBe(hash);
  await expect
    .poll(async () =>
      page
        .locator(`[id="${hash!.slice(1)}"]`)
        .evaluate((el) => Math.round(el.getBoundingClientRect().top)),
    )
    .toBeLessThan(160);
  await page.goto('./moments/afternoon/');
  await expect(page.locator('main h1')).toContainText('碎碎念');
  await expect(page.locator('.moment-card')).toBeVisible();
  await page.locator('.moment-card .tags a').first().click();
  await expect(page.locator('main h1')).toContainText('#');
});
test('无 JavaScript 仍可阅读正文和导航', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(new URL('posts/static-garden/', baseURL).href);
  await expect(page.locator('.prose h2').first()).toBeVisible();
  await expect(page.locator('#theme-toggle')).toBeHidden();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '碎碎念' })
    .click();
  await expect(page.locator('.timeline')).toBeVisible();
  await context.close();
});
test('草稿地址不存在，写作练习进入列表与订阅源', async ({ page, request }) => {
  for (const route of ['posts/unpublished-test/', 'moments/unpublished-moment/']) {
    expect((await request.get('./' + route)).status()).toBe(404);
  }
  await page.goto('./posts/first-publish/');
  await expect(page.locator('main h1')).toHaveText('第一次发布练习');
  await page.goto('./moments/small-discovery/');
  await expect(page.locator('.moment-card')).toContainText('今天的发布练习完成了');
  const rss = await request.get('./rss.xml');
  expect(rss.ok()).toBeTruthy();
  expect(await rss.text()).toContain('第一次发布练习');
  expect(await rss.text()).not.toContain('DRAFT_SECRET');
});
