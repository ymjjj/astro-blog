import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createBlog } from '../blog/core.mjs';
import { saveJson, safePath } from '../blog/storage.mjs';
import { backupFile } from '../blog/maintenance.mjs';

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    port: { type: 'string', default: '4323' },
    'preview-port': { type: 'string', default: '4325' },
    'no-preview': { type: 'boolean', default: false },
  },
});
const root = resolve(values.root || fileURLToPath(new URL('../../', import.meta.url)));
const port = Number(values.port),
  previewPort = Number(values['preview-port']);
if (
  ![port, previewPort].every((p) => Number.isInteger(p) && p >= 1024 && p <= 65535) ||
  port === previewPort
)
  throw Error('端口应为不同的 1024—65535 整数');
const origin = `http://127.0.0.1:${port}`;
const token = randomBytes(32).toString('hex');
const blog = createBlog(root);
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const send = (res, status, data, type = 'application/json') => {
  res.writeHead(status, {
    'Content-Type': `${type}; charset=utf-8`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src http://127.0.0.1:${previewPort}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  });
  res.end(typeof data === 'object' ? JSON.stringify(data) : data);
};
const server = createServer(async (req, res) => {
  try {
    if (
      req.headers.host !== `127.0.0.1:${port}` ||
      (req.headers.origin && req.headers.origin !== origin) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      return send(res, 403, {
        ok: false,
        error: { code: 'ORIGIN_DENIED', message: '只允许本机工作台请求' },
      });
    if (
      req.method === 'GET' &&
      ['/', '/app.js', '/maintenance.js', '/publish-center.js', '/style.css'].includes(req.url)
    ) {
      const name = req.url === '/' ? 'index.html' : req.url.slice(1);
      let content = await readFile(join(publicDir, name), 'utf8');
      if (name === 'index.html')
        content = content
          .replace('STUDIO_TOKEN', token)
          .replaceAll('PREVIEW_PORT', String(previewPort));
      return send(
        res,
        200,
        content,
        name.endsWith('.html')
          ? 'text/html'
          : name.endsWith('.js')
            ? 'text/javascript'
            : 'text/css',
      );
    }
    if (req.method !== 'POST' || !/^\/api\/[a-z]+$/.test(req.url))
      return send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } });
    const supplied = Buffer.from(String(req.headers['x-studio-token'] || ''));
    const wanted = Buffer.from(token);
    if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted))
      return send(res, 403, {
        ok: false,
        error: { code: 'TOKEN_REQUIRED', message: '请重新打开本地工作台' },
      });
    if (!req.headers['content-type']?.startsWith('application/json'))
      return send(res, 415, {
        ok: false,
        error: { code: 'JSON_REQUIRED', message: '需要 JSON 请求' },
      });
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > (req.url === '/api/backupimport' ? 90000000 : 16000000))
        return send(res, 413, { ok: false, error: { code: 'TOO_LARGE', message: '请求过大' } });
      chunks.push(chunk);
    }
    let args;
    try {
      args = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return send(res, 400, {
        ok: false,
        error: { code: 'INVALID_JSON', message: 'JSON 格式错误' },
      });
    }
    const op = req.url.split('/').pop();
    if ((op === 'image' || op === 'backupimport') && args.file)
      return send(res, 400, {
        ok: false,
        error: { code: 'UPLOAD_REQUIRED', message: '网页请通过文件选择器上传图片' },
      });
    if (op === 'backupdownload') {
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(args.backupId || '')
      )
        return send(res, 400, {
          ok: false,
          error: { code: 'INVALID_INPUT', message: '无效的备份 ID' },
        });
      const checked = await blog.execute('backupcheck', { backupId: args.backupId });
      if (!checked.ok) return send(res, 400, checked);
      const bytes = await readFile(await backupFile(root, args.backupId));
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="${args.backupId}.blogbackup.gz"`,
      });
      return res.end(bytes);
    }
    const result = await blog.execute(op, args);
    send(res, result.ok ? 200 : 400, result);
  } catch {
    send(res, 500, {
      ok: false,
      error: { code: 'SERVER_ERROR', message: '本地操作未完成，请检查文件权限或重新启动工作台' },
    });
  }
});
let preview;
server.on('error', (error) => {
  process.stderr.write(`工作台启动失败：${error.code}\n`);
  process.exitCode = 1;
  preview?.kill();
});
server.listen(port, '127.0.0.1', async () => {
  await saveJson(await safePath(root, '.blog/runtime.json'), {
    previewPort,
    studioPort: port,
    pid: process.pid,
  });
  process.stdout.write(
    `页间写作台：${origin}\n预览：http://127.0.0.1:${previewPort}\n按 Ctrl+C 关闭。\n`,
  );
  if (!values['no-preview']) {
    preview = spawn(
      process.execPath,
      [
        join(root, 'node_modules/astro/bin/astro.mjs'),
        'dev',
        '--host',
        '127.0.0.1',
        '--port',
        String(previewPort),
      ],
      {
        cwd: root,
        env: { ...process.env, BLOG_BASE: '/' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    preview.stdout.on('data', (b) => process.stderr.write(b));
    preview.stderr.on('data', (b) => process.stderr.write(b));
    preview.on('error', () => process.stderr.write('预览无法启动，请检查 Node 与依赖。\n'));
    preview.on('exit', (code) => {
      if (code) process.stderr.write('预览进程已退出，请检查端口占用。\n');
    });
  }
});
function stop() {
  preview?.kill();
  server.close(() => process.exit());
  setTimeout(() => process.exit(), 2000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', () => preview?.kill());
