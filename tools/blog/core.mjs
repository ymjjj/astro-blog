import { readFile, stat } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import sharp from 'sharp';
import { operations, errorResult } from './contracts.mjs';
import { fail, hash, safePath, atomic, walk, replay, json, locked } from './storage.mjs';
import { publish, status, buildSnapshot } from './publishing.mjs';
import { remember, history, diff, version, recovery, checkpoint, discard } from './history.mjs';
import * as maintenance from './maintenance.mjs';
import * as center from './publish-center.mjs';

const contentFile = (root, id) => safePath(root, `src/content/${id}.md`);
const serialize = (data, body) =>
  matter.stringify(
    body.trim() + '\n',
    Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ),
  );
export function validate(kind, data, body) {
  const errors = [];
  if (
    kind === 'posts' &&
    (typeof data.title !== 'string' ||
      !data.title.trim() ||
      typeof data.description !== 'string' ||
      !data.description.trim())
  )
    errors.push('文章需要标题和摘要');
  if (data.title !== undefined && typeof data.title !== 'string') errors.push('title 必须为字符串');
  if (!body.trim()) errors.push('正文不能为空');
  if (!Number.isFinite(new Date(data.date).valueOf())) errors.push('date 必须为有效日期');
  if (
    data.updated &&
    (!Number.isFinite(new Date(data.updated).valueOf()) ||
      new Date(data.updated) < new Date(data.date))
  )
    errors.push('updated 不能早于 date，且必须为有效日期');
  if (data.draft !== undefined && typeof data.draft !== 'boolean')
    errors.push('draft 必须为布尔值');
  if (
    data.tags !== undefined &&
    (!Array.isArray(data.tags) || data.tags.some((t) => typeof t !== 'string' || !t.trim()))
  )
    errors.push('tags 必须为非空字符串数组');
  if (errors.length) fail('INVALID_CONTENT', '内容校验未通过', errors);
}
export async function readEntry(root, id) {
  const file = await contentFile(root, id);
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') fail('NOT_FOUND', '找不到这篇内容', { id });
    throw e;
  }
  const { data, content: body } = matter(source);
  validate(id.split('/')[0], data, body);
  for (const field of ['date', 'updated'])
    if (data[field] instanceof Date) data[field] = data[field].toISOString();
  return {
    id,
    kind: id.split('/')[0],
    revision: hash(source),
    data: { ...data, draft: data.draft !== false, tags: data.tags || [] },
    body,
  };
}
export async function allEntries(root) {
  const entries = [];
  for (const kind of ['posts', 'moments']) {
    const dir = await safePath(root, `src/content/${kind}`);
    for (const file of await walk(dir))
      if (file.endsWith('.md')) {
        const id = `${kind}/${relative(dir, file).replaceAll('\\', '/').slice(0, -3)}`;
        operations.read.schema.parse({ id });
        entries.push(await readEntry(root, id));
      }
  }
  return entries.sort(
    (a, b) => new Date(b.data.date) - new Date(a.data.date) || a.id.localeCompare(b.id),
  );
}
export async function checkImages(root, entry) {
  const files = [];
  // Managed images use ordinary inline Markdown syntax; raw HTML remains author-owned.
  for (const match of entry.body.matchAll(/!\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g)) {
    const ref = match[1];
    if (/^https?:\/\//i.test(ref)) continue;
    if (/^[a-z]+:/i.test(ref) || ref.startsWith('//'))
      fail('INVALID_IMAGE', '图片应使用项目内路径或 HTTPS 地址');
    let file;
    try {
      file = await safePath(
        root,
        ref.startsWith('/')
          ? 'public/' + decodeURIComponent(ref.slice(1))
          : relative(
              root,
              resolve(dirname(await contentFile(root, entry.id)), decodeURIComponent(ref)),
            ),
      );
      await stat(file);
    } catch (e) {
      if (e.code === 'ENOENT')
        fail('MISSING_IMAGE', '图片文件不存在', { id: entry.id, reference: ref });
      throw e;
    }
    if (entry.data.draft && file.startsWith(resolve(root, 'public')))
      fail('PUBLIC_DRAFT_ASSET', '草稿图片不能放在 public；请通过 image 命令导入 src/assets。', {
        reference: ref,
      });
    files.push(file);
  }
  return files;
}
const changed = (entry, expected) => {
  if (entry.revision !== expected)
    fail('REVISION_CONFLICT', '内容已被修改，请重新读取并合并后保存。', {
      currentRevision: entry.revision,
    });
};

export function createBlog(root) {
  root = resolve(root);
  async function writeChange(entry, data, body, reason) {
    validate(entry.kind, data, body);
    await checkImages(root, { id: entry.id, data, body });
    const file = await contentFile(root, entry.id);
    const source = await readFile(file, 'utf8');
    changed({ revision: hash(source) }, entry.revision);
    const next = serialize(data, body);
    if (source === next) return entry;
    await remember(root, entry.id, source, 'before-' + reason);
    changed(await readEntry(root, entry.id), entry.revision);
    await atomic(file, next);
    await remember(root, entry.id, next, reason);
    return readEntry(root, entry.id);
  }
  const handlers = {
    setup: (args) => center.setup(root, args),
    configure: (args) => center.configure(root, args),
    pending: (args) => center.pending(root, args),
    preflight: (args) => center.preflight(root, args),
    assets: (args) => maintenance.assets(root, args),
    asset: (args) => maintenance.asset(root, args),
    backups: () => maintenance.backups(root),
    backup: () => maintenance.backup(root),
    backupimport: (args) => maintenance.backupimport(root, args),
    backupcheck: (args) => maintenance.backupcheck(root, args),
    plan: (args) => maintenance.plan(root, args),
    apply: (args) => maintenance.apply(root, args),
    trash: () => maintenance.trash(root),
    async autosave(args) {
      return handlers.update(args, 'autosave');
    },
    async history(args) {
      await readEntry(root, args.id);
      return history(root, args.id);
    },
    async diff(args) {
      const entry = await readEntry(root, args.id);
      return diff(root, args, entry.revision);
    },
    async restore(args) {
      const entry = await readEntry(root, args.id);
      changed(entry, args.expectedRevision);
      const snapshot = await version(root, args.id, args.revision);
      const { data, content } = matter(snapshot.source);
      return writeChange(entry, { ...data, draft: entry.data.draft }, content, 'restore');
    },
    recovery: (args) => recovery(root, args),
    checkpoint: (args) => checkpoint(root, args),
    discard: (args) => discard(root, args),
    async list(args) {
      return (await allEntries(root))
        .filter(
          (e) =>
            (!args.kind || e.kind === args.kind) &&
            (args.draft === undefined || e.data.draft === args.draft) &&
            (!args.query ||
              [e.data.title, e.data.description, e.body, ...e.data.tags]
                .join(' ')
                .toLocaleLowerCase()
                .includes(args.query.toLocaleLowerCase())),
        )
        .map(({ body, ...e }) => ({ ...e, excerpt: body.slice(0, 160) }));
    },
    read: (args) => readEntry(root, args.id),
    async create(args) {
      const { kind, requestId, slug, body, ...fields } = args;
      const id = `${kind}/${slug || 'entry-' + randomUUID()}`;
      const file = await contentFile(root, id);
      try {
        await stat(file);
        fail('ALREADY_EXISTS', '此内容 ID 已存在，请换 slug 或使用 update。', { id });
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      const data = {
        ...fields,
        date: fields.date || new Date().toISOString(),
        tags: fields.tags || [],
        draft: true,
      };
      validate(kind, data, body);
      await checkImages(root, { id, data, body });
      await atomic(file, serialize(data, body));
      await remember(root, id, await readFile(file, 'utf8'), 'create');
      return readEntry(root, id);
    },
    async update(args, reason = 'update') {
      const { id, expectedRevision, requestId, body, ...fields } = args;
      const entry = await readEntry(root, id);
      changed(entry, expectedRevision);
      const data = { ...entry.data, ...fields };
      return writeChange(entry, data, body, typeof reason === 'string' ? reason : 'update');
    },
    async image(args) {
      await readEntry(root, args.id);
      if (Boolean(args.file) === Boolean(args.base64))
        fail('INVALID_INPUT', 'file 和 base64 需要且只能提供一个');
      let bytes;
      if (args.file) {
        const info = await stat(args.file);
        if (info.size > 10 * 1024 * 1024) fail('IMAGE_TOO_LARGE', '图片不能超过 10 MB');
        bytes = await readFile(args.file);
      } else {
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(args.base64)) fail('INVALID_IMAGE', 'base64 格式无效');
        bytes = Buffer.from(args.base64, 'base64');
      }
      if (bytes.length > 10 * 1024 * 1024) fail('IMAGE_TOO_LARGE', '图片不能超过 10 MB');
      let output;
      try {
        const input = sharp(bytes, { limitInputPixels: 40000000 });
        const meta = await input.metadata();
        if (!['jpeg', 'png', 'webp', 'gif', 'avif'].includes(meta.format))
          fail('INVALID_IMAGE', '仅支持 JPEG、PNG、WebP、GIF 或 AVIF 栅格图片');
        output = await input
          .rotate()
          .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();
      } catch (e) {
        if (e.publicMessage) throw e;
        fail('INVALID_IMAGE', '无法解码图片或图片像素过大');
      }
      const name = hash(output) + '.webp';
      const file = await safePath(root, 'src/assets/uploads/' + name);
      await atomic(file, output);
      const ref = relative(dirname(await contentFile(root, args.id)), file).replaceAll('\\', '/');
      const alt = args.alt.replace(/[\[\]\\\r\n]/g, ' ');
      return {
        path: relative(root, file).replaceAll('\\', '/'),
        markdown: `![${alt}](${ref})`,
        bytes: output.length,
        notice: '图片已导入，尚未修改正文；GIF 取第一帧。仅被已发布内容引用时才进入生产构建。',
      };
    },
    async check(args) {
      const entries = args.id ? [await readEntry(root, args.id)] : await allEntries(root);
      for (const e of entries) {
        validate(e.kind, e.data, e.body);
        await checkImages(root, e);
      }
      return {
        valid: true,
        checked: entries.length,
        ...(args.build ? { build: await locked(root, () => buildSnapshot(root)) } : {}),
      };
    },
    async preview(args) {
      const e = await readEntry(root, args.id);
      const runtime = await json(await safePath(root, '.blog/runtime.json'), null);
      const url = `http://127.0.0.1:${runtime?.previewPort || 4321}/${e.id}/`;
      let ready = false;
      if (runtime)
        for (let attempt = 0; attempt < 30; attempt++) {
          try {
            const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
            await response.text();
            if (response.ok) {
              ready = true;
              break;
            }
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      return {
        id: e.id,
        url,
        ready,
        requires: '启动 npm run studio，或 npm run dev（默认端口 4321）',
        draft: e.data.draft,
      };
    },
    async publish(args, recordJob) {
      const entry = await readEntry(root, args.id);
      changed(entry, args.expectedRevision);
      return publish(root, args, entry, recordJob);
    },
    status: (args) => status(root, args),
    async config() {
      const setup = await center.setup(root);
      const config = { ...setup.target, enabled: setup.remoteEnabled };
      return {
        interfaceVersion: 3,
        root,
        workspaceId: hash(root),
        remoteEnabled: config.enabled,
        repository: config.repository || null,
        branch: config.branch || null,
        site: config.site || null,
        base: config.base || '/',
        notice: !setup.valid
          ? '配置无效，请在发布中心修复；写作与恢复仍可使用。'
          : config.enabled
            ? '已配置远程发布，请确保配置代表你的真实授权。'
            : '远程发布未启用；模拟发布可用。',
        configPath: '.blog/publish.json',
      };
    },
  };
  return {
    async execute(operation, input = {}) {
      try {
        if (!Object.hasOwn(operations, operation)) fail('UNKNOWN_OPERATION', '未知操作');
        const args = operations[operation].schema.parse(input);
        const call = async (recordJob) => {
          const data = await handlers[operation](args, recordJob);
          if (operation === 'publish' && data.status === 'failed')
            return {
              ok: false,
              error: {
                ...data.error,
                details: { jobId: data.jobId, lastSuccessfulState: data.lastSuccessfulState },
              },
              data,
            };
          return { ok: true, data };
        };
        return operations[operation].readOnly
          ? await call()
          : await replay(root, operation, args, call);
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}
export { serialize, changed };
