import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [kind, slug] = process.argv.slice(2);
if (!['post', 'moment'].includes(kind) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '')) {
  console.error('用法：npm run new -- post|moment lower-case-slug');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..');
const folder = resolve(root, 'src/content', kind === 'post' ? 'posts' : 'moments');
const template = await readFile(resolve(root, 'templates', `${kind}.md`), 'utf8');
const output = template.replace(/^date:.*$/m, `date: "${new Date().toISOString()}"`);
await mkdir(folder, { recursive: true });
await writeFile(resolve(folder, `${slug}.md`), output, { flag: 'wx' });
console.log(`已创建 ${folder}/${slug}.md（草稿）。填写正文后将 draft 改为 false。`);
