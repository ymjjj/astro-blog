import { readFile, writeFile, rename, mkdir, rm, readdir, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, join, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { errorResult } from './contracts.mjs';

export function fail(code, message, details) {
  const error = new Error(message);
  Object.assign(error, { code, publicMessage: message, details });
  throw error;
}
export const hash = (input) => createHash('sha256').update(input).digest('hex');
export const within = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
export async function safePath(root, path) {
  root = await realpath(root);
  path = resolve(root, path);
  if (!within(root, path)) fail('PATH_ESCAPE', '路径不能越过项目目录');
  let parent = path;
  while (true) {
    try {
      const actual = await realpath(parent);
      if (!within(root, actual)) fail('PATH_ESCAPE', '路径不能通过符号链接越过项目目录');
      break;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      parent = dirname(parent);
    }
  }
  return path;
}
export async function atomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
export async function json(path, fallback) {
  try {
    return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}
export const saveJson = (path, value) => atomic(path, JSON.stringify(value, null, 2) + '\n');
export async function walk(path) {
  const output = [];
  for (const e of await readdir(path, { withFileTypes: true })) {
    if (e.isSymbolicLink()) fail('SYMLINK_CONTENT', '内容目录不能包含符号链接');
    const file = join(path, e.name);
    if (e.isDirectory()) output.push(...(await walk(file)));
    else output.push(file);
  }
  return output;
}
export async function locked(root, fn) {
  const dir = await safePath(root, '.blog');
  await mkdir(dir, { recursive: true });
  const lock = join(dir, 'lock');
  try {
    await mkdir(lock);
  } catch (e) {
    if (e.code === 'EEXIST')
      fail(
        'BUSY',
        '另一个写作或发布操作正在执行，请稍后重试。若进程异常退出，请确认没有运行任务后移除 .blog/lock。',
      );
    throw e;
  }
  try {
    await writeFile(
      join(lock, 'owner.json'),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
export async function replay(root, operation, args, fn) {
  return locked(root, async () => {
    const path = await safePath(root, `.blog/requests/${args.requestId}.json`);
    const fingerprint = hash(JSON.stringify({ operation, args }));
    const previous = await json(path, null);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        fail('REQUEST_CONFLICT', '此 requestId 已被其他参数使用，请使用新的 requestId。');
      if (previous.result) return previous.result;
      fail(
        'REQUEST_INTERRUPTED',
        '此请求曾中断，请先读取内容或发布状态检查结果，再用新 requestId 操作。',
        { jobId: previous.jobId },
      );
    }
    await saveJson(path, { fingerprint, startedAt: new Date().toISOString() });
    let result;
    try {
      result = await fn(async (jobId) => saveJson(path, { fingerprint, jobId }));
    } catch (error) {
      result = errorResult(error);
    }
    await saveJson(path, { fingerprint, result });
    return result;
  });
}
