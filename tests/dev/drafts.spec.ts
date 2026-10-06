import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
test('草稿文章、无标题动态和专用图片仅在本地可读，编辑后即时更新', async ({
  page,
  request,
}, info) => {
  await page.goto('./');
  await page.getByRole('link', { name: '草稿箱', exact: true }).click();
  await expect(page.locator('main h1')).toContainText('还在酝酿');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByRole('link', { name: '一篇还在整理的笔记' }).click();
  await expect(page.getByLabel('草稿预览提示')).toContainText('仅本地预览');
  await expect(page.locator('.prose img')).toBeVisible();
  await page.locator('.prose img').scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page
        .locator('.prose img')
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    )
    .toBeTruthy();
  await expect(page.locator('.copy-code')).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({
    path: `docs/screenshots/phase2-dev-${info.project.name}-draft.png`,
    fullPage: true,
  });
  const file = 'src/content/posts/unpublished-test.md';
  const original = await readFile(file, 'utf8');
  try {
    await writeFile(file, original + '\nDRAFT_SECRET_HOT_RELOAD_83aa\n');
    await expect
      .poll(async () =>
        (await (await request.get('./posts/unpublished-test/')).text()).includes(
          'DRAFT_SECRET_HOT_RELOAD_83aa',
        ),
      )
      .toBeTruthy();
  } finally {
    await writeFile(file, original);
  }
  await expect
    .poll(async () =>
      (await (await request.get('./posts/unpublished-test/')).text()).includes(
        'DRAFT_SECRET_HOT_RELOAD_83aa',
      ),
    )
    .toBeFalsy();
  await page.goto('./moments/unpublished-moment/');
  await expect(page.getByLabel('草稿预览提示')).toBeVisible();
  await expect(page.locator('main h1')).toContainText('碎碎念');
  for (const path of [
    '',
    'posts/',
    'moments/',
    'archives/',
    'tags/',
    'search-index.json',
    'rss.xml',
    'sitemap.xml',
  ]) {
    const text = await (await request.get('./' + path)).text();
    expect(text).not.toContain('DRAFT_SECRET_');
    expect(text).not.toContain('一篇还在整理的笔记');
    expect(text).not.toContain('草稿练习');
  }
});
