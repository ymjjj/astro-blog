import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBlog } from '../../tools/blog/core.mjs';
import { lineDiff } from '../../tools/blog/history.mjs';

let requestNumber = 0;
const nextRequestId = () => `history-test-${String(++requestNumber).padStart(4, '0')}`;

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'astro-blog-history-test-'));
  try {
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

function assertSuccess(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function createPost(blog, overrides = {}) {
  return blog.execute('create', {
    kind: 'posts',
    slug: 'history-post',
    title: 'History post',
    description: 'A post for history tests.',
    date: '2025-01-01T00:00:00.000Z',
    body: 'Original body.',
    requestId: nextRequestId(),
    ...overrides,
  });
}

function recoveryForm(body = '') {
  return {
    kind: 'posts',
    slug: 'unfinished-post',
    title: 'Unfinished post',
    description: 'A recovery fixture.',
    date: '2025-01-01',
    updated: '',
    tags: '',
    body,
  };
}

function checkpointArgs(sessionId, expectedVersion, body) {
  return {
    sessionId,
    expectedVersion,
    requestId: nextRequestId(),
    id: null,
    baseRevision: null,
    form: recoveryForm(body),
  };
}

test('create, update, and autosave add history versions while unchanged saves do not', async () => {
  await withFixture(async (_root, blog) => {
    const created = assertSuccess(await createPost(blog));
    const createdHistory = assertSuccess(await blog.execute('history', { id: created.id }));
    assert.equal(createdHistory.versions.length, 1);
    assert.equal(createdHistory.versions[0].revision, created.revision);
    assert.equal(createdHistory.versions[0].reason, 'create');

    const updated = assertSuccess(
      await blog.execute('update', {
        id: created.id,
        expectedRevision: created.revision,
        requestId: nextRequestId(),
        title: 'Updated history post',
        body: 'Updated body.',
      }),
    );
    const autosaved = assertSuccess(
      await blog.execute('autosave', {
        id: created.id,
        expectedRevision: updated.revision,
        requestId: nextRequestId(),
        body: 'Autosaved body.',
      }),
    );

    const unchanged = assertSuccess(
      await blog.execute('update', {
        id: created.id,
        expectedRevision: autosaved.revision,
        requestId: nextRequestId(),
        body: autosaved.body,
      }),
    );
    assert.equal(unchanged.revision, autosaved.revision);

    const finalHistory = assertSuccess(await blog.execute('history', { id: created.id }));
    assert.equal(finalHistory.versions.length, 3);
    const byRevision = new Map(finalHistory.versions.map((version) => [version.revision, version]));
    assert.equal(byRevision.get(created.revision)?.reason, 'create');
    assert.equal(byRevision.get(updated.revision)?.reason, 'update');
    assert.equal(byRevision.get(autosaved.revision)?.reason, 'autosave');
    assert.equal(finalHistory.currentRevision, autosaved.revision);
  });
});

test('an autosave with a stale revision preserves an external write', async () => {
  await withFixture(async (root, blog) => {
    const created = assertSuccess(await createPost(blog));
    const file = join(root, 'src/content', `${created.id}.md`);
    const externalSource = [
      '---',
      'title: External edit',
      'description: Written outside the editor.',
      'date: 2025-01-01T00:00:00.000Z',
      'draft: true',
      'tags: []',
      '---',
      'External body must survive.',
      '',
    ].join('\n');
    await writeFile(file, externalSource);

    const autosave = await blog.execute('autosave', {
      id: created.id,
      expectedRevision: created.revision,
      requestId: nextRequestId(),
      body: 'Stale autosave must not replace this.',
    });
    assertError(autosave, 'REVISION_CONFLICT');
    assert.equal(await readFile(file, 'utf8'), externalSource);
    const current = assertSuccess(await blog.execute('read', { id: created.id }));
    assert.equal(current.data.title, 'External edit');
    assert.equal(current.body.trim(), 'External body must survive.');
  });
});

test('diff reports changed frontmatter fields and body lines', async () => {
  await withFixture(async (_root, blog) => {
    const created = assertSuccess(
      await createPost(blog, {
        title: 'Before title',
        description: 'Before description.',
        body: 'Opening line.\n\nOld paragraph.',
      }),
    );
    const updated = assertSuccess(
      await blog.execute('update', {
        id: created.id,
        expectedRevision: created.revision,
        requestId: nextRequestId(),
        title: 'After title',
        description: 'After description.',
        body: 'Opening line.\n\nNew paragraph.',
      }),
    );

    const result = assertSuccess(
      await blog.execute('diff', {
        id: created.id,
        fromRevision: created.revision,
        toRevision: updated.revision,
      }),
    );
    assert.deepEqual(result.fields, [
      { field: 'title', before: 'Before title', after: 'After title' },
      { field: 'description', before: 'Before description.', after: 'After description.' },
    ]);
    assert.ok(result.lines.some((line) => line.type === 'equal' && line.text === 'Opening line.'));
    assert.ok(
      result.lines.some((line) => line.type === 'remove' && line.text === 'Old paragraph.'),
    );
    assert.ok(result.lines.some((line) => line.type === 'add' && line.text === 'New paragraph.'));
  });
});

test('restore keeps the current draft state, rejects a stale revision, and replays by request ID', async () => {
  await withFixture(async (root, blog) => {
    const created = assertSuccess(
      await createPost(blog, { title: 'Original title', body: 'Original body.' }),
    );
    const file = join(root, 'src/content', `${created.id}.md`);
    const source = await readFile(file, 'utf8');
    assert.match(source, /draft: true/);
    await writeFile(file, source.replace('draft: true', 'draft: false'));
    const current = assertSuccess(await blog.execute('read', { id: created.id }));
    assert.equal(current.data.draft, false);

    const restoreArgs = {
      id: created.id,
      revision: created.revision,
      expectedRevision: current.revision,
      requestId: nextRequestId(),
    };
    const firstRestore = await blog.execute('restore', restoreArgs);
    const restored = assertSuccess(firstRestore);
    assert.equal(restored.data.title, 'Original title');
    assert.equal(restored.data.draft, false);
    assert.equal(restored.body.trim(), 'Original body.');
    assert.deepEqual(await blog.execute('restore', restoreArgs), firstRestore);

    const staleRestore = await blog.execute('restore', {
      ...restoreArgs,
      expectedRevision: created.revision,
      requestId: nextRequestId(),
    });
    assertError(staleRestore, 'REVISION_CONFLICT');
    const afterConflict = assertSuccess(await blog.execute('read', { id: created.id }));
    assert.equal(afterConflict.revision, restored.revision);
    assert.equal(afterConflict.body.trim(), 'Original body.');
  });
});

test('checkpoint accepts an empty body without creating a formal post', async () => {
  await withFixture(async (_root, blog) => {
    const sessionId = '00000000-0000-4000-8000-000000000001';
    const checkpoint = assertSuccess(
      await blog.execute('checkpoint', checkpointArgs(sessionId, null, '')),
    );
    assert.equal(checkpoint.form.body, '');

    const listed = assertSuccess(await blog.execute('recovery', {}));
    assert.deepEqual(listed, [checkpoint]);
    assert.deepEqual(assertSuccess(await blog.execute('recovery', { sessionId })), checkpoint);
    assert.deepEqual(assertSuccess(await blog.execute('list', { kind: 'posts' })), []);
  });
});

test('checkpoint and discard enforce recovery versions and cleanup removes the recovery copy', async () => {
  await withFixture(async (_root, blog) => {
    const sessionId = '00000000-0000-4000-8000-000000000002';
    const first = assertSuccess(
      await blog.execute('checkpoint', checkpointArgs(sessionId, null, 'First recovery body.')),
    );

    const staleCheckpoint = await blog.execute(
      'checkpoint',
      checkpointArgs(sessionId, null, 'Stale recovery body.'),
    );
    assertError(staleCheckpoint, 'RECOVERY_CONFLICT');

    const second = assertSuccess(
      await blog.execute(
        'checkpoint',
        checkpointArgs(sessionId, first.version, 'Second recovery body.'),
      ),
    );
    assert.notEqual(second.version, first.version);

    const staleDiscard = await blog.execute('discard', {
      sessionId,
      expectedVersion: first.version,
      requestId: nextRequestId(),
    });
    assertError(staleDiscard, 'RECOVERY_CONFLICT');
    assert.equal(
      assertSuccess(await blog.execute('recovery', { sessionId })).version,
      second.version,
    );

    const discarded = assertSuccess(
      await blog.execute('discard', {
        sessionId,
        expectedVersion: second.version,
        requestId: nextRequestId(),
      }),
    );
    assert.deepEqual(discarded, { discarded: true, sessionId });
    assert.deepEqual(assertSuccess(await blog.execute('recovery', {})), []);
    assertError(await blog.execute('recovery', { sessionId }), 'RECOVERY_NOT_FOUND');
  });
});

test('lineDiff handles a very long line and uses a bounded fallback for large changes', () => {
  const longBefore = 'a'.repeat(1_100_000);
  const longAfter = 'b'.repeat(1_100_000);
  const longResult = lineDiff(longBefore, longAfter);
  assert.equal(longResult.length, 2);
  assert.equal(longResult[0].type, 'remove');
  assert.equal(longResult[0].text.length, longBefore.length);
  assert.equal(longResult[1].type, 'add');
  assert.equal(longResult[1].text.length, longAfter.length);

  const before = [
    'unchanged first line',
    ...Array.from({ length: 1001 }, (_, i) => `old-${i}`),
    'unchanged last line',
  ].join('\n');
  const after = [
    'unchanged first line',
    ...Array.from({ length: 1001 }, (_, i) => `new-${i}`),
    'unchanged last line',
  ].join('\n');
  const result = lineDiff(before, after);
  const counts = result.reduce((all, line) => {
    all[line.type] = (all[line.type] || 0) + 1;
    return all;
  }, {});
  assert.deepEqual(counts, { equal: 2, remove: 1001, add: 1001 });
});
