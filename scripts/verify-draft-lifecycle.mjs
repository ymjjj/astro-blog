// 实际验证“发布过又撤回”的图片不会残留，不通过静态读代码推断安全性。
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const file = join(root, 'src/content/posts/unpublished-test.md');
const original = await readFile(file, 'utf8');
const run = (args) => {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BLOG_BASE: '/', BLOG_SITE: 'https://example.com' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
};
async function scan(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const filePath = join(dir, item.name);
    if (item.isDirectory()) {
      if (await scan(filePath)) return true;
    } else if ((await readFile(filePath)).includes(Buffer.from('DRAFT_SECRET_ASSET_7c92')))
      return true;
  }
  return false;
}
try {
  await writeFile(file, original.replace('draft: true', 'draft: false'));
  run(['node_modules/astro/bin/astro.mjs', 'build', '--force']);
  assert(await scan(join(root, 'dist')), '阳性对照失败：发布时应该包含该图片');
} finally {
  await writeFile(file, original);
  run(['node_modules/astro/bin/astro.mjs', 'build', '--force']);
}
assert(!(await scan(join(root, 'dist'))), '撤回后图片仍然公开');
run(['scripts/verify-build.mjs']);
await mkdir(join(root, 'docs/validation'), { recursive: true });
const result = {
  checkedAt: new Date().toISOString(),
  publishedImageWasPresent: true,
  withdrawnImageAbsent: true,
  originalDraftRestored: true,
  allPublicOutputsVerified: true,
};
await writeFile(
  join(root, 'docs/validation/draft-lifecycle.json'),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
