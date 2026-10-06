import { readFile, stat, rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import sharp from 'sharp';
import matter from 'gray-matter';
import { safePath, hash, json, saveJson, atomic, walk, fail } from './storage.mjs';
import { operations } from './contracts.mjs';
import { validate } from './core.mjs';
const zip = promisify(gzip),
  unzip = promisify(gunzip);
const MAX = 64 * 1024 * 1024;
const raster = /\.(png|jpe?g|webp|gif|avif)$/i;
const picture = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
const managed = /^src\/assets\/uploads\/[a-f0-9]{64}\.webp$/;
const areas = [
  'src/content/posts',
  'src/content/moments',
  'src/assets',
  'public',
  'assets/source',
  '.blog/history',
  '.blog/recovery',
];
export function allowed(path) {
  if (
    typeof path !== 'string' ||
    path.length > 500 ||
    path.includes('\\') ||
    path
      .split('/')
      .some(
        (s) =>
          !s ||
          s === '.' ||
          s === '..' ||
          /[\x00-\x1f<>:"|?*]/.test(s) ||
          /[. ]$/.test(s) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s),
      )
  )
    return false;
  return (
    /^src\/content\/(posts|moments)\/[a-z0-9/-]+\.md$/.test(path) ||
    (/^(src\/assets|public|assets\/source)\//.test(path) && picture.test(path)) ||
    /^\.blog\/history\/(posts|moments)\/[a-z0-9/-]+\/[a-f0-9]{64}\.json$/.test(path) ||
    /^\.blog\/recovery\/[a-f0-9-]{36}\.json$/.test(path)
  );
}
async function files(root, area) {
  try {
    return (await walk(await safePath(root, area))).map((p) =>
      p.slice(root.length + 1).replaceAll('\\', '/'),
    );
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}
async function snapshot(root) {
  const result = [];
  let total = 0;
  for (const area of areas)
    for (const path of await files(root, area)) {
      if (!allowed(path)) continue;
      const file = await safePath(root, path),
        info = await stat(file);
      total += info.size;
      if (total > MAX) fail('BACKUP_TOO_LARGE', '资料超过64 MiB，请先分开归档后重试。');
      const data = await readFile(file);
      result.push({
        path,
        bytes: data.length,
        sha256: hash(data),
        data: data.toString('base64'),
        mtime: info.mtimeMs,
      });
    }
  if (result.length > 10000) fail('BACKUP_TOO_LARGE', '文件数超过10000。');
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
const metadata = (items) => items.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
const scopeHash = (items) =>
  hash(JSON.stringify(items.map(({ path, sha256, mtime }) => ({ path, sha256, mtime }))));
async function current(root, path) {
  try {
    const b = await readFile(await safePath(root, path));
    return { path, bytes: b.length, sha256: hash(b), data: b.toString('base64') };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
function validateEntry(item) {
  const data = Buffer.from(item.data, 'base64');
  if (item.path.endsWith('.md')) {
    const id = item.path.slice('src/content/'.length, -3);
    operations.read.schema.parse({ id });
    const parsed = matter(data.toString('utf8'));
    validate(id.split('/')[0], parsed.data, parsed.content);
  } else if (item.path.startsWith('.blog/history/')) {
    const h = JSON.parse(data.toString('utf8'));
    if (
      item.path !== `.blog/history/${h.id}/${h.revision}.json` ||
      typeof h.source !== 'string' ||
      hash(h.source) !== h.revision
    )
      fail('INVALID_BACKUP', '历史快照不完整。');
    operations.read.schema.parse({ id: h.id });
    const parsed = matter(h.source);
    validate(h.id.split('/')[0], parsed.data, parsed.content);
  } else if (item.path.startsWith('.blog/recovery/')) {
    const r = JSON.parse(data.toString('utf8'));
    operations.checkpoint.schema.parse({
      sessionId: r.sessionId,
      expectedVersion: null,
      requestId: 'backup-validation',
      id: r.id,
      baseRevision: r.baseRevision,
      form: r.form,
    });
    if (item.path !== `.blog/recovery/${r.sessionId}.json` || !/^[a-f0-9]{64}$/.test(r.version))
      fail('INVALID_BACKUP', '恢复副本不完整。');
  }
}
function manifestHash(bundle) {
  return hash(
    JSON.stringify({
      format: bundle.format,
      createdAt: bundle.createdAt,
      files: metadata(bundle.files),
    }),
  );
}
export async function decodeBackup(bytes) {
  if (bytes.length > MAX) fail('BACKUP_TOO_LARGE', '备份包不得超过64 MiB。');
  try {
    const bundle = JSON.parse(
      (await unzip(bytes, { maxOutputLength: 128 * 1024 * 1024 })).toString('utf8'),
    );
    if (
      bundle.format !== 'between-pages-backup-v1' ||
      !Array.isArray(bundle.files) ||
      bundle.files.length > 10000 ||
      !Number.isFinite(Date.parse(bundle.createdAt))
    )
      throw Error();
    let total = 0;
    const names = new Set();
    for (const item of bundle.files) {
      if (
        !allowed(item.path) ||
        names.has(item.path.toLowerCase()) ||
        typeof item.data !== 'string'
      )
        throw Error();
      names.add(item.path.toLowerCase());
      const decoded = Buffer.from(item.data, 'base64');
      total += decoded.length;
      if (
        total > MAX ||
        decoded.length !== item.bytes ||
        decoded.toString('base64') !== item.data ||
        hash(decoded) !== item.sha256
      )
        throw Error();
      if (managed.test(item.path) && basename(item.path, '.webp') !== item.sha256) throw Error();
      validateEntry(item);
    }
    if (manifestHash(bundle) !== bundle.manifestHash) throw Error();
    return bundle;
  } catch (e) {
    if (e.code === 'BACKUP_TOO_LARGE') throw e;
    fail('INVALID_BACKUP', '备份完整性或路径校验失败；请使用未损坏的本站备份包。');
  }
}
export async function backupFile(root, id) {
  return safePath(root, `.blog/backups/${id}.blogbackup.gz`);
}
async function loadBackup(root, id) {
  let data;
  try {
    data = await readFile(await backupFile(root, id));
  } catch (e) {
    if (e.code === 'ENOENT') fail('BACKUP_NOT_FOUND', '找不到备份包，请重新导入。');
    throw e;
  }
  return decodeBackup(data);
}
export async function backup(root) {
  const list = await snapshot(root);
  const bundle = {
    format: 'between-pages-backup-v1',
    createdAt: new Date().toISOString(),
    files: list.map(({ mtime, ...item }) => item),
  };
  bundle.manifestHash = manifestHash(bundle);
  const data = await zip(JSON.stringify(bundle));
  await decodeBackup(data);
  if (scopeHash(await snapshot(root)) !== scopeHash(list))
    fail('PLAN_STALE', '导出期间资料变化，请在保存完成后重新导出。');
  const backupId = randomUUID();
  await atomic(await backupFile(root, backupId), data);
  return {
    backupId,
    path: `.blog/backups/${backupId}.blogbackup.gz`,
    bytes: data.length,
    files: list.length,
    manifestHash: bundle.manifestHash,
  };
}
export async function backupimport(root, args) {
  if (Boolean(args.file) === Boolean(args.base64)) fail('INVALID_INPUT', 'file 和 base64 二选一。');
  if (args.file && (await stat(args.file)).size > MAX)
    fail('BACKUP_TOO_LARGE', '备份包不得超过64 MiB。');
  const bytes = args.file ? await readFile(args.file) : Buffer.from(args.base64, 'base64');
  const bundle = await decodeBackup(bytes),
    backupId = randomUUID();
  await atomic(await backupFile(root, backupId), bytes);
  return {
    backupId,
    bytes: bytes.length,
    files: bundle.files.length,
    manifestHash: bundle.manifestHash,
    verified: true,
  };
}
export async function backups(root) {
  const result = [];
  for (const path of await files(root, '.blog/backups'))
    if (/\/[a-f0-9-]{36}\.blogbackup\.gz$/.test(path)) {
      const info = await stat(await safePath(root, path));
      result.push({
        backupId: basename(path, '.blogbackup.gz'),
        bytes: info.size,
        createdAt: info.mtime.toISOString(),
      });
    }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function backupcheck(root, args) {
  const b = await loadBackup(root, args.backupId);
  if (args.path) {
    const item = b.files.find((f) => f.path === args.path);
    if (!item) fail('NOT_FOUND', '备份中没有该文件。');
    return {
      ...metadata([item])[0],
      text: /\.(md|json)$/.test(item.path)
        ? Buffer.from(item.data, 'base64').toString('utf8')
        : null,
    };
  }
  return {
    backupId: args.backupId,
    verified: true,
    createdAt: b.createdAt,
    manifestHash: b.manifestHash,
    files: metadata(b.files),
    bytes: b.files.reduce((s, f) => s + f.bytes, 0),
  };
}
async function references(root, items) {
  const refs = [];
  for (const item of items)
    if (item.path.endsWith('.md') || item.path.startsWith('.blog/')) {
      let text = Buffer.from(item.data, 'base64').toString('utf8'),
        owner = item.path,
        type = 'content';
      if (item.path.startsWith('.blog/history/')) {
        const h = JSON.parse(text);
        text = h.source;
        owner = h.id + ' @ ' + h.revision.slice(0, 8);
        type = 'history';
      }
      if (item.path.startsWith('.blog/recovery/')) {
        const r = JSON.parse(text);
        text = r.form.body;
        owner = r.id || r.sessionId;
        type = 'recovery';
      }
      refs.push({ type, owner, path: item.path, text });
    }
  // Reversible cleanup must also preserve images referenced by discarded recovery copies.
  for (const path of await files(root, '.blog/trash'))
    if (path.endsWith('.json')) {
      const t = await json(await safePath(root, path), null);
      if (t?.status === 'undone') continue;
      for (const change of t?.changes || [])
        for (const item of [change.before, change.after])
          if (item && /\.(md|json)$/.test(item.path))
            refs.push({
              type: 'trash',
              owner: t.transactionId,
              path: item.path,
              text: Buffer.from(item.data, 'base64').toString('utf8'),
            });
    }
  for (const area of ['src', 'public'])
    for (const path of await files(root, area))
      if (/\.(astro|[cm]?[jt]sx?|css|json|html|svg)$/.test(path))
        refs.push({
          type: 'source',
          owner: path,
          path,
          text: await readFile(await safePath(root, path), 'utf8'),
        });
  return refs;
}
export async function assets(root, args = {}) {
  const items = await snapshot(root),
    refs = await references(root, items),
    result = [];
  for (const item of items.filter((i) => picture.test(i.path))) {
    const name = basename(item.path);
    const used = refs
      .filter((r) => {
        const text = r.text.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
          try {
            return decodeURIComponent(encoded);
          } catch {
            return encoded;
          }
        });
        return text.toLowerCase().includes(name.toLowerCase());
      })
      .map(({ text, ...r }) => r);
    const protectedUntil = managed.test(item.path)
      ? new Date(item.mtime + 86400000).toISOString()
      : null;
    const cleanupAllowed =
      managed.test(item.path) && used.length === 0 && Date.now() >= item.mtime + 86400000;
    let width = null,
      height = null;
    if (raster.test(item.path))
      try {
        const meta = await sharp(Buffer.from(item.data, 'base64'), {
          limitInputPixels: 40000000,
        }).metadata();
        width = meta.width;
        height = meta.height;
      } catch {}
    const entry = {
      path: item.path,
      bytes: item.bytes,
      sha256: item.sha256,
      width,
      height,
      references: used,
      cleanupAllowed,
      protectedUntil,
      reason: !managed.test(item.path)
        ? '站点或手工资源，只展示不清理'
        : used.length
          ? '仍有引用'
          : !cleanupAllowed
            ? '新导入24小时保护期'
            : '可移入回收站',
    };
    if (
      (!args.unused || !used.length) &&
      (!args.query ||
        [item.path, ...used.map((r) => r.owner)]
          .join(' ')
          .toLowerCase()
          .includes(args.query.toLowerCase()))
    )
      result.push(entry);
  }
  return { images: result, bytes: result.reduce((s, i) => s + i.bytes, 0) };
}
export async function asset(root, args) {
  if (!allowed(args.path) || !raster.test(args.path))
    fail('INVALID_IMAGE', '只预览图片管理范围内的栅格图片。');
  try {
    const bytes = await sharp(await readFile(await safePath(root, args.path)), {
      limitInputPixels: 40000000,
    })
      .rotate()
      .resize({ width: 360, height: 240, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();
    return { path: args.path, dataUrl: 'data:image/webp;base64,' + bytes.toString('base64') };
  } catch {
    fail('INVALID_IMAGE', '图片无法解码或超过像素限制。');
  }
}
async function dependencies(root) {
  const result = [];
  for (const area of ['src', 'public', '.blog/trash'])
    for (const path of await files(root, area))
      if (/\.(astro|[cm]?[jt]sx?|css|json|html|svg)$/.test(path))
        result.push({ path, sha256: hash(await readFile(await safePath(root, path))) });
  return hash(JSON.stringify(result.sort((a, b) => a.path.localeCompare(b.path))));
}
const planHash = (p) => hash(JSON.stringify(p));
function preview(change) {
  const text = (item) =>
    item && /\.(md|json)$/.test(item.path)
      ? Buffer.from(item.data, 'base64').toString('utf8').slice(0, 2000)
      : null;
  return {
    path: change.path,
    action: !change.before ? '新增' : !change.after ? '移入回收站' : '替换',
    before: change.before ? metadata([change.before])[0] : null,
    after: change.after ? metadata([change.after])[0] : null,
    beforePreview: text(change.before),
    afterPreview: text(change.after),
  };
}
export async function plan(root, args) {
  const items = await snapshot(root),
    byPath = new Map(items.map((i) => [i.path, i]));
  let changes = [];
  let backupHash = null;
  if (args.kind === 'cleanup') {
    if (!args.paths?.length || args.backupId || args.transactionId)
      fail('INVALID_INPUT', 'cleanup 只接受 paths。');
    const pictures = new Map((await assets(root)).images.map((i) => [i.path, i]));
    for (const path of new Set(args.paths)) {
      if (
        !/^\.blog\/recovery\/[a-f0-9-]{36}\.json$/.test(path) &&
        !pictures.get(path)?.cleanupAllowed
      )
        fail('ASSET_PROTECTED', '此项仍有引用、处于保护期或不允许清理。', { path });
      const before = byPath.get(path);
      if (!before) fail('NOT_FOUND', '清单中的文件不存在，请刷新。', { path });
      changes.push({ path, before, after: null });
    }
  } else if (args.kind === 'restore') {
    if (!args.backupId || args.paths || args.transactionId)
      fail('INVALID_INPUT', 'restore 只接受 backupId。');
    const b = await loadBackup(root, args.backupId);
    backupHash = b.manifestHash;
    for (const after of b.files) {
      const before = byPath.get(after.path) || null;
      if (before?.sha256 !== after.sha256) changes.push({ path: after.path, before, after });
    }
  } else {
    if (!args.transactionId || args.paths || args.backupId)
      fail('INVALID_INPUT', 'undo 只接受 transactionId。');
    const t = await json(await safePath(root, `.blog/trash/${args.transactionId}.json`), null);
    if (!t || t.status === 'undone') fail('NOT_FOUND', '该事务不存在或已经撤销。');
    for (const change of t.changes) {
      const now = byPath.get(change.path) || null;
      if ((now?.sha256 || null) === (change.before?.sha256 || null)) continue;
      if ((now?.sha256 || null) !== (change.after?.sha256 || null))
        fail('PLAN_STALE', '撤销会覆盖后续修改，请先备份并手动合并。', { path: change.path });
      changes.push({ path: change.path, before: now, after: change.before });
    }
  }
  const p = {
    planId: randomUUID(),
    kind: args.kind,
    createdAt: new Date().toISOString(),
    scope: scopeHash(items),
    dependencies: await dependencies(root),
    backupId: args.backupId || null,
    backupHash,
    transactionId: args.transactionId || null,
    changes,
  };
  const expectedPlan = planHash(p);
  await saveJson(await safePath(root, `.blog/plans/${p.planId}.json`), { ...p, expectedPlan });
  return {
    planId: p.planId,
    expectedPlan,
    kind: p.kind,
    files: changes.map(preview),
    count: changes.length,
    notice:
      '请逐项审查清单（文本预览最多2000字符）。确认后才能执行；有任何新修改需重新生成计划。清理与替换均可撤销。',
  };
}
export async function apply(root, args) {
  const stored = await json(await safePath(root, `.blog/plans/${args.planId}.json`), null);
  if (!stored) fail('NOT_FOUND', '计划不存在。');
  const { expectedPlan, ...p } = stored;
  if (expectedPlan !== args.expectedPlan || planHash(p) !== expectedPlan)
    fail('PLAN_STALE', '计划校验失败，请重新预览。');
  if (scopeHash(await snapshot(root)) !== p.scope || (await dependencies(root)) !== p.dependencies)
    fail('PLAN_STALE', '预览后资料有修改，请重新生成并审查清单。');
  if (p.backupId && (await loadBackup(root, p.backupId)).manifestHash !== p.backupHash)
    fail('PLAN_STALE', '备份包已变化。');
  if (p.changes.length === 0) return { status: 'unchanged', count: 0 };
  const transactionId = randomUUID(),
    file = await safePath(root, `.blog/trash/${transactionId}.json`);
  const t = {
    transactionId,
    kind: p.kind,
    createdAt: new Date().toISOString(),
    status: 'applying',
    changes: p.changes,
    completed: [],
  };
  await saveJson(file, t);
  try {
    for (const change of p.changes) {
      if (!allowed(change.path)) fail('INVALID_INPUT', '不允许的恢复路径。');
      const before = await current(root, change.path);
      if ((before?.sha256 || null) !== (change.before?.sha256 || null))
        fail('PLAN_STALE', '执行期间文件变化，已停止；可在回收站检查部分执行。', {
          path: change.path,
        });
      if (change.after) {
        if (hash(Buffer.from(change.after.data, 'base64')) !== change.after.sha256)
          fail('INVALID_BACKUP', '撤销资料校验失败。');
        await atomic(await safePath(root, change.path), Buffer.from(change.after.data, 'base64'));
      } else await rm(await safePath(root, change.path));
      t.completed.push(change.path);
      await saveJson(file, t);
    }
    t.status = 'completed';
    await saveJson(file, t);
    if (p.kind === 'undo') {
      const oldPath = await safePath(root, `.blog/trash/${p.transactionId}.json`);
      const old = await json(oldPath, null);
      old.status = 'undone';
      await saveJson(oldPath, old);
    }
    return {
      transactionId,
      status: 'completed',
      count: t.completed.length,
      notice: '已在本机执行，可在回收站撤销；未发布。',
    };
  } catch (e) {
    t.status = 'failed';
    t.error = e.publicMessage || '执行中断';
    await saveJson(file, t);
    fail('TRANSACTION_FAILED', '部分操作可能已完成，请查看回收站并预览撤销。', {
      transactionId,
      cause: e.code,
    });
  }
}
export async function trash(root) {
  const result = [];
  for (const path of await files(root, '.blog/trash'))
    if (/\/[a-f0-9-]{36}\.json$/.test(path)) {
      const t = await json(await safePath(root, path), null);
      result.push({
        transactionId: t.transactionId,
        kind: t.kind,
        status: t.status,
        createdAt: t.createdAt,
        count: t.changes.length,
        completed: t.completed.length,
        bytes: (await stat(await safePath(root, path))).size,
        paths: t.changes.map((c) => c.path),
      });
    }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
