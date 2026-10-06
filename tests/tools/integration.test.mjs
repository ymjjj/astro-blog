import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, symlink, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createBlog } from '../../tools/blog/core.mjs';
import { walk } from '../../tools/blog/storage.mjs';
import { run, buildSnapshot, matchingRun } from '../../tools/blog/publishing.mjs';
const project = resolve(import.meta.dirname, '../..');

test('历史正文、恢复副本和仅旧版本引用的图片不进入实际生产构建', async () => {
  const root = await fixture();
  try {
    const blog = createBlog(root);
    const config = await blog.execute('configure', {
      target: {
        repository: 'private-owner/private-blog',
        branch: 'main',
        site: 'https://private-config-only.invalid',
        base: '/',
      },
      expectedConfig: null,
      requestId: randomUUID(),
    });
    assert.equal(config.ok, true);
    const created = await blog.execute('create', {
      kind: 'moments',
      slug: 'private-history',
      body: 'HISTORY_ONLY_PRIVATE_84721',
      requestId: randomUUID(),
    });
    assert.equal(created.ok, true);
    const entry = created.data;
    const imported = await blog.execute('image', {
      id: entry.id,
      file: join(root, 'public/media/blue-notebook-sketch-small.webp'),
      alt: '历史私有图片',
      requestId: randomUUID(),
    });
    assert.equal(imported.ok, true);
    const old = await blog.execute('update', {
      id: entry.id,
      expectedRevision: entry.revision,
      body: 'HISTORY_ONLY_PRIVATE_84721\n' + imported.data.markdown,
      requestId: randomUUID(),
    });
    assert.equal(old.ok, true);
    const current = await blog.execute('update', {
      id: entry.id,
      expectedRevision: old.data.revision,
      body: '公开的新版本',
      requestId: randomUUID(),
    });
    assert.equal(current.ok, true);
    const file = join(root, 'src/content', entry.id + '.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('draft: true', 'draft: false'));
    const checkpoint = await blog.execute('checkpoint', {
      sessionId: randomUUID(),
      expectedVersion: null,
      id: null,
      baseRevision: null,
      requestId: randomUUID(),
      form: {
        kind: 'posts',
        slug: '',
        title: '',
        description: '',
        date: '',
        updated: '',
        tags: '',
        body: 'RECOVERY_ONLY_PRIVATE_98472',
      },
    });
    assert.equal(checkpoint.ok, true);
    const backup = await blog.execute('backup', { requestId: randomUUID() });
    assert.equal(backup.ok, true);
    const planned = await blog.execute('plan', {
      kind: 'cleanup',
      paths: [`.blog/recovery/${checkpoint.data.sessionId}.json`],
      requestId: randomUUID(),
    });
    assert.equal(planned.ok, true);
    const cleaned = await blog.execute('apply', {
      planId: planned.data.planId,
      expectedPlan: planned.data.expectedPlan,
      confirm: true,
      requestId: randomUUID(),
    });
    assert.equal(cleaned.ok, true);
    const build = await run(
      root,
      process.execPath,
      [join(root, 'node_modules/astro/bin/astro.mjs'), 'build', '--force'],
      { BLOG_BASE: '/' },
    );
    assert.equal(build.code, 0, build.err);
    const files = await walk(join(root, 'dist'));
    const imageStem = imported.data.path.split('/').pop().split('.')[0];
    for (const file of files) {
      const bytes = await readFile(file);
      assert.equal(bytes.includes(Buffer.from('HISTORY_ONLY_PRIVATE_84721')), false, file);
      assert.equal(bytes.includes(Buffer.from('RECOVERY_ONLY_PRIVATE_98472')), false, file);
      assert.equal(file.includes(imageStem), false, file);
      assert.equal(file.includes('.blog'), false, file);
      assert.equal(bytes.includes(Buffer.from('private-config-only.invalid')), false, file);
    }
    assert.match(
      await readFile(join(root, 'dist', entry.id, 'index.html'), 'utf8'),
      /公开的新版本/,
    );
    const scan = await run(root, process.execPath, ['scripts/verify-build.mjs'], {
      BLOG_BASE: '/',
    });
    assert.equal(scan.code, 0, scan.err);
  } finally {
    await cleanup(root);
  }
});

test('部署匹配不会把同 SHA 的旧部署或其他手动任务当作本次上线', () => {
  const job = {
    commit: 'abc123',
    jobId: 'current-job',
    trigger: 'workflow_dispatch',
    createdAt: '2026-09-27T01:00:00Z',
  };
  const base = {
    headSha: 'abc123',
    createdAt: '2026-09-27T01:00:01Z',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
  };
  assert.equal(
    matchingRun(job, [{ ...base, databaseId: 9, displayTitle: 'Blog deploy · old-job' }]),
    undefined,
  );
  assert.equal(matchingRun(job, [{ ...base, databaseId: 9, event: 'push' }]), undefined);
  assert.equal(
    matchingRun(job, [
      { ...base, databaseId: 9, headSha: 'different', displayTitle: 'Blog deploy · current-job' },
    ]),
    undefined,
  );
  const correct = { ...base, databaseId: 10, displayTitle: 'Blog deploy · current-job' };
  assert.equal(
    matchingRun(job, [{ ...correct, databaseId: 8, createdAt: '2026-09-26T01:00:00Z' }, correct])
      .databaseId,
    10,
  );
  assert.equal(
    matchingRun({ ...job, trigger: 'push' }, [{ ...base, event: 'push', databaseId: 11 }])
      .databaseId,
    11,
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'blog-integration-'));
  for (const name of [
    'src',
    'public',
    'scripts',
    'astro.config.mjs',
    'package.json',
    'tsconfig.json',
  ])
    await cp(join(project, name), join(root, name), { recursive: true });
  await symlink(
    join(project, 'node_modules'),
    join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  return root;
}
async function cleanup(root) {
  await rm(join(root, 'node_modules'), { force: true });
  await rm(root, { recursive: true, force: true });
}

test('并发正式构建与演练共享依赖但不共享缓存，演练正文不会串入正式产物', async () => {
  const root = await fixture();
  try {
    const blog = createBlog(root);
    const { data: e } = await blog.execute('create', {
      kind: 'moments',
      slug: 'concurrent-private',
      body: 'DRAFT_SECRET_CONCURRENT_7462',
      requestId: randomUUID(),
    });
    const [built, simulated] = await Promise.all([
      run(
        root,
        process.execPath,
        [join(root, 'node_modules/astro/bin/astro.mjs'), 'build', '--force'],
        { BLOG_BASE: '/' },
      ),
      blog.execute('publish', { id: e.id, expectedRevision: e.revision, requestId: randomUUID() }),
    ]);
    assert.equal(built.code, 0, built.err);
    assert.equal(simulated.ok, true, JSON.stringify(simulated));
    assert.equal(simulated.data.build.summary.publishedEntries, 9);
    const search = JSON.parse(await readFile(join(root, 'dist/search-index.json'), 'utf8'));
    assert.equal(search.length, 8);
    assert.equal(JSON.stringify(search).includes('DRAFT_SECRET_CONCURRENT_7462'), false);
    assert.equal((await blog.execute('read', { id: e.id })).data.data.draft, true);
    const scan = await run(root, process.execPath, ['scripts/verify-build.mjs'], {
      BLOG_BASE: '/',
    });
    assert.equal(scan.code, 0, scan.err);
  } finally {
    await cleanup(root);
  }
});
test('实际隔离构建：发布/撤回演练、请求幂等、源和正式产物保持不变', async () => {
  const root = await fixture();
  try {
    const blog = createBlog(root);
    let response = await blog.execute('create', {
      kind: 'posts',
      slug: 'integration-note',
      title: '集成演练',
      description: '只在测试副本中存在',
      body: '## 一小段\n\nhello',
      requestId: randomUUID(),
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    const e = response.data;
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'dist', 'sentinel.txt'), 'original-dist');
    const args = {
      id: e.id,
      expectedRevision: e.revision,
      requestId: randomUUID(),
      mode: 'simulate',
    };
    const publish = await blog.execute('publish', args);
    assert.equal(publish.data.status, 'simulated', JSON.stringify(publish));
    assert.equal(publish.data.build.summary.publishedEntries, 9);
    assert.deepEqual(await blog.execute('publish', args), publish);
    assert.equal((await blog.execute('read', { id: e.id })).data.revision, e.revision);
    assert.equal(await readFile(join(root, 'dist', 'sentinel.txt'), 'utf8'), 'original-dist');
    const withdraw = await blog.execute('publish', {
      ...args,
      action: 'withdraw',
      requestId: randomUUID(),
    });
    assert.equal(withdraw.data.status, 'simulated');
    assert.equal(withdraw.data.build.summary.publishedEntries, 8);
    const state = await blog.execute('status', { jobId: publish.data.jobId, refresh: true });
    assert.equal(state.data.status, 'simulated');
    assert.equal(state.data.url, undefined);
    assert.deepEqual(await readdir(join(root, '.blog/staging')), []);
  } finally {
    await cleanup(root);
  }
});
test('CLI 在任意 cwd 使用绝对 root，stdout 单个 JSON，错误退出非零', async () => {
  const root = await fixture();
  try {
    const argsFile = join(root, 'request.json');
    await writeFile(
      argsFile,
      '\uFEFF' + JSON.stringify({ kind: 'moments', body: '由 CLI 创建', requestId: randomUUID() }),
    );
    const result = await run(tmpdir(), process.execPath, [
      join(project, 'tools/blog/cli.mjs'),
      'create',
      '--root',
      root,
      '--input',
      argsFile,
      '--json',
    ]);
    assert.equal(result.code, 0, result.err);
    const data = JSON.parse(result.out);
    assert.equal(data.ok, true);
    assert.equal(data.data.data.draft, true);
    const invalid = await run(root, process.execPath, [
      join(project, 'tools/blog/cli.mjs'),
      'read',
      '--json',
    ]);
    assert.equal(invalid.code, 1);
    assert.equal(JSON.parse(invalid.out).error.code, 'INVALID_INPUT');
  } finally {
    await cleanup(root);
  }
});

test('草稿扫描按实际发布状态工作，演练可发布原有示例草稿而不修改原稿', async () => {
  const root = await fixture();
  try {
    const blog = createBlog(root);
    const { data: e } = await blog.execute('read', { id: 'posts/unpublished-test' });
    const result = await blog.execute('publish', {
      id: e.id,
      expectedRevision: e.revision,
      requestId: randomUUID(),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.status, 'simulated');
    assert.equal((await blog.execute('read', { id: e.id })).data.revision, e.revision);
  } finally {
    await cleanup(root);
  }
});

test('损坏链接阻止发布，失败状态和请求结果可查询且源不变', async () => {
  const root = await fixture();
  try {
    const blog = createBlog(root);
    const { data: e } = await blog.execute('create', {
      kind: 'moments',
      body: '[坏链接](/does-not-exist/)',
      requestId: randomUUID(),
    });
    const args = { id: e.id, expectedRevision: e.revision, requestId: randomUUID() };
    const result = await blog.execute('publish', args);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'VERIFY_FAILED');
    assert.equal(result.data.status, 'failed');
    assert.deepEqual(await blog.execute('publish', args), result);
    assert.equal((await blog.execute('read', { id: e.id })).data.revision, e.revision);
    assert.equal(
      (await blog.execute('status', { jobId: result.data.jobId })).data.lastSuccessfulState,
      'checking',
    );
  } finally {
    await cleanup(root);
  }
});

test('增长到14条内容后，首页和两种独立列表均生成分页，根路径与子路径链接完整', async () => {
  const root = await fixture();
  try {
    const blog = createBlog(root);
    for (const kind of ['posts', 'moments'])
      for (let i = 0; i < 3; i++) {
        const { data: e } = await blog.execute('create', {
          kind,
          title: '分页测试 ' + i,
          description: '独立副本',
          body: '分页正文',
          requestId: randomUUID(),
        });
        const file = join(root, 'src/content', e.id + '.md');
        await writeFile(
          file,
          (await readFile(file, 'utf8')).replace('draft: true', 'draft: false'),
        );
      }
    for (const base of ['/', '/astro-blog/']) {
      const result = await buildSnapshot(root, undefined, { base });
      assert.equal(result.summary.publishedEntries, 14);
      assert.equal(result.summary.htmlPages, 36);
      assert.equal(result.summary.draftLeak, false);
    }
  } finally {
    await cleanup(root);
  }
});
test('MCP stdio 完成握手、工具发现、创建读取更新与错误响应', async () => {
  const root = await fixture();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(project, 'tools/blog/mcp.mjs'), '--root', root],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'blog-integration', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 30);
    assert.ok(tools.some((t) => t.name === 'blog_publish' && t.inputSchema.properties.mode));
    const args = { kind: 'moments', body: 'MCP 一枚碎碎念', requestId: randomUUID() };
    const a = await client.callTool({ name: 'blog_create', arguments: args });
    assert.equal(a.isError, false);
    const entry = a.structuredContent.data;
    const setup = await client.callTool({ name: 'blog_setup', arguments: {} });
    assert.equal(setup.isError, false);
    const configured = await client.callTool({
      name: 'blog_configure',
      arguments: {
        target: {
          repository: 'example/astro-blog',
          branch: 'main',
          site: 'https://example.github.io',
          base: '/astro-blog/',
        },
        expectedConfig: setup.structuredContent.data.revision,
        requestId: randomUUID(),
      },
    });
    assert.equal(configured.isError, false);
    assert.equal(configured.structuredContent.data.remoteEnabled, false);
    const checkedPublish = await client.callTool({
      name: 'blog_preflight',
      arguments: { id: entry.id, expectedRevision: entry.revision },
    });
    assert.equal(checkedPublish.isError, false);
    assert.equal(checkedPublish.structuredContent.data.passed, true);
    const pendingCli = await run(root, process.execPath, [
      join(project, 'tools/blog/cli.mjs'),
      'pending',
      '--root',
      root,
      '--json',
    ]);
    assert.equal(pendingCli.code, 0);
    assert.ok(JSON.parse(pendingCli.out).data.items.some((i) => i.id === entry.id));
    const again = await client.callTool({ name: 'blog_create', arguments: args });
    assert.equal(again.structuredContent.data.id, entry.id);
    const read = await client.callTool({ name: 'blog_read', arguments: { id: entry.id } });
    assert.equal(read.structuredContent.data.body.trim(), args.body);
    const edit = await client.callTool({
      name: 'blog_update',
      arguments: {
        id: entry.id,
        expectedRevision: entry.revision,
        body: 'MCP 已修改',
        requestId: randomUUID(),
      },
    });
    assert.equal(edit.isError, false);
    const conflict = await client.callTool({
      name: 'blog_update',
      arguments: {
        id: entry.id,
        expectedRevision: entry.revision,
        body: '过期内容',
        requestId: randomUUID(),
      },
    });
    assert.equal(conflict.isError, true);
    assert.equal(conflict.structuredContent.error.code, 'REVISION_CONFLICT');
    const versions = await client.callTool({ name: 'blog_history', arguments: { id: entry.id } });
    assert.equal(versions.isError, false);
    assert.equal(versions.structuredContent.data.versions.length, 2);
    const diff = await client.callTool({
      name: 'blog_diff',
      arguments: { id: entry.id, fromRevision: entry.revision },
    });
    assert.ok(diff.structuredContent.data.lines.some((l) => l.type === 'add'));
    const restored = await client.callTool({
      name: 'blog_restore',
      arguments: {
        id: entry.id,
        revision: entry.revision,
        expectedRevision: edit.structuredContent.data.revision,
        requestId: randomUUID(),
      },
    });
    assert.equal(restored.isError, false);
    assert.equal(restored.structuredContent.data.body, entry.body);
    const checkpoint = await client.callTool({
      name: 'blog_checkpoint',
      arguments: {
        sessionId: randomUUID(),
        expectedVersion: null,
        id: null,
        baseRevision: null,
        requestId: randomUUID(),
        form: {
          kind: 'posts',
          slug: '',
          title: '未完成',
          description: '',
          date: '',
          updated: '',
          tags: '',
          body: '',
        },
      },
    });
    assert.equal(checkpoint.isError, false);
    const cli = await run(root, process.execPath, [
      join(project, 'tools/blog/cli.mjs'),
      'recovery',
      '--root',
      root,
      '--json',
    ]);
    assert.equal(cli.code, 0);
    assert.equal(JSON.parse(cli.out).data[0].form.title, '未完成');
    const removed = await client.callTool({
      name: 'blog_discard',
      arguments: {
        sessionId: checkpoint.structuredContent.data.sessionId,
        expectedVersion: checkpoint.structuredContent.data.version,
        requestId: randomUUID(),
      },
    });
    assert.equal(removed.isError, false);
    const exported = await client.callTool({
      name: 'blog_backup',
      arguments: { requestId: randomUUID() },
    });
    assert.equal(exported.isError, false);
    const preview = await client.callTool({
      name: 'blog_plan',
      arguments: {
        kind: 'restore',
        backupId: exported.structuredContent.data.backupId,
        requestId: randomUUID(),
      },
    });
    assert.equal(preview.isError, false);
    const denied = await client.callTool({
      name: 'blog_apply',
      arguments: {
        planId: preview.structuredContent.data.planId,
        expectedPlan: preview.structuredContent.data.expectedPlan,
        requestId: randomUUID(),
        confirm: false,
      },
    });
    assert.equal(denied.isError, true);
    const request = join(root, 'backup-check.json');
    await writeFile(
      request,
      JSON.stringify({ backupId: exported.structuredContent.data.backupId }),
    );
    const checked = await run(root, process.execPath, [
      join(project, 'tools/blog/cli.mjs'),
      'backupcheck',
      '--root',
      root,
      '--input',
      request,
      '--json',
    ]);
    assert.equal(checked.code, 0);
    assert.equal(JSON.parse(checked.out).data.verified, true);
  } finally {
    await client.close();
    await cleanup(root);
  }
});
test('工作台拒绝跨源、缺 token 和文件路径上传；不暴露配置及内容目录', async () => {
  const root = await fixture();
  const server = spawn(
    process.execPath,
    [
      join(project, 'tools/studio/server.mjs'),
      '--root',
      root,
      '--port',
      '4333',
      '--preview-port',
      '4335',
      '--no-preview',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  try {
    const origin = 'http://127.0.0.1:4333';
    let html;
    for (let i = 0; i < 100; i++) {
      try {
        html = await (await fetch(origin)).text();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.ok(html?.includes('页间写作台'));
    const token = /name="studio-token" content="([^"]+)"/.exec(html)[1];
    assert.equal(
      (
        await fetch(origin + '/api/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(origin + '/api/list', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Studio-Token': token,
            Origin: 'https://evil.example',
          },
          body: '{}',
        })
      ).status,
      403,
    );
    const response = await fetch(origin + '/api/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token },
      body: '{}',
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.length, 10);
    assert.equal((await fetch(origin + '/.blog/publish.json')).status, 404);
    assert.equal((await fetch(origin + '/.blog/backups/test.blogbackup.gz')).status, 404);
    const backupDenied = await fetch(origin + '/api/backupdownload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupId: randomUUID() }),
    });
    assert.equal(backupDenied.status, 403);
    const image = await fetch(origin + '/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token },
      body: JSON.stringify({ file: 'C:/Windows/win.ini' }),
    });
    assert.equal(image.status, 400);
  } finally {
    server.kill();
    await new Promise((r) => (server.exitCode !== null ? r() : server.once('exit', r)));
    await cleanup(root);
  }
});
