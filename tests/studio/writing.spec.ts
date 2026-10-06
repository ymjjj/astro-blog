import { test, expect } from '@playwright/test';
test('工作台完成写稿、配图、保存预览、演练发布与冲突保护', async ({ page, request }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#entries .entry').first()).toBeVisible();
  await page.locator('#new').click();
  await page.locator('#kind').selectOption('moments');
  await expect(page.locator('#title')).not.toHaveAttribute('required', '');
  await expect(page.locator('#description-field')).toBeHidden();
  await page
    .locator('#body')
    .fill('今天把小小的念头，放进自己的手记里。\n\n窗边有猫，也有新的开始。');
  await page.locator('#save').click();
  await expect(page.locator('#message')).toContainText('仍是草稿');
  const slug = await page.locator('#slug').inputValue();
  const id = 'moments/' + slug;
  page.once('dialog', (dialog) => dialog.accept('窗边的小作家与白猫'));
  await page.locator('#image').setInputFiles('public/media/blue-notebook-small.webp');
  await expect(page.locator('#body')).toContainText('');
  await expect(page.locator('#message')).toContainText('图片已导入');
  await expect(page.locator('#body')).toHaveValue(/src|assets/);
  await page.locator('#preview').click();
  await expect(page.locator('.preview-panel')).toBeVisible({ timeout: 20000 });
  const preview = page.frameLocator('#preview-frame');
  await expect(preview.locator('.draft-banner')).toBeVisible({ timeout: 30000 });
  await expect(preview.locator('.moment-prose')).toContainText('窗边有猫');
  await page.locator('#preview-frame').scrollIntoViewIfNeeded();
  await preview.locator('.prose img').evaluate((el) => el.scrollIntoView({ behavior: 'instant' }));
  await expect
    .poll(() =>
      preview
        .locator('.prose img')
        .evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
    )
    .toBeTruthy();
  await page.locator('#check').click();
  await expect(page.locator('#message')).toContainText('检查通过');
  await page.locator('#simulate').click();
  await expect(page.locator('#jobs .job').filter({ hasText: id })).toContainText(
    '演练通过（未上线）',
    { timeout: 45000 },
  );
  await expect(page.locator('#simulate')).toBeEnabled();
  await expect(page.locator('#publish')).toBeDisabled();
  const token = await page.locator('meta[name=studio-token]').getAttribute('content');
  const headers = { 'X-Studio-Token': token! };
  const read = await (await request.post('/api/read', { headers, data: { id } })).json();
  expect(read.data.data.draft).toBeTruthy();
  const update = await request.post('/api/update', {
    headers,
    data: {
      id,
      body: '外部 Agent 写下的新内容',
      expectedRevision: read.data.revision,
      requestId: crypto.randomUUID(),
    },
  });
  expect(update.ok()).toBeTruthy();
  await page.locator('#body').fill('工作台里的旧版本');
  await page.locator('#save').click();
  await expect(page.locator('#message')).toContainText('REVISION_CONFLICT');
  await expect(page.locator('#body')).toHaveValue('工作台里的旧版本');
  page.once('dialog', (d) => d.accept());
  await page.locator('#new').click();
  await page.locator('#query').fill('外部 Agent');
  await expect(
    page.locator('#entries .entry').filter({ hasText: '外部 Agent' }).first(),
  ).toBeVisible();
  await page.locator('#entries .entry').filter({ hasText: '外部 Agent' }).first().click();
  await expect(page.locator('#body')).toHaveValue(/外部 Agent/);
  await page
    .locator('#body')
    .fill('今天把小小的念头，放进自己的手记里。\n\n窗边有猫，也有新的开始。');
  await page.locator('#save').click();
  await expect(page.locator('#message')).toContainText('已保存');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({
    path: `docs/screenshots/daily-studio-${info.project.name}.png`,
    fullPage: true,
  });
  await page.locator('#theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({
    path: `docs/screenshots/daily-studio-${info.project.name}-dark.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
