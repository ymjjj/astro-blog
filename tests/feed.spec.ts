import { test, expect } from '@playwright/test';
test('主页平行混排、正文图片可查看、跨页无重复且按时间排序', async ({ page, request }, info) => {
  await page.goto('./');
  const first = page.locator('.feed-entry');
  await expect(first).toHaveCount(6);
  expect(await first.locator('.compact').count()).toBe(0);
  await expect(page.locator('.feed-entry[data-kind=posts] h3').first()).toBeVisible();
  const dates = await first.evaluateAll((els) => els.map((el) => el.getAttribute('data-date')!));
  const ids = await first.evaluateAll((els) => els.map((el) => el.getAttribute('data-entry-id')));
  const moments = page.locator('.feed-entry[data-kind=moments]');
  await expect(moments.first().locator('.moment-prose')).toBeVisible();
  const image = page.locator('.feed-entry .image-zoom');
  await expect(image.first()).toBeVisible();
  await image.first().click();
  await expect(page.locator('#image-viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await page
    .getByRole('navigation', { name: '分页导航' })
    .getByRole('link', { name: '下一页' })
    .click();
  await expect(page.locator('.feed-entry')).toHaveCount(2);
  await expect(page.locator('h1')).toHaveText('继续翻翻日常手记');
  dates.push(
    ...(await page
      .locator('.feed-entry')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-date')!))),
  );
  ids.push(
    ...(await page
      .locator('.feed-entry')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-entry-id')))),
  );
  expect(new Set(ids).size).toBe(8);
  expect(dates).toEqual([...dates].sort().reverse());
  expect((await request.get('./page/3/')).status()).toBe(404);
  await page.getByRole('link', { name: '上一页' }).click();
  await expect(page.locator('.hero-art img')).toBeVisible();
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({
    path: `docs/screenshots/phase3-${process.env.BLOG_BASE === '/' ? 'root' : 'subpath'}-${info.project.name}-home.png`,
    fullPage: true,
  });
});
