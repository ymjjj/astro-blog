import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import { safePath, hash, saveJson, json, fail } from './storage.mjs';

const historyDir = (root, id) => safePath(root, `.blog/history/${id}`);
export async function remember(root, id, source, reason) {
  const revision = hash(source);
  const file = await safePath(root, `.blog/history/${id}/${revision}.json`);
  if (!(await json(file, null)))
    await saveJson(file, { id, revision, source, reason, recordedAt: new Date().toISOString() });
  return revision;
}
export async function version(root, id, revision) {
  const current = await readFile(await safePath(root, `src/content/${id}.md`), 'utf8');
  if (hash(current) === revision) return { id, revision, source: current, reason: 'current' };
  const item = await json(await safePath(root, `.blog/history/${id}/${revision}.json`), null);
  if (!item) fail('VERSION_NOT_FOUND', '找不到这个历史版本，请重新读取 history。');
  if (item.id !== id || hash(item.source) !== revision)
    fail('HISTORY_CORRUPT', '历史文件校验失败，请从备份恢复。');
  return item;
}
export async function history(root, id) {
  const source = await readFile(await safePath(root, `src/content/${id}.md`), 'utf8');
  const currentRevision = hash(source);
  let names = [];
  try {
    names = await readdir(await historyDir(root, id));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const versions = [];
  for (const name of names.filter((n) => /^[a-f0-9]{64}\.json$/.test(n))) {
    const item = await version(root, id, name.slice(0, -5));
    // Read the stored timestamp even when this version also matches current content.
    const stored = await json(await safePath(root, `.blog/history/${id}/${name}`), null);
    const { data, content } = matter(item.source);
    versions.push({
      revision: item.revision,
      recordedAt: stored.recordedAt,
      reason: stored.reason,
      title: data.title || '',
      excerpt: content.slice(0, 120),
      current: item.revision === currentRevision,
    });
  }
  if (!versions.some((v) => v.current))
    versions.push({
      revision: currentRevision,
      recordedAt: null,
      reason: 'external',
      current: true,
    });
  versions.sort((a, b) => (b.recordedAt || 'z').localeCompare(a.recordedAt || 'z'));
  return { id, currentRevision, versions };
}
// Bounded LCS: large documents fall back to one replacement block, not quadratic allocation.
export function lineDiff(before, after) {
  const a = before.split('\n'),
    b = after.split('\n');
  let prefix = 0,
    suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  const x = a.slice(prefix, a.length - suffix),
    y = b.slice(prefix, b.length - suffix),
    lines = [];
  const add = (type, text) => lines.push({ type, text });
  a.slice(0, prefix).forEach((s) => add('equal', s));
  if (x.length * y.length <= 1000000) {
    const table = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--)
        table[i][j] =
          x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0,
      j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        add('equal', x[i++]);
        j++;
      } else if (i < x.length && (j === y.length || table[i + 1][j] >= table[i][j + 1]))
        add('remove', x[i++]);
      else add('add', y[j++]);
    }
  } else {
    x.forEach((s) => add('remove', s));
    y.forEach((s) => add('add', s));
  }
  if (suffix) a.slice(-suffix).forEach((s) => add('equal', s));
  return lines;
}
export async function diff(root, args, currentRevision) {
  const from = await version(root, args.id, args.fromRevision);
  const to = await version(root, args.id, args.toRevision || currentRevision);
  const a = matter(from.source),
    b = matter(to.source);
  const fields = [];
  for (const key of new Set([...Object.keys(a.data), ...Object.keys(b.data)])) {
    if (JSON.stringify(a.data[key]) !== JSON.stringify(b.data[key]))
      fields.push({ field: key, before: a.data[key] ?? null, after: b.data[key] ?? null });
  }
  return {
    id: args.id,
    fromRevision: from.revision,
    toRevision: to.revision,
    fields,
    lines: lineDiff(a.content, b.content),
  };
}
export async function recovery(root, args) {
  if (args.sessionId) {
    const result = await json(await safePath(root, `.blog/recovery/${args.sessionId}.json`), null);
    if (!result) fail('RECOVERY_NOT_FOUND', '恢复副本不存在，可能已清理。');
    return result;
  }
  let names = [];
  try {
    names = await readdir(await safePath(root, '.blog/recovery'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const items = [];
  for (const name of names.filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))) {
    const item = await json(await safePath(root, `.blog/recovery/${name}`), null);
    if (
      item &&
      (!args.query || JSON.stringify(item).toLowerCase().includes(args.query.toLowerCase()))
    ) {
      if (args.summary)
        items.push({
          ...item,
          path: `.blog/recovery/${name}`,
          bytes: (await stat(await safePath(root, `.blog/recovery/${name}`))).size,
        });
      else items.push(item);
    }
  }
  return items.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export async function checkpoint(root, args) {
  if (
    Boolean(args.id) !== Boolean(args.baseRevision) ||
    (args.id && !args.id.startsWith(args.form.kind + '/'))
  )
    fail('INVALID_INPUT', '已有内容需提供匹配的 id、kind 和 baseRevision；新内容二者均为 null。');
  const path = await safePath(root, `.blog/recovery/${args.sessionId}.json`);
  const previous = await json(path, null);
  if ((previous?.version ?? null) !== args.expectedVersion)
    fail('RECOVERY_CONFLICT', '恢复副本已被其他会话修改，请读取后另建会话保留双方内容。');
  const { requestId, expectedVersion, ...data } = args;
  const savedAt = new Date().toISOString();
  const item = { ...data, savedAt, version: hash(JSON.stringify({ ...data, savedAt, requestId })) };
  await saveJson(path, item);
  return item;
}
export async function discard(root, args) {
  const item = await recovery(root, args);
  if (item.version !== args.expectedVersion)
    fail('RECOVERY_CONFLICT', '恢复副本已变化，请重新读取再清理。');
  const path = `.blog/recovery/${args.sessionId}.json`;
  const bytes = await readFile(await safePath(root, path));
  const transactionId = randomUUID();
  const record = {
    transactionId,
    kind: 'discard',
    createdAt: new Date().toISOString(),
    status: 'applying',
    completed: [],
    changes: [
      {
        path,
        before: { path, bytes: bytes.length, sha256: hash(bytes), data: bytes.toString('base64') },
        after: null,
      },
    ],
  };
  const journal = await safePath(root, `.blog/trash/${transactionId}.json`);
  await saveJson(journal, record);
  await rm(await safePath(root, `.blog/recovery/${args.sessionId}.json`));
  record.status = 'completed';
  record.completed = [path];
  await saveJson(journal, record);
  return { discarded: true, sessionId: args.sessionId };
}
