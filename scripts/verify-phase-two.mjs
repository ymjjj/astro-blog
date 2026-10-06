import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const evidence = resolve(root, 'docs/validation');
const file = resolve(root, 'src/content/posts/markdown-notes.md');
const original = await readFile(file, 'utf8');
const env = { ...process.env, BLOG_SITE: 'https://example.com', BLOG_BASE: '/' };
const run = (args) =>
  spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 120000 });
await mkdir(evidence, { recursive: true });
try {
  await writeFile(file, original.replace(/^updated:.*$/m, "updated: '2020-01-01T00:00:00+08:00'"));
  const invalid = run(['node_modules/astro/bin/astro.mjs', 'build', '--force']);
  await writeFile(resolve(evidence, 'phase2-invalid-updated.log'), invalid.stdout + invalid.stderr);
  assert.notEqual(invalid.status, 0, '早于发布日期的 updated 必须使构建失败');
  assert(
    (invalid.stdout + invalid.stderr).includes('updated 不能早于 date'),
    '必须给出明确的字段错误',
  );
} finally {
  await writeFile(file, original);
}
// 即使指定 development mode，实际命令仍为 build，不得生成草稿。
const production = run([
  'node_modules/astro/bin/astro.mjs',
  'build',
  '--force',
  '--mode',
  'development',
]);
await writeFile(
  resolve(evidence, 'phase2-development-mode-build.log'),
  production.stdout + production.stderr,
);
assert.equal(production.status, 0, production.stdout + production.stderr);
const verify = run(['scripts/verify-build.mjs']);
assert.equal(verify.status, 0, verify.stdout + verify.stderr);
await writeFile(
  resolve(evidence, 'phase2-guardrails.json'),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      invalidUpdatedRejected: true,
      sourceRestored: true,
      developmentModeBuildExcludesDrafts: true,
    },
    null,
    2,
  ),
);
console.log('更新时间非法值拒绝、源文件恢复、development mode 构建隔离：PASS');
