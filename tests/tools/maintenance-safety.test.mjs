import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { createBlog } from '../../tools/blog/core.mjs';
import { hash } from '../../tools/blog/storage.mjs';
const requestId = () => randomUUID();
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'blog-maintenance-safety-'));
  try {
    for (const p of ['src/content/posts', 'src/content/moments', 'src/assets', '.blog'])
      await mkdir(join(root, p), { recursive: true });
    await fn(root, createBlog(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const ok = (r) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data;
};
const reject = (r, code) => {
  assert.equal(r.ok, false);
  assert.equal(r.error.code, code, JSON.stringify(r));
};
const create = async (b) =>
  ok(await b.execute('create', { kind: 'moments', body: '原始正文', requestId: requestId() }));
const apply = async (b, p) =>
  b.execute('apply', {
    planId: p.planId,
    expectedPlan: p.expectedPlan,
    confirm: true,
    requestId: requestId(),
  });

test('无引用图片清理后可逐字节撤销，预览后新增引用使计划失效', async () =>
  fixture(async (root, b) => {
    const content = await create(b);
    const asset = ok(
      await b.execute('image', {
        id: content.id,
        alt: '未引用图',
        base64: (
          await sharp({ create: { width: 12, height: 12, channels: 3, background: '#22ccef' } })
            .png()
            .toBuffer()
        ).toString('base64'),
        requestId: requestId(),
      }),
    );
    const path = join(root, asset.path),
      bytes = await readFile(path);
    await utimes(path, new Date(0), new Date(0));
    const plan = ok(
      await b.execute('plan', { kind: 'cleanup', paths: [asset.path], requestId: requestId() }),
    );
    const result = ok(await apply(b, plan));
    await assert.rejects(readFile(path), { code: 'ENOENT' });
    const undo = ok(
      await b.execute('plan', {
        kind: 'undo',
        transactionId: result.transactionId,
        requestId: requestId(),
      }),
    );
    ok(await apply(b, undo));
    assert.deepEqual(await readFile(path), bytes);
    await utimes(path, new Date(0), new Date(0));
    const stale = ok(
      await b.execute('plan', { kind: 'cleanup', paths: [asset.path], requestId: requestId() }),
    );
    ok(
      await b.execute('update', {
        id: content.id,
        expectedRevision: content.revision,
        body: asset.markdown,
        requestId: requestId(),
      }),
    );
    reject(await apply(b, stale), 'PLAN_STALE');
    assert.deepEqual(await readFile(path), bytes);
  }));
const envelope = (files) => {
  const b = { format: 'between-pages-backup-v1', createdAt: new Date().toISOString(), files };
  b.manifestHash = hash(
    JSON.stringify({
      ...b,
      files: files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
    }),
  );
  return gzipSync(JSON.stringify(b)).toString('base64');
};
const entry = (path, text) => ({
  path,
  bytes: Buffer.byteLength(text),
  sha256: hash(text),
  data: Buffer.from(text).toString('base64'),
});

test('备份拒绝穿越、Windows危险路径、配置文件、重复路径、篡改内容和错名托管图片', async () =>
  fixture(async (root, b) => {
    for (const paths of [
      ['../outside.png'],
      ['src/assets/../outside.png'],
      ['src/assets/CON.png'],
      ['src/assets/test.png:evil'],
      ['.blog/publish.json'],
      ['src/assets/a.png', 'src/assets/A.png'],
      ['src/assets/uploads/' + 'a'.repeat(64) + '.webp'],
    ]) {
      reject(
        await b.execute('backupimport', {
          base64: envelope(paths.map((p) => entry(p, 'invalid bytes'))),
          requestId: requestId(),
        }),
        'INVALID_BACKUP',
      );
    }
    const corrupted = entry('src/assets/x.png', 'a');
    corrupted.data = Buffer.from('b').toString('base64');
    reject(
      await b.execute('backupimport', { base64: envelope([corrupted]), requestId: requestId() }),
      'INVALID_BACKUP',
    );
    reject(await b.execute('asset', { path: '../private.png' }), 'INVALID_IMAGE');
    await writeFile(join(root, '.blog/publish.json'), 'PRIVATE_CONFIG_SENTINEL');
    await writeFile(join(root, '.env'), 'PRIVATE_ENV_SENTINEL');
    await create(b);
    const archive = ok(await b.execute('backup', { requestId: requestId() }));
    const decoded = gunzipSync(await readFile(join(root, archive.path))).toString();
    assert.equal(decoded.includes('PRIVATE_'), false);
  }));

test('撤销不能覆盖后续编辑，回收站中的副本仍保护所引用图片', async () =>
  fixture(async (root, b) => {
    const c = await create(b);
    const image = ok(
      await b.execute('image', {
        id: c.id,
        alt: '保护图',
        base64: (
          await sharp({ create: { width: 8, height: 8, channels: 3, background: '#8375aa' } })
            .png()
            .toBuffer()
        ).toString('base64'),
        requestId: requestId(),
      }),
    );
    await utimes(join(root, image.path), new Date(0), new Date(0));
    const r = ok(
      await b.execute('checkpoint', {
        sessionId: randomUUID(),
        expectedVersion: null,
        id: null,
        baseRevision: null,
        requestId: requestId(),
        form: {
          kind: 'moments',
          slug: '',
          title: '',
          description: '',
          date: '',
          updated: '',
          tags: '',
          body:
            '50% ' +
            image.markdown.replace(
              /[a-f0-9]{64}/,
              (s) => '%' + s.charCodeAt(0).toString(16) + s.slice(1).toUpperCase(),
            ),
        },
      }),
    );
    const path = `.blog/recovery/${r.sessionId}.json`;
    const cleanup = ok(
      await b.execute('plan', { kind: 'cleanup', paths: [path], requestId: requestId() }),
    );
    const tx = ok(await apply(b, cleanup));
    const asset = ok(await b.execute('assets')).images.find((a) => a.path === image.path);
    assert.equal(asset.cleanupAllowed, false);
    assert.ok(asset.references.some((r) => r.type === 'trash'));
    await b.execute('checkpoint', {
      sessionId: r.sessionId,
      expectedVersion: null,
      id: null,
      baseRevision: null,
      requestId: requestId(),
      form: { ...r.form, body: '后来创建的副本' },
    });
    reject(
      await b.execute('plan', {
        kind: 'undo',
        transactionId: tx.transactionId,
        requestId: requestId(),
      }),
      'PLAN_STALE',
    );
  }));

test('执行前必须确认且计划内容不可篡改；空白项目可导入备份并恢复', async () =>
  fixture(async (root, b) => {
    await create(b);
    const exported = ok(await b.execute('backup', { requestId: requestId() }));
    await fixture(async (other, c) => {
      const imported = ok(
        await c.execute('backupimport', {
          file: join(root, exported.path),
          requestId: requestId(),
        }),
      );
      const p = ok(
        await c.execute('plan', {
          kind: 'restore',
          backupId: imported.backupId,
          requestId: requestId(),
        }),
      );
      reject(
        await c.execute('apply', {
          planId: p.planId,
          expectedPlan: p.expectedPlan,
          requestId: requestId(),
        }),
        'INVALID_INPUT',
      );
      ok(await apply(c, p));
      assert.equal(ok(await c.execute('list')).length, 1);
      const second = ok(
        await c.execute('plan', {
          kind: 'restore',
          backupId: imported.backupId,
          requestId: requestId(),
        }),
      );
      const f = join(other, '.blog/plans', second.planId + '.json');
      const data = JSON.parse(await readFile(f, 'utf8'));
      data.kind = 'cleanup';
      await writeFile(f, JSON.stringify(data));
      reject(await apply(c, second), 'PLAN_STALE');
    });
  }));

test('模拟执行中断后，可依据预先保存的事务记录安全撤销', async () =>
  fixture(async (root, b) => {
    const a = ok(
      await b.execute('checkpoint', {
        sessionId: randomUUID(),
        expectedVersion: null,
        id: null,
        baseRevision: null,
        requestId: requestId(),
        form: {
          kind: 'moments',
          slug: '',
          title: '',
          description: '',
          date: '',
          updated: '',
          tags: '',
          body: 'A',
        },
      }),
    );
    // Simulate a process interrupted after removing the first file: journal must allow safe undo.
    const path = `.blog/recovery/${a.sessionId}.json`,
      source = await readFile(join(root, path));
    const tx = randomUUID();
    await mkdir(join(root, '.blog/trash'), { recursive: true });
    await writeFile(
      join(root, '.blog/trash', tx + '.json'),
      JSON.stringify({
        transactionId: tx,
        kind: 'cleanup',
        status: 'applying',
        createdAt: new Date().toISOString(),
        completed: [],
        changes: [
          {
            path,
            before: {
              path,
              bytes: source.length,
              sha256: hash(source),
              data: source.toString('base64'),
            },
            after: null,
          },
        ],
      }),
    );
    await rm(join(root, path));
    const p = ok(
      await b.execute('plan', { kind: 'undo', transactionId: tx, requestId: requestId() }),
    );
    ok(await apply(b, p));
    assert.equal(ok(await b.execute('recovery', { sessionId: a.sessionId })).form.body, 'A');
  }));
