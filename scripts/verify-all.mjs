import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const evidence = resolve(root, 'docs/validation');
await mkdir(evidence, { recursive: true });
const results = [];
async function run(name, args, env) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 180000,
  });
  await writeFile(
    resolve(evidence, `${name}.log`),
    (result.stdout + result.stderr).replace(/\x1b\[[0-9;]*m/g, ''),
  );
  assert.equal(result.status, 0, `${name} 失败：${result.stdout}\n${result.stderr}`);
  results.push({ name, exitCode: result.status, durationMs: Date.now() - started });
  console.log(`${name}: PASS`);
}
const common = { BLOG_SITE: 'https://example.com', BLOG_BASE: '/' };
await run('typecheck', ['node_modules/astro/bin/astro.mjs', 'check'], common);
// 先子路径再根路径，结束后 dist 可用默认 preview 打开。
for (const [name, base] of [
  ['subpath', '/astro-blog'],
  ['root', '/'],
]) {
  const env = { ...common, BLOG_BASE: base };
  await run(
    `${name}-dev-browser`,
    ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.dev.config.ts'],
    env,
  );
  await copyFile(
    resolve(evidence, 'phase2-dev-browser.json'),
    resolve(evidence, `${name}-dev-browser-results.json`),
  );
  await run(`${name}-build`, ['node_modules/astro/bin/astro.mjs', 'build', '--force'], env);
  await run(`${name}-verify`, ['scripts/verify-build.mjs'], env);
  await run(`${name}-browser`, ['node_modules/@playwright/test/cli.js', 'test'], env);
  await copyFile(
    resolve(evidence, 'browser-results.json'),
    resolve(evidence, `${name}-browser-results.json`),
  );
}
await writeFile(
  resolve(evidence, 'matrix.json'),
  JSON.stringify({ checkedAt: new Date().toISOString(), results, finalBuildBase: '/' }, null, 2),
);
