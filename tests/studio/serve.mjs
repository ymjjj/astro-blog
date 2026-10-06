import { mkdir, cp, symlink, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const project = resolve(import.meta.dirname, '../..');
const root = resolve(project, '.cache/studio-fixture');
// 只重建这个明确的测试目录；提前移除依赖链接，避免触及真实依赖。
if (root !== join(project, '.cache', 'studio-fixture')) throw Error('fixture path mismatch');
await rm(join(root, 'node_modules'), { force: true });
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
for (const name of [
  'src',
  'public',
  'scripts',
  'astro.config.mjs',
  'package.json',
  'tsconfig.json',
  '.github',
])
  await cp(join(project, name), join(root, name), { recursive: true });
await symlink(
  join(project, 'node_modules'),
  join(root, 'node_modules'),
  process.platform === 'win32' ? 'junction' : 'dir',
);
process.argv = [
  process.execPath,
  'server',
  '--root',
  root,
  '--port',
  '4336',
  '--preview-port',
  '4337',
];
await import('../../tools/studio/server.mjs');
