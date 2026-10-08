#!/usr/bin/env node
/**
 * 每日文学笔记自动发布到博客
 * 检查 D:\literature 里最近 2 天生成的笔记，如博客中不存在则导入并推送
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LIT_ROOT = 'D:/literature';
const BLOG_ROOT = 'D:/projects/astro-blog';
const POSTS_DIR = path.join(BLOG_ROOT, 'src/content/posts');
const LOG = path.join(BLOG_ROOT, 'auto-publish.log');

function log(msg) {
  // 只写日志文件，不输出 stdout
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG, line);
}

function report(msg) {
  // 写日志文件 + 输出 stdout（cron 投递内容）
  log(msg);
  console.log(msg);
}

// 找最近 2 天的笔记文件
function findRecentNotes() {
  const files = [];
  const now = new Date();
  for (let i = 0; i < 2; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dir = path.join(LIT_ROOT, String(yyyy), mm);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`${yyyy}-${mm}-${dd}-`) && f.endsWith('.md')) {
        files.push(path.join(dir, f));
      }
    }
  }
  return files;
}

// 解析笔记 frontmatter
function parseNote(filePath) {
  const src = fs.readFileSync(filePath, 'utf-8');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const fm = m[1];
  let body = m[2];
  const slug = path.basename(filePath).replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
  const title = fm.match(/title:\s*"(.+?)"/)?.[1] || slug;
  const date = fm.match(/date:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  const country = fm.match(/country:\s*"(.+?)"/)?.[1] || '';
  if (!date) return null;
  // 删除正文第一行 # 标题（布局会用 frontmatter title 生成 h1）
  body = body.replace(/^#[^\n]+\r?\n+/, '');
  // 提取第一段作 description
  const firstPara = body.match(/## 为什么值得认识\r?\n\r?\n([^\r\n]+)/)?.[1] || '';
  const description = firstPara.slice(0, 180);
  // 转换 Obsidian 链接 [[YYYY-MM-DD-slug|文字]] → [文字](/posts/slug/)
  body = body.replace(/\[\[(\d{4}-\d{2}-\d{2}-)([^\]|]+)\|([^\]]+)\]\]/g,
    (mm, p1, p2, p3) => `[${p3}](/posts/${p2}/)`);
  body = body.replace(/\((\d{4}-\d{2}-\d{2}-)([a-z0-9-]+)\.md\)/g,
    (mm, p1, p2) => `(/posts/${p2}/)`);
  // 跨目录相对链接 (../MM/YYYY-MM-DD-slug.md) → /posts/slug/
  body = body.replace(/\(\.\.\/\d{2}\/(\d{4}-\d{2}-\d{2}-)([a-z0-9-]+)\.md\)/g,
    (mm, p1, p2) => `(/posts/${p2}/)`);
  const tags = ['文学笔记'];
  if (country) tags.push(country.split('（')[0]);
  return {
    kind: 'posts',
    requestId: `auto-${slug}-${Date.now()}`,
    slug, title, description, date: date + 'T04:00:00.000Z', tags, body
  };
}

function cliCreate(req) {
  const tmp = path.join(BLOG_ROOT, `temp-auto-${req.slug}.json`);
  fs.writeFileSync(tmp, JSON.stringify(req, null, 2));
  try {
    const out = execSync(
      `cd /d ${BLOG_ROOT} && node tools/blog/cli.mjs create --input temp-auto-${req.slug}.json --json`,
      { encoding: 'utf-8', timeout: 30000, shell: 'cmd.exe' }
    );
    const r = JSON.parse(out);
    return r.ok;
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function setPublished(slug) {
  const f = path.join(POSTS_DIR, `${slug}.md`);
  let c = fs.readFileSync(f, 'utf-8');
  c = c.replace('draft: true', 'draft: false');
  fs.writeFileSync(f, c);
}

function main() {
  log('--- 自动发布开始 ---');
  const notes = findRecentNotes();
  if (notes.length === 0) { log('最近 2 天无新笔记'); return; }

  const existing = new Set(fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md')).map(f => f.replace('.md', '')));
  const toImport = [];
  for (const f of notes) {
    const note = parseNote(f);
    if (!note) { log(`解析失败: ${f}`); continue; }
    if (existing.has(note.slug)) { log(`已存在，跳过: ${note.slug}`); continue; }
    toImport.push(note);
  }

  if (toImport.length === 0) { return; }  // 无新笔记：静默退出，不输出（cron 不投递）

  const imported = [];
  for (const note of toImport) {
    const ok = cliCreate(note);
    if (ok) {
      setPublished(note.slug);
      imported.push(note.slug);
      log(`导入成功: ${note.slug}`);
    } else {
      log(`导入失败: ${note.slug}`);
    }
  }

  if (imported.length === 0) return;

  // 构建 + 验证 + 推送
  try {
    execSync(`cd /d ${BLOG_ROOT} && npm.cmd run build`, { stdio: 'pipe', timeout: 180000, shell: 'cmd.exe' });
    log('构建成功');
    execSync(`cd /d ${BLOG_ROOT} && npm.cmd run verify`, { stdio: 'pipe', timeout: 180000, shell: 'cmd.exe' });
    log('验证通过');
    execSync(`cd /d ${BLOG_ROOT} && git add src/content/posts/ && git commit -m "auto: publish daily literature notes (${imported.join(', ')})" && git push origin main`,
      { stdio: 'pipe', timeout: 120000, shell: 'cmd.exe' });
    log(`推送成功: ${imported.join(', ')}`);
    report(`✅ 今日笔记已自动发布到博客并推送 GitHub：${imported.join('、')}\nhttps://ymjjj.github.io/astro-blog/`);
  } catch (e) {
    log(`构建/验证/推送失败: ${e.message.slice(0, 500)}`);
    process.exit(1);
  }
}

main();
