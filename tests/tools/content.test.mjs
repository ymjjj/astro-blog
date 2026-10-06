import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { createBlog } from '../../tools/blog/core.mjs';

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'astro-blog-content-test-'));
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

async function createPost(blog, overrides = {}) {
  return blog.execute('create', {
    kind: 'posts',
    slug: 'test-post',
    title: 'Test post',
    description: 'A test post.',
    body: 'A body paragraph.',
    requestId: 'request-create-post-01',
    ...overrides,
  });
}

test('posts require both title and description', async () => {
  await withFixture(async (_root, blog) => {
    const missingTitle = await createPost(blog, {
      slug: 'missing-title',
      title: undefined,
      requestId: 'request-missing-title-01',
    });
    const missingDescription = await createPost(blog, {
      slug: 'missing-description',
      description: undefined,
      requestId: 'request-missing-desc-01',
    });

    assertError(missingTitle, 'INVALID_CONTENT');
    assertError(missingDescription, 'INVALID_CONTENT');
  });
});

test('moments can be created without a title and are drafts by default', async () => {
  await withFixture(async (_root, blog) => {
    const result = await blog.execute('create', {
      kind: 'moments',
      slug: 'small-thought',
      body: 'A short note.',
      requestId: 'request-create-moment-01',
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.id, 'moments/small-thought');
    assert.equal(Object.hasOwn(result.data.data, 'title'), false);
    assert.equal(result.data.data.draft, true);
  });
});

test('create replays identical request IDs and rejects changed parameters', async () => {
  await withFixture(async (_root, blog) => {
    const args = {
      kind: 'posts',
      slug: 'idempotent-post',
      title: 'Idempotent post',
      description: 'Request replay test.',
      body: 'Original body.',
      requestId: 'request-replay-0001',
    };
    const first = await blog.execute('create', args);
    const replay = await blog.execute('create', args);
    const conflict = await blog.execute('create', { ...args, body: 'Changed body.' });

    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(replay, first);
    assertError(conflict, 'REQUEST_CONFLICT');
  });
});

test('update accepts the current revision and rejects a stale revision', async () => {
  await withFixture(async (_root, blog) => {
    const created = await createPost(blog, { slug: 'revision-post' });
    assert.equal(created.ok, true, JSON.stringify(created));

    const updated = await blog.execute('update', {
      id: created.data.id,
      expectedRevision: created.data.revision,
      requestId: 'request-update-current-01',
      title: 'Updated test post',
      description: 'Updated description.',
      body: 'Updated body.',
    });
    assert.equal(updated.ok, true, JSON.stringify(updated));
    assert.equal(updated.data.data.title, 'Updated test post');
    assert.notEqual(updated.data.revision, created.data.revision);

    const stale = await blog.execute('update', {
      id: created.data.id,
      expectedRevision: created.data.revision,
      requestId: 'request-update-stale-0001',
      title: 'Stale overwrite',
      description: 'This must not replace the latest content.',
      body: 'Stale body.',
    });
    assertError(stale, 'REVISION_CONFLICT');
  });
});

test('list searches content and filters by kind and draft state', async () => {
  await withFixture(async (root, blog) => {
    await writeFile(
      join(root, 'src/content/posts/published-orchid.md'),
      [
        '---',
        'title: Published orchid',
        'description: An orchid in a published post.',
        'date: 2025-01-01T00:00:00.000Z',
        'draft: false',
        'tags:',
        '  - flowers',
        '---',
        'This published orchid is in the fixture.',
        '',
      ].join('\n'),
    );
    const draftPost = await createPost(blog, {
      slug: 'draft-orchid',
      title: 'Draft orchid',
      description: 'An orchid draft.',
      body: 'An orchid is growing.',
      requestId: 'request-list-post-0001',
    });
    const moment = await blog.execute('create', {
      kind: 'moments',
      slug: 'orchid-moment',
      body: 'An orchid moment.',
      requestId: 'request-list-moment-001',
    });
    assert.equal(draftPost.ok, true, JSON.stringify(draftPost));
    assert.equal(moment.ok, true, JSON.stringify(moment));

    const publishedPosts = await blog.execute('list', {
      query: 'ORCHID',
      kind: 'posts',
      draft: false,
    });
    const draftPosts = await blog.execute('list', {
      query: 'orchid',
      kind: 'posts',
      draft: true,
    });
    const draftMoments = await blog.execute('list', { kind: 'moments', draft: true });
    const publishedMoments = await blog.execute('list', { kind: 'moments', draft: false });

    assert.equal(publishedPosts.ok, true, JSON.stringify(publishedPosts));
    assert.deepEqual(
      publishedPosts.data.map((entry) => entry.id),
      ['posts/published-orchid'],
    );
    assert.equal(draftPosts.ok, true, JSON.stringify(draftPosts));
    assert.deepEqual(
      draftPosts.data.map((entry) => entry.id),
      ['posts/draft-orchid'],
    );
    assert.equal(draftMoments.ok, true, JSON.stringify(draftMoments));
    assert.deepEqual(
      draftMoments.data.map((entry) => entry.id),
      ['moments/orchid-moment'],
    );
    assert.equal(publishedMoments.ok, true, JSON.stringify(publishedMoments));
    assert.deepEqual(publishedMoments.data, []);
  });
});

test('read rejects IDs containing path traversal segments', async () => {
  await withFixture(async (_root, blog) => {
    const result = await blog.execute('read', { id: 'posts/../outside' });
    assertError(result, 'INVALID_INPUT');
  });
});

test('image import returns a managed asset and its Markdown passes check after update', async () => {
  await withFixture(async (_root, blog) => {
    const created = await createPost(blog, { slug: 'image-post' });
    assert.equal(created.ok, true, JSON.stringify(created));
    const png = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .png()
      .toBuffer();

    const imported = await blog.execute('image', {
      id: created.data.id,
      base64: png.toString('base64'),
      alt: 'Blue square',
      requestId: 'request-import-image-01',
    });
    assert.equal(imported.ok, true, JSON.stringify(imported));
    assert.match(imported.data.path, /^src\/assets\/uploads\/[a-f0-9]+\.webp$/);
    assert.match(
      imported.data.markdown,
      /^!\[Blue square\]\(\.\.\/\.\.\/assets\/uploads\/[a-f0-9]+\.webp\)$/,
    );

    const updated = await blog.execute('update', {
      id: created.data.id,
      expectedRevision: created.data.revision,
      requestId: 'request-update-image-01',
      body: `A blue image.\n\n${imported.data.markdown}`,
    });
    assert.equal(updated.ok, true, JSON.stringify(updated));

    const checked = await blog.execute('check', { id: created.data.id });
    assert.deepEqual(checked, { ok: true, data: { valid: true, checked: 1 } });
  });
});

test('remote publish stays disabled and leaves the source unchanged', async () => {
  await withFixture(async (_root, blog) => {
    const created = await createPost(blog, { slug: 'remote-disabled-post' });
    assert.equal(created.ok, true, JSON.stringify(created));

    const published = await blog.execute('publish', {
      id: created.data.id,
      expectedRevision: created.data.revision,
      requestId: 'request-remote-off-01',
      mode: 'remote',
    });
    assertError(published, 'REMOTE_DISABLED');

    const after = await blog.execute('read', { id: created.data.id });
    assert.equal(after.ok, true, JSON.stringify(after));
    assert.equal(after.data.revision, created.data.revision);
    assert.equal(after.data.data.draft, true);
    assert.equal(after.data.body, created.data.body);
  });
});
