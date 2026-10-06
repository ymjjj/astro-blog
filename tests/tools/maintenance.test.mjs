import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import sharp from 'sharp';
import { createBlog } from '../../tools/blog/core.mjs';

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'astro-blog-maintenance-test-'));
  try {
    assert.equal(isAbsolute(root), true, 'fixture root must be an absolute path');
    await Promise.all(
      ['src/content/posts', 'src/content/moments', 'src/assets'].map((directory) =>
        mkdir(join(root, directory), { recursive: true }),
      ),
    );
    return await run(root, createBlog(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function assertError(result, code) {
  assert.equal(result.ok, false, `expected ${code}, got ${JSON.stringify(result)}`);
  assert.equal(result.error.code, code, JSON.stringify(result));
}

async function createPost(blog, slug = 'maintenance-post') {
  return blog.execute('create', {
    kind: 'posts',
    slug,
    title: 'Maintenance test post',
    description: 'A post for maintenance tests.',
    body: 'Original body for maintenance.',
    requestId: `request-create-${slug}`,
  });
}

async function updateBody(blog, entry, body, requestId) {
  return blog.execute('update', {
    id: entry.id,
    expectedRevision: entry.revision,
    requestId,
    body,
  });
}

async function importImage(blog, id, color, requestId) {
  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  return blog.execute('image', {
    id,
    base64: png.toString('base64'),
    alt: `${color.r}-${color.g}-${color.b} square`,
    requestId,
  });
}

async function ageAsset(root, path) {
  const old = new Date(Date.now() - 2 * 86400000);
  await utimes(join(root, path), old, old);
}

async function cleanupPlan(blog, path, requestId) {
  return blog.execute('plan', { kind: 'cleanup', paths: [path], requestId });
}

async function applyPlan(blog, plan, requestId) {
  return blog.execute('apply', {
    planId: plan.planId,
    expectedPlan: plan.expectedPlan,
    confirm: true,
    requestId,
  });
}

function recoveryForm(body = 'Unfinished recovery body.') {
  return {
    kind: 'posts',
    slug: 'unfinished-post',
    title: 'Unfinished post',
    description: 'A recovery copy.',
    date: '2025-01-01T00:00:00.000Z',
    updated: '',
    tags: '',
    body,
  };
}

test('backup manifest, restore plan, apply, and undo preserve both versions', async () => {
  await withFixture(async (_root, blog) => {
    const created = await createPost(blog);
    assert.equal(created.ok, true, JSON.stringify(created));

    const exported = await blog.execute('backup', { requestId: 'request-backup-main-01' });
    assert.equal(exported.ok, true, JSON.stringify(exported));
    const checked = await blog.execute('backupcheck', { backupId: exported.data.backupId });
    assert.equal(checked.ok, true, JSON.stringify(checked));
    assert.equal(checked.data.verified, true);
    assert.equal(checked.data.backupId, exported.data.backupId);
    assert.ok(
      checked.data.files.some((file) => file.path === 'src/content/posts/maintenance-post.md'),
    );
    assert.equal(
      checked.data.bytes,
      checked.data.files.reduce((total, file) => total + file.bytes, 0),
    );
    assert.equal(
      checked.data.files.every(
        (file) => Object.keys(file).sort().join(',') === 'bytes,path,sha256',
      ),
      true,
    );

    const updated = await updateBody(
      blog,
      created.data,
      'Updated body before restore.',
      'request-update-before-restore-01',
    );
    assert.equal(updated.ok, true, JSON.stringify(updated));

    const restore = await blog.execute('plan', {
      kind: 'restore',
      backupId: exported.data.backupId,
      requestId: 'request-plan-restore-main-01',
    });
    assert.equal(restore.ok, true, JSON.stringify(restore));
    const preview = restore.data.files.find(
      (file) => file.path === 'src/content/posts/maintenance-post.md',
    );
    assert.ok(preview);
    assert.match(preview.beforePreview, /Updated body before restore\./);
    assert.match(preview.afterPreview, /Original body for maintenance\./);

    const restored = await applyPlan(blog, restore.data, 'request-apply-restore-main-01');
    assert.equal(restored.ok, true, JSON.stringify(restored));
    const afterRestore = await blog.execute('read', { id: created.data.id });
    assert.equal(afterRestore.ok, true, JSON.stringify(afterRestore));
    assert.match(afterRestore.data.body, /Original body for maintenance\./);

    const undo = await blog.execute('plan', {
      kind: 'undo',
      transactionId: restored.data.transactionId,
      requestId: 'request-plan-undo-main-01',
    });
    assert.equal(undo.ok, true, JSON.stringify(undo));
    const undone = await applyPlan(blog, undo.data, 'request-apply-undo-main-01');
    assert.equal(undone.ok, true, JSON.stringify(undone));
    const afterUndo = await blog.execute('read', { id: created.data.id });
    assert.equal(afterUndo.ok, true, JSON.stringify(afterUndo));
    assert.match(afterUndo.data.body, /Updated body before restore\./);
  });
});

test('apply rejects a restore plan made stale by a later update', async () => {
  await withFixture(async (_root, blog) => {
    const created = await createPost(blog, 'stale-plan-post');
    assert.equal(created.ok, true, JSON.stringify(created));
    const exported = await blog.execute('backup', { requestId: 'request-backup-stale-01' });
    assert.equal(exported.ok, true, JSON.stringify(exported));

    const plan = await blog.execute('plan', {
      kind: 'restore',
      backupId: exported.data.backupId,
      requestId: 'request-plan-stale-restore-01',
    });
    assert.equal(plan.ok, true, JSON.stringify(plan));
    const updated = await updateBody(
      blog,
      created.data,
      'Content saved after the plan.',
      'request-update-after-plan-01',
    );
    assert.equal(updated.ok, true, JSON.stringify(updated));

    const applied = await applyPlan(blog, plan.data, 'request-apply-stale-plan-01');
    assertError(applied, 'PLAN_STALE');
    const current = await blog.execute('read', { id: created.data.id });
    assert.equal(current.ok, true, JSON.stringify(current));
    assert.match(current.data.body, /Content saved after the plan\./);
  });
});

test('recovery copies support query and byte summaries, cleanup, trash, and undo', async () => {
  await withFixture(async (_root, blog) => {
    const sessionId = randomUUID();
    const checkpoint = await blog.execute('checkpoint', {
      sessionId,
      expectedVersion: null,
      requestId: 'request-checkpoint-recovery-01',
      id: null,
      baseRevision: null,
      form: recoveryForm('Searchable recovery body.'),
    });
    assert.equal(checkpoint.ok, true, JSON.stringify(checkpoint));

    const queried = await blog.execute('recovery', { query: 'searchable recovery body' });
    assert.equal(queried.ok, true, JSON.stringify(queried));
    assert.deepEqual(
      queried.data.map((item) => item.sessionId),
      [sessionId],
    );
    const summary = await blog.execute('recovery', { query: sessionId, summary: true });
    assert.equal(summary.ok, true, JSON.stringify(summary));
    assert.equal(summary.data.length, 1);
    assert.equal(
      summary.data[0].bytes,
      (await stat(join(_root, `.blog/recovery/${sessionId}.json`))).size,
    );
    assert.equal(summary.data[0].path, `.blog/recovery/${sessionId}.json`);

    const path = `.blog/recovery/${sessionId}.json`;
    const cleanup = await cleanupPlan(blog, path, 'request-plan-recovery-cleanup-01');
    assert.equal(cleanup.ok, true, JSON.stringify(cleanup));
    assert.deepEqual(
      cleanup.data.files.map((file) => file.path),
      [path],
    );
    const applied = await applyPlan(blog, cleanup.data, 'request-apply-recovery-cleanup-01');
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assertError(await blog.execute('recovery', { sessionId }), 'RECOVERY_NOT_FOUND');

    const trash = await blog.execute('trash');
    assert.equal(trash.ok, true, JSON.stringify(trash));
    assert.ok(trash.data.some((item) => item.transactionId === applied.data.transactionId));

    const undo = await blog.execute('plan', {
      kind: 'undo',
      transactionId: applied.data.transactionId,
      requestId: 'request-plan-recovery-undo-01',
    });
    assert.equal(undo.ok, true, JSON.stringify(undo));
    const undone = await applyPlan(blog, undo.data, 'request-apply-recovery-undo-01');
    assert.equal(undone.ok, true, JSON.stringify(undone));
    const recovered = await blog.execute('recovery', { sessionId });
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(recovered.data.form.body, 'Searchable recovery body.');
  });
});

test('asset cleanup observes the import grace period and content, history, and recovery references', async () => {
  await withFixture(async (root, blog) => {
    const created = await createPost(blog, 'asset-reference-post');
    assert.equal(created.ok, true, JSON.stringify(created));

    const unused = await importImage(
      blog,
      created.data.id,
      { r: 210, g: 20, b: 20 },
      'request-image-unused-01',
    );
    assert.equal(unused.ok, true, JSON.stringify(unused));
    const freshAsset = (await blog.execute('assets')).data.images.find(
      (image) => image.path === unused.data.path,
    );
    assert.equal(freshAsset.cleanupAllowed, false);
    assert.ok(Date.parse(freshAsset.protectedUntil) > Date.now());
    assertError(
      await cleanupPlan(blog, unused.data.path, 'request-plan-fresh-asset-01'),
      'ASSET_PROTECTED',
    );
    await ageAsset(root, unused.data.path);
    const oldUnused = (await blog.execute('assets')).data.images.find(
      (image) => image.path === unused.data.path,
    );
    assert.equal(oldUnused.cleanupAllowed, true);
    const unusedPlan = await cleanupPlan(blog, unused.data.path, 'request-plan-old-asset-01');
    assert.equal(unusedPlan.ok, true, JSON.stringify(unusedPlan));
    assert.deepEqual(
      unusedPlan.data.files.map((file) => file.path),
      [unused.data.path],
    );

    const inContent = await importImage(
      blog,
      created.data.id,
      { r: 20, g: 190, b: 20 },
      'request-image-content-01',
    );
    assert.equal(inContent.ok, true, JSON.stringify(inContent));
    const contentUpdate = await updateBody(
      blog,
      created.data,
      `Body reference: ${inContent.data.markdown}`,
      'request-update-content-image-01',
    );
    assert.equal(contentUpdate.ok, true, JSON.stringify(contentUpdate));
    await ageAsset(root, inContent.data.path);
    const contentAsset = (await blog.execute('assets')).data.images.find(
      (image) => image.path === inContent.data.path,
    );
    assert.ok(contentAsset.references.some((reference) => reference.type === 'content'));
    assert.equal(contentAsset.cleanupAllowed, false);
    assertError(
      await cleanupPlan(blog, inContent.data.path, 'request-plan-content-asset-01'),
      'ASSET_PROTECTED',
    );

    const inHistory = await importImage(
      blog,
      created.data.id,
      { r: 20, g: 20, b: 210 },
      'request-image-history-01',
    );
    assert.equal(inHistory.ok, true, JSON.stringify(inHistory));
    const historyUpdate = await updateBody(
      blog,
      contentUpdate.data,
      `Historical reference: ${inHistory.data.markdown}`,
      'request-update-history-image-01',
    );
    assert.equal(historyUpdate.ok, true, JSON.stringify(historyUpdate));
    const removeHistoryReference = await updateBody(
      blog,
      historyUpdate.data,
      'The current body no longer uses the imported image.',
      'request-remove-history-image-01',
    );
    assert.equal(removeHistoryReference.ok, true, JSON.stringify(removeHistoryReference));
    await ageAsset(root, inHistory.data.path);
    const historyAsset = (await blog.execute('assets')).data.images.find(
      (image) => image.path === inHistory.data.path,
    );
    assert.ok(historyAsset.references.some((reference) => reference.type === 'history'));
    assert.equal(historyAsset.cleanupAllowed, false);
    assertError(
      await cleanupPlan(blog, inHistory.data.path, 'request-plan-history-asset-01'),
      'ASSET_PROTECTED',
    );

    const inRecovery = await importImage(
      blog,
      created.data.id,
      { r: 190, g: 20, b: 190 },
      'request-image-recovery-01',
    );
    assert.equal(inRecovery.ok, true, JSON.stringify(inRecovery));
    const sessionId = randomUUID();
    const recovery = await blog.execute('checkpoint', {
      sessionId,
      expectedVersion: null,
      requestId: 'request-checkpoint-image-recovery-01',
      id: null,
      baseRevision: null,
      form: recoveryForm(`Recovery reference: ${inRecovery.data.markdown}`),
    });
    assert.equal(recovery.ok, true, JSON.stringify(recovery));
    await ageAsset(root, inRecovery.data.path);
    const recoveryAsset = (await blog.execute('assets')).data.images.find(
      (image) => image.path === inRecovery.data.path,
    );
    assert.ok(recoveryAsset.references.some((reference) => reference.type === 'recovery'));
    assert.equal(recoveryAsset.cleanupAllowed, false);
    assertError(
      await cleanupPlan(blog, inRecovery.data.path, 'request-plan-recovery-asset-01'),
      'ASSET_PROTECTED',
    );
  });
});

test('backupimport rejects a gzip archive with a damaged checksum', async () => {
  await withFixture(async (_root, blog) => {
    const damaged = gzipSync(Buffer.from('{}'));
    damaged[damaged.length - 1] ^= 0xff;
    const imported = await blog.execute('backupimport', {
      base64: damaged.toString('base64'),
      requestId: 'request-backupimport-damaged-01',
    });
    assertError(imported, 'INVALID_BACKUP');
  });
});

test('applying the same request ID twice returns the original result', async () => {
  await withFixture(async (_root, blog) => {
    const sessionId = randomUUID();
    const saved = await blog.execute('checkpoint', {
      sessionId,
      expectedVersion: null,
      requestId: 'request-checkpoint-idempotent-01',
      id: null,
      baseRevision: null,
      form: recoveryForm('Idempotent recovery body.'),
    });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const plan = await blog.execute('plan', {
      kind: 'cleanup',
      paths: [`.blog/recovery/${sessionId}.json`],
      requestId: 'request-plan-idempotent-01',
    });
    assert.equal(plan.ok, true, JSON.stringify(plan));

    const args = {
      planId: plan.data.planId,
      expectedPlan: plan.data.expectedPlan,
      confirm: true,
      requestId: 'request-apply-idempotent-01',
    };
    const first = await blog.execute('apply', args);
    const replay = await blog.execute('apply', args);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(replay, first);
    assert.equal((await blog.execute('trash')).data.length, 1);
  });
});
