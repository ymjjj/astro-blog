import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..');
const file = resolve(root, 'src/content/posts/first-publish.md');
const original = await readFile(file, 'utf8');
const child = spawn(
  process.execPath,
  ['node_modules/astro/bin/astro.mjs', 'dev', '--host', '127.0.0.1', '--port', '4322'],
  {
    cwd: root,
    env: { ...process.env, BLOG_BASE: '/', BLOG_SITE: 'https://example.com' },
    windowsHide: true,
  },
);
let output = '';
child.stdout.on('data', (chunk) => (output += chunk));
child.stderr.on('data', (chunk) => (output += chunk));
const address = 'http://127.0.0.1:4322/posts/first-publish/';
async function until(predicate) {
  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (child.exitCode !== null) throw new Error(output);
    try {
      const response = await fetch(address);
      if (response.ok && predicate(await response.text())) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`开发预览未按预期更新：${output}`);
}
try {
  await until((html) => html.includes('第一次发布练习'));
  await writeFile(file, original + '\nDEV_RELOAD_PROBE_82bb\n');
  await until((html) => html.includes('DEV_RELOAD_PROBE_82bb'));
  await writeFile(file, original);
  await until((html) => !html.includes('DEV_RELOAD_PROBE_82bb'));
  assert.equal(await readFile(file, 'utf8'), original);
  await mkdir(resolve(root, 'docs/validation'), { recursive: true });
  await writeFile(
    resolve(root, 'docs/validation/dev-reload.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        previewAccessible: true,
        contentChangeVisible: true,
        restoredChangeVisible: true,
      },
      null,
      2,
    ),
  );
  console.log('开发预览、Markdown 保存更新及恢复：PASS');
} finally {
  await writeFile(file, original);
  child.kill();
}
