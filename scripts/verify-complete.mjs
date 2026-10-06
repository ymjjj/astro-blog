import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'docs/validation');
await mkdir(dir, { recursive: true });
const results = [];
const label = process.env.BLOG_VERIFY_LABEL || 'phase3';
if (!/^[a-z0-9-]+$/.test(label)) throw Error('Invalid verification label');
const checks = [
  [
    'tools',
    [
      '--test',
      ...(await readdir(resolve(root, 'tests/tools')))
        .filter((n) => n.endsWith('.test.mjs'))
        .map((n) => 'tests/tools/' + n),
    ],
  ],
  [
    'studio',
    ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.studio.config.ts'],
  ],
  ['site-matrix', ['scripts/verify-all.mjs']],
];
for (const [name, args] of checks) {
  const started = Date.now();
  let output = '';
  const child = spawn(process.execPath, args, {
    cwd: root,
    windowsHide: true,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (b) => {
    output += b;
    process.stdout.write(b);
  });
  child.stderr.on('data', (b) => {
    output += b;
    process.stderr.write(b);
  });
  const exitCode = await new Promise((resolveResult, reject) => {
    child.on('error', reject);
    child.on('close', resolveResult);
  });
  await writeFile(resolve(dir, `${label}-${name}.log`), output.replace(/\x1b\[[0-9;]*m/g, ''));
  results.push({ name, exitCode, durationMs: Date.now() - started });
  await writeFile(
    resolve(dir, `${label}-complete.json`),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        results,
        complete: results.length === checks.length && results.every((r) => r.exitCode === 0),
      },
      null,
      2,
    ),
  );
  if (exitCode !== 0) {
    process.exitCode = 1;
    break;
  }
}
