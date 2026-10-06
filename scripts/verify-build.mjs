import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join, extname, basename, dirname, relative } from 'node:path';
import matter from 'gray-matter';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { site } from '../src/site.config.js';
const root = resolve(import.meta.dirname, '..', 'dist');
const origin = process.env.BLOG_SITE || site.url;
const base = '/' + (process.env.BLOG_BASE || '').split('/').filter(Boolean).join('/');
const prefix = base === '/' ? '/' : base + '/';
async function files(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((entry) =>
        entry.isDirectory() ? files(join(dir, entry.name)) : join(dir, entry.name),
      ),
    )
  ).flat();
}
const all = await files(root);
// 真实内容也参与隔离检查，不仅依赖示例草稿中的测试标记。
const privateImages = new Set();
const publicImages = new Set();
const draftMarkers = new Set();
const expectedPublicUrls = [];
for (const kind of ['posts', 'moments']) {
  const contentRoot = resolve(root, '../src/content', kind);
  for (const file of await files(contentRoot)) {
    if (!file.endsWith('.md')) continue;
    const { data, content } = matter(await readFile(file, 'utf8'));
    const draft = data.draft !== false;
    if (!draft) {
      const id = relative(contentRoot, file).replaceAll('\\', '/').replace(/\.md$/, '');
      expectedPublicUrls.push(prefix + kind + '/' + id + '/');
    }
    if (draft) {
      for (const marker of content.matchAll(/DRAFT_SECRET_[A-Za-z0-9_]+/g))
        draftMarkers.add(marker[0]);
      const id = relative(contentRoot, file).replaceAll('\\', '/').replace(/\.md$/, '');
      assert(!all.includes(join(root, kind, id, 'index.html')), `草稿路由泄露：${kind}/${id}`);
    }
    for (const match of content.matchAll(/!\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g)) {
      if (/^https?:/i.test(match[1])) continue;
      const image = resolve(dirname(file), match[1]);
      (draft ? privateImages : publicImages).add(image);
    }
  }
}
for (const image of privateImages) {
  if (publicImages.has(image)) continue;
  const name = basename(image, extname(image));
  try {
    for (const marker of (await readFile(image, 'utf8')).matchAll(/DRAFT_SECRET_[A-Za-z0-9_]+/g))
      draftMarkers.add(marker[0]);
  } catch {
    /* 图片存在性由后续资源检查处理 */
  }
  assert(
    !all.some(
      (file) =>
        /\.(png|jpe?g|webp|svg|gif|avif)$/i.test(file) && basename(file).startsWith(name + '.'),
    ),
    `草稿专用图片泄露：${name}`,
  );
}
let checked = 0;
async function localFile(href, from) {
  if (/^(mailto:|tel:|data:|javascript:)/i.test(href)) return;
  const parsed = new URL(href, from);
  if (parsed.origin !== new URL(origin).origin) return;
  assert(parsed.pathname.startsWith(prefix), `链接缺少 base: ${href} in ${from}`);
  const rel = decodeURIComponent(parsed.pathname.slice(prefix.length));
  let target = resolve(root, rel || 'index.html');
  assert(target.startsWith(root), `路径越界: ${href}`);
  let info;
  try {
    info = await stat(target);
  } catch {
    assert.fail(`链接不存在: ${href} in ${from}`);
  }
  if (info.isDirectory()) target = join(target, 'index.html');
  await stat(target);
  if (parsed.hash && extname(target) === '.html') {
    const doc = load(await readFile(target, 'utf8'));
    assert(
      doc('[id]')
        .toArray()
        .some((node) => doc(node).attr('id') === decodeURIComponent(parsed.hash.slice(1))),
      `锚点不存在: ${href}`,
    );
  }
  checked++;
}
for (const file of all) {
  const bytes = await readFile(file);
  for (const marker of draftMarkers)
    assert(!bytes.includes(Buffer.from(marker)), `草稿泄露: ${file}`);
  const relative = file.slice(root.length + 1).replaceAll('\\', '/');
  const from = new URL(prefix + relative.replace(/index\.html$/, ''), origin);
  if (file.endsWith('.html')) {
    const $ = load(bytes.toString());
    assert.equal(
      $('.draft-banner, .draft-row, .local-drafts-link').length,
      0,
      `生产页面包含草稿入口: ${relative}`,
    );
    assert.equal($('h1').length, 1, `需要一个 h1: ${relative}`);
    assert(
      $('title').text().length > 0 && $('meta[name="description"]').attr('content'),
      `缺少 SEO: ${relative}`,
    );
    assert.equal($('html').attr('lang'), 'zh-CN');
    const canonical = $('link[rel="canonical"]').attr('href');
    assert(
      canonical && canonical.startsWith(new URL(prefix, origin).href),
      `canonical: ${relative}`,
    );
    for (const el of $('[href], [src]').toArray()) {
      const href = $(el).attr('href') || $(el).attr('src');
      if (href) await localFile(href, from);
    }
    for (const img of $('img').toArray()) assert($(img).attr('alt'), `图片缺少 alt: ${relative}`);
  } else if (file.endsWith('.css')) {
    for (const match of bytes.toString().matchAll(/url\(["']?([^)'"\s]+)["']?\)/g))
      await localFile(match[1], from);
  }
}
const search = JSON.parse(await readFile(join(root, 'search-index.json'), 'utf8'));
assert.deepEqual(
  search.map((entry) => entry.url).sort(),
  expectedPublicUrls.sort(),
  '产物内容与当前公开源文件不一致，可能存在缓存串扰或残留内容',
);
assert(!all.some((file) => /[\\/]drafts[\\/]/.test(file)), '生产构建生成了草稿箱');
for (const entry of search) await localFile(entry.url, origin);
const rss = load(await readFile(join(root, 'rss.xml'), 'utf8'), { xmlMode: true });
assert.equal(rss('item').length, search.length, 'RSS 与搜索条目数应一致');
for (const link of rss('item > link').toArray()) await localFile(rss(link).text(), origin);
const sitemap = load(await readFile(join(root, 'sitemap.xml'), 'utf8'), { xmlMode: true });
for (const loc of sitemap('loc').toArray()) await localFile(sitemap(loc).text(), origin);
const htmlCount = all.filter((f) => f.endsWith('.html')).length;
const summary = {
  base: prefix,
  site: origin,
  files: all.length,
  htmlPages: htmlCount,
  checkedLinks: checked,
  publishedEntries: search.length,
  draftLeak: false,
};
console.log(JSON.stringify(summary, null, 2));
