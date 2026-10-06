import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createBlog } from '../../tools/blog/core.mjs';
import { run } from '../../tools/blog/publishing.mjs';
import { jobView } from '../../tools/blog/publish-center.mjs';
const target = {
  repository: 'example/notebook',
  branch: 'main',
  site: 'https://example.github.io',
  base: '/notebook/',
};
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'blog-center-'));
  try {
    for (const dir of ['src/content/posts', 'src/content/moments', 'src/assets', 'public', '.blog'])
      await mkdir(join(root, dir), { recursive: true });
    await fn(root, createBlog(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const create = async (blog) =>
  (
    await blog.execute('create', {
      kind: 'moments',
      slug: 'center-note',
      body: 'original',
      requestId: randomUUID(),
    })
  ).data;
test('配置向导默认关闭远程、版本检查、幂等保存且不写 Git', () =>
  fixture(async (root, blog) => {
    const first = await blog.execute('setup');
    assert.equal(first.data.revision, null);
    assert.equal(first.data.complete, false);
    const args = { target, expectedConfig: null, requestId: randomUUID() };
    const saved = await blog.execute('configure', args);
    assert.equal(saved.ok, true);
    assert.equal(saved.data.remoteEnabled, false);
    assert.deepEqual(await blog.execute('configure', args), saved);
    assert.equal(
      JSON.parse(await readFile(join(root, '.blog/publish.json'), 'utf8')).enabled,
      false,
    );
    assert.equal(
      (await blog.execute('configure', { ...args, requestId: randomUUID() })).error.code,
      'CONFIG_CONFLICT',
    );
    assert.equal((await readdir(root)).includes('.git'), false);
    const config = JSON.parse(await readFile(join(root, '.blog/publish.json'), 'utf8'));
    config.enabled = true;
    await writeFile(join(root, '.blog/publish.json'), JSON.stringify(config));
    const changed = await blog.execute('setup');
    assert.equal(changed.data.remoteEnabled, true);
    const off = await blog.execute('configure', {
      target,
      expectedConfig: changed.data.revision,
      requestId: randomUUID(),
    });
    assert.equal(off.data.remoteEnabled, false);
  }));
test('凭据、非 HTTPS 和危险配置输入在请求记录之前拒绝；损坏配置可修复', () =>
  fixture(async (root, blog) => {
    for (const bad of [
      { ...target, site: 'https://user:SECRET_54321@example.com' },
      { ...target, token: 'SECRET_54321' },
      { ...target, site: 'http://example.com' },
      { ...target, branch: 'main//bad' },
      { ...target, base: '/../' },
    ]) {
      const r = await blog.execute('configure', {
        target: bad,
        expectedConfig: null,
        requestId: randomUUID(),
      });
      assert.equal(r.error.code, 'INVALID_INPUT');
      assert.equal(JSON.stringify(r).includes('SECRET_54321'), false);
    }
    assert.deepEqual(await readdir(join(root, '.blog')), []);
    await writeFile(join(root, '.blog/publish.json'), '{"token":"SECRET_54321"}');
    const setup = await blog.execute('setup');
    assert.equal(setup.ok, true);
    assert.equal(setup.data.valid, false);
    assert.equal(JSON.stringify(setup).includes('SECRET_54321'), false);
    assert.equal((await blog.execute('config')).ok, true);
    const fixed = await blog.execute('configure', {
      target,
      expectedConfig: setup.data.revision,
      requestId: randomUUID(),
    });
    assert.equal(fixed.data.valid, true);
  }));
test('Git 本地差异区分新建、修改、草稿及删除，未知基线不冒充线上', () =>
  fixture(async (root, blog) => {
    const e = await create(blog);
    let pending = await blog.execute('pending');
    assert.equal(pending.data.basis, 'unknown');
    assert.equal(pending.data.items[0].comparison, 'unknown');
    const cmd = async (args) => {
      const r = await run(root, 'git', args);
      assert.equal(r.code, 0, r.err);
      return r;
    };
    await cmd(['init', '-b', 'main']);
    await cmd(['config', 'user.email', 'test@example.invalid']);
    await cmd(['config', 'user.name', 'Local Test']);
    const file = join(root, 'src/content', e.id + '.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('draft: true', 'draft: false'));
    await cmd(['add', 'src']);
    await cmd(['commit', '-m', 'local fixture']);
    pending = await blog.execute('pending');
    assert.equal(pending.data.items[0].state, 'unchanged');
    assert.equal(pending.data.basis, 'local-head');
    await writeFile(file, (await readFile(file, 'utf8')).replace('original', 'updated'));
    assert.equal((await blog.execute('pending')).data.items[0].state, 'modified');
    const fresh = (await blog.execute('read', { id: e.id })).data;
    const p = await blog.execute('preflight', { id: e.id, expectedRevision: fresh.revision });
    assert.equal(p.data.basis, 'head');
    assert.ok(p.data.lines.some((l) => l.type === 'remove' && l.text === 'original'));
    assert.ok(p.data.lines.some((l) => l.type === 'add' && l.text === 'updated'));
    await rm(file);
    assert.equal((await blog.execute('pending')).data.items[0].state, 'deleted');
  }));
test('预检检查全部内容和图片，预览发布草稿标记但不改原稿', () =>
  fixture(async (root, blog) => {
    const e = await create(blog);
    const a = await blog.execute('preflight', { id: e.id, expectedRevision: e.revision });
    assert.equal(a.ok, true);
    assert.equal(a.data.passed, true);
    assert.match(a.data.source, /draft: false/);
    assert.equal(a.data.basis, 'unknown');
    assert.equal((await blog.execute('read', { id: e.id })).data.revision, e.revision);
    await writeFile(
      join(root, 'src/content/posts/invalid.md'),
      '---\ntitle: Missing fields\n---\ntext',
    );
    const b = await blog.execute('preflight', { id: e.id, expectedRevision: e.revision });
    assert.equal(b.data.passed, false);
    assert.ok(b.data.checks.some((c) => c.code === 'INVALID_CONTENT'));
    const pending = await blog.execute('pending');
    assert.ok(pending.data.items.some((i) => i.state === 'invalid'));
  }));
test('预检令牌覆盖其他正文、图片、配置和构建输入；过期检查不能演练', () =>
  fixture(async (root, blog) => {
    const e = await create(blog);
    for (const file of [
      'public/site.txt',
      'src/assets/asset.webp',
      'astro.config.mjs',
      '.blog/publish.json',
    ]) {
      const before = await blog.execute('preflight', { id: e.id, expectedRevision: e.revision });
      assert.equal(before.ok, true);
      await writeFile(
        join(root, file),
        file.endsWith('publish.json')
          ? JSON.stringify({ ...target, enabled: false })
          : randomUUID(),
      );
      const stale = await blog.execute('publish', {
        id: e.id,
        expectedRevision: e.revision,
        expectedReview: before.data.reviewToken,
        requestId: randomUUID(),
      });
      assert.equal(stale.error.code, 'REVIEW_STALE');
    }
  }));
test('配置路径检查和错误建议区分本地通过与真实上线', () =>
  fixture(async (_root, blog) => {
    const result = await blog.execute('setup', { target: { ...target, base: '/' } });
    assert.ok(result.data.checks.some((c) => c.code === 'PAGES_PATH'));
    const e = await create(blog);
    await blog.execute('configure', { target, expectedConfig: null, requestId: randomUUID() });
    const p = await blog.execute('preflight', {
      id: e.id,
      expectedRevision: e.revision,
      action: 'withdraw',
    });
    assert.equal(p.data.targetUrl, 'https://example.github.io/notebook/');
    assert.match(p.data.source, /draft: true/);
    const j = jobView({ status: 'failed', error: { code: 'DEPLOY_FAILED' } });
    assert.ok(j.nextSteps.some((s) => s.includes('不要重新创建')));
    const sim = jobView({ status: 'simulated' });
    assert.equal(sim.url, undefined);
    assert.match(sim.nextSteps[0], /未改变/);
  }));
