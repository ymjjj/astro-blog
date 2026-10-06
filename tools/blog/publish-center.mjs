import { readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { targetSchema } from './contracts.mjs';
import { safePath, hash, atomic, walk, fail, locked } from './storage.mjs';
import { readConfig, run, buildSnapshot } from './publishing.mjs';
import { readEntry, changed, serialize, checkImages } from './core.mjs';
import { lineDiff } from './history.mjs';

async function configState(root) {
  const file = await safePath(root, '.blog/publish.json');
  let raw;
  try {
    raw = await readFile(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  try {
    return { config: await readConfig(root), revision: raw ? hash(raw) : null, valid: true };
  } catch {
    return {
      config: { enabled: false, branch: 'main', base: '/' },
      revision: raw ? hash(raw) : null,
      valid: false,
    };
  }
}
async function git(root, args) {
  try {
    return await run(root, 'git', args, {}, 10000);
  } catch {
    return { code: -1, out: '' };
  }
}
export async function gitState(root) {
  const top = await git(root, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0 || resolve(top.out.trim()).toLowerCase() !== resolve(root).toLowerCase())
    return {
      available: false,
      head: null,
      branch: null,
      reason: '当前项目尚无独立 Git 仓库；无法判断与提交的差异。',
    };
  const head = await git(root, ['rev-parse', '--verify', 'HEAD']);
  const branch = await git(root, ['branch', '--show-current']);
  return {
    available: true,
    head: head.code === 0 ? head.out.trim() : null,
    branch: branch.code === 0 ? branch.out.trim() : null,
  };
}
const check = (code, level, message, next = '') => ({ code, level, message, next });
export async function setup(root, args = {}) {
  const state = await configState(root),
    c = args.target || state.config;
  const localGit = await gitState(root),
    checks = [];
  checks.push(
    check(
      'CONFIG',
      state.valid ? 'pass' : 'error',
      state.valid ? '本地配置可读取' : '本地配置损坏或含不允许的字段',
      state.valid ? '' : '重新填写并保存目标；原配置不会作为公开内容返回。',
    ),
  );
  const complete = targetSchema.safeParse({
    repository: c.repository,
    branch: c.branch,
    site: c.site,
    base: c.base,
  }).success;
  checks.push(
    check(
      'TARGET',
      complete ? 'pass' : 'warning',
      complete ? '仓库、分支和站点格式检查通过' : '尚未填写完整发布目标',
      complete ? '' : '填写 owner/repository、分支、HTTPS 站点源及子路径。',
    ),
  );
  checks.push(
    check(
      'GIT',
      localGit.available && localGit.head ? 'pass' : 'warning',
      localGit.available && localGit.head ? '已找到本地 Git 基线' : '尚无本地提交基线',
      '配置向导不会自动初始化、提交或推送 Git。',
    ),
  );
  if (localGit.available) {
    checks.push(
      check(
        'BRANCH',
        localGit.branch === c.branch ? 'pass' : 'warning',
        localGit.branch === c.branch ? '当前分支与目标一致' : '当前分支与目标不一致',
        '真实发布前审查并切换到已授权分支。',
      ),
    );
    const remote = await git(root, ['remote', 'get-url', 'origin']);
    const accepted = [
      `https://github.com/${c.repository}`,
      `https://github.com/${c.repository}.git`,
      `git@github.com:${c.repository}.git`,
    ];
    checks.push(
      check(
        'ORIGIN',
        remote.code === 0 && accepted.includes(remote.out.trim()) ? 'pass' : 'warning',
        remote.code === 0 && accepted.includes(remote.out.trim())
          ? 'origin 与目标一致'
          : 'origin 缺失或与目标不符（未回显地址）',
        '在本地检查 origin；使用不含凭据的 GitHub 地址。',
      ),
    );
    const index = await git(root, ['diff', '--cached', '--name-only']);
    checks.push(
      check(
        'INDEX',
        index.code === 0 && !index.out.trim() ? 'pass' : 'warning',
        index.code === 0 && !index.out.trim() ? '暂存区为空' : '暂存区存在待审查内容',
        '发布不会代替你处理其他暂存修改。',
      ),
    );
  }
  let workflow = '';
  try {
    workflow = await readFile(await safePath(root, '.github/workflows/deploy.yml'), 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  checks.push(
    check(
      'WORKFLOW',
      workflow ? 'pass' : 'warning',
      workflow ? '本地存在 deploy.yml（尚未验证线上设置）' : '缺少 deploy.yml',
      '参照部署指南配置 GitHub Pages Actions；此处不会联网修改设置。',
    ),
  );
  if (c.branch !== 'main')
    checks.push(
      check(
        'WORKFLOW_BRANCH',
        'warning',
        '目标不是 main，需要核对工作流 push 分支',
        '修改并审查 deploy.yml 的触发分支后再部署。',
      ),
    );
  if (complete && new URL(c.site).hostname.toLowerCase().endsWith('.github.io')) {
    const [owner, repo] = c.repository.split('/');
    const expected = repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '/' : `/${repo}/`;
    if (
      c.base !== expected ||
      new URL(c.site).hostname.toLowerCase() !== `${owner.toLowerCase()}.github.io`
    )
      checks.push(
        check(
          'PAGES_PATH',
          'warning',
          '站点或子路径与常见 GitHub Pages 地址不同',
          `通常是 https://${owner}.github.io，base=${expected}；自定义域名按实际设置填写。`,
        ),
      );
  }
  checks.push(
    check(
      'REMOTE',
      'info',
      state.config.enabled
        ? '已有配置启用远程；向导保存会关闭远程发布'
        : '远程发布关闭；可进行本地检查和演练',
      '保存配置不代表发布授权；GitHub 身份、仓库权限、远程同步与 Pages 设置尚未联网验证。',
    ),
  );
  return {
    revision: state.revision,
    valid: state.valid,
    target: {
      repository: c.repository || '',
      branch: c.branch || 'main',
      site: c.site || '',
      base: c.base || '/',
    },
    remoteEnabled: state.valid && state.config.enabled,
    complete,
    checks,
    git: localGit,
    candidate: !!args.target,
  };
}
export async function configure(root, args) {
  const state = await configState(root);
  if (state.revision !== args.expectedConfig)
    fail('CONFIG_CONFLICT', '发布配置已被修改，请重新读取 setup 并比较后保存。');
  const target = targetSchema.parse(args.target);
  const file = await safePath(root, '.blog/publish.json');
  if ((await configState(root)).revision !== args.expectedConfig)
    fail('CONFIG_CONFLICT', '发布配置发生变化，请重新读取。');
  await atomic(
    file,
    JSON.stringify(
      { ...target, enabled: false, remote: 'origin', workflow: 'deploy.yml' },
      null,
      2,
    ) + '\n',
  );
  return setup(root);
}
async function entries(root) {
  const output = [];
  for (const kind of ['posts', 'moments']) {
    for (const path of await walk(await safePath(root, `src/content/${kind}`))) {
      if (!path.endsWith('.md')) continue;
      const id = relative(resolve(root, 'src/content'), path).replaceAll('\\', '/').slice(0, -3);
      try {
        output.push({ entry: await readEntry(root, id) });
      } catch (e) {
        output.push({
          id,
          error: {
            code: e.code || 'INVALID_CONTENT',
            message: e.publicMessage || '无法读取内容；请检查 Markdown 和 frontmatter。',
          },
        });
      }
    }
  }
  return output;
}
async function baseline(root, head, id) {
  if (!head) return { source: null, basis: 'unknown' };
  const r = await git(root, ['show', `${head}:src/content/${id}.md`]);
  return r.code === 0 ? { source: r.out, basis: 'head' } : { source: null, basis: 'new' };
}
export async function pending(root, args = {}) {
  const state = await gitState(root),
    items = [];
  for (const item of await entries(root)) {
    if (item.error) {
      items.push({ id: item.id, state: 'invalid', error: item.error });
      continue;
    }
    const e = item.entry,
      base = await baseline(root, state.head, e.id);
    const source = await readFile(await safePath(root, `src/content/${e.id}.md`), 'utf8');
    const comparison =
      base.basis === 'unknown'
        ? 'unknown'
        : base.basis === 'new'
          ? 'new'
          : base.source.replaceAll('\r\n', '\n') === source.replaceAll('\r\n', '\n')
            ? 'unchanged'
            : 'modified';
    items.push({
      id: e.id,
      title: e.data.title || e.body.trim().slice(0, 50),
      revision: e.revision,
      draft: e.data.draft,
      state: e.data.draft ? 'draft' : comparison,
      comparison,
      date: e.data.date,
    });
  }
  // Deleted files remain visible: deleting a local file is not an authorized online withdrawal.
  if (state.head) {
    const tree = await git(root, [
      'ls-tree',
      '-r',
      '--name-only',
      state.head,
      '--',
      'src/content/posts',
      'src/content/moments',
    ]);
    for (const file of tree.out
      .split('\n')
      .filter((s) => /^src\/content\/(posts|moments)\/[a-z0-9/-]+\.md$/.test(s))) {
      const id = file.slice(12, -3);
      if (!items.some((i) => i.id === id))
        items.push({
          id,
          state: 'deleted',
          title: '本地文件已移除；请审查 Git 修改，不自动撤回线上内容',
        });
    }
  }
  return {
    basis: state.head ? 'local-head' : 'unknown',
    head: state.head,
    notice:
      '与本地 Git HEAD 比较，不代表线上差异。演练不改变待审查状态；未提交的其他公开内容也会参与整站构建。',
    items: items
      .filter(
        (i) => !args.query || JSON.stringify(i).toLowerCase().includes(args.query.toLowerCase()),
      )
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id)),
  };
}
// Fingerprint all build inputs, including private drafts; a prior review cannot authorize a changed build.
export async function reviewToken(root, args) {
  const records = [];
  for (const name of [
    'src',
    'public',
    'scripts',
    'astro.config.mjs',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    '.github/workflows/deploy.yml',
    '.blog/publish.json',
  ]) {
    const path = await safePath(root, name);
    try {
      const files = (await stat(path)).isDirectory() ? await walk(path) : [path];
      for (const file of files.sort())
        records.push([relative(root, file).replaceAll('\\', '/'), hash(await readFile(file))]);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      records.push([name, null]);
    }
  }
  return hash(
    JSON.stringify({
      id: args.id,
      action: args.action || 'publish',
      git: await gitState(root),
      records,
    }),
  );
}
export async function preflight(root, args) {
  const inspect = async () => {
    const token = await reviewToken(root, args),
      e = await readEntry(root, args.id);
    changed(e, args.expectedRevision);
    const settings = await setup(root),
      checks = [];
    if (!settings.valid)
      checks.push(check('INVALID_CONFIG', 'error', '发布配置无效', '先通过向导修复配置，再检查。'));
    for (const item of await entries(root)) {
      if (item.error) {
        checks.push(
          check(
            item.error.code,
            'error',
            `${item.id}：${item.error.message}`,
            '打开对应内容修复后重新检查。',
          ),
        );
        continue;
      }
      try {
        await checkImages(root, item.entry);
      } catch (err) {
        checks.push(
          check(
            err.code || 'INVALID_IMAGE',
            'error',
            `${item.entry.id}：${err.publicMessage || '图片检查未通过'}`,
            '修复图片引用；草稿专用图片通过导入功能存入 src/assets。',
          ),
        );
      }
    }
    if (!checks.some((i) => i.level === 'error'))
      checks.push(check('CONTENT', 'pass', '全部正文与 Markdown 图片引用检查通过'));
    const source = serialize({ ...e.data, draft: args.action === 'withdraw' }, e.body);
    const base = await baseline(root, settings.git.head, e.id);
    const files = [];
    try {
      for (const path of await checkImages(root, e))
        files.push({
          path: relative(root, path).replaceAll('\\', '/'),
          bytes: (await stat(path)).size,
        });
    } catch {}
    let build;
    if (args.build && !checks.some((i) => i.level === 'error')) {
      try {
        build = await buildSnapshot(root, { id: e.id, source }, settings.target);
        checks.push(check('BUILD', 'pass', '隔离构建与生产产物扫描通过；未提交或上线'));
      } catch (err) {
        checks.push(
          check(
            err.code || 'BUILD_FAILED',
            'error',
            err.publicMessage || '隔离构建失败',
            failureAdvice(err.code).join(' '),
          ),
        );
      }
    }
    if (token !== (await reviewToken(root, args)))
      fail('REVIEW_STALE', '检查期间项目内容、配置或 Git 基线发生变化，请重新预检。');
    return {
      id: e.id,
      revision: e.revision,
      action: args.action,
      reviewToken: token,
      passed: !checks.some((i) => i.level === 'error'),
      buildRequested: args.build,
      build: build || null,
      checks,
      configuration: settings.checks,
      targetUrl: settings.complete
        ? new URL(
            settings.target.base + (args.action === 'withdraw' ? '' : e.id + '/'),
            settings.target.site,
          ).href
        : null,
      urlNotice: '仅为预计地址，不表示已经上线。',
      basis: base.basis,
      head: settings.git.head,
      source,
      lines: lineDiff(base.source || '', source),
      files,
      notice:
        (base.basis === 'unknown'
          ? '没有本地 Git 提交基线，以下显示完整拟发布源码，无法判断线上差异。'
          : base.basis === 'new'
            ? '本地 HEAD 尚无此内容，以下显示新增源码。'
            : '以下与本地 Git HEAD 比较，不代表线上差异。') +
        '所有已标记公开的内容参与整站构建，其他草稿保持隔离。',
    };
  };
  return locked(root, inspect);
}
export function failureAdvice(code) {
  const map = {
    BUILD_FAILED: [
      '运行 npm run check 检查字段与 Markdown，再在本地运行 npm run build 查看错误。',
      '修复后重新预检，用新 requestId 演练。',
    ],
    VERIFY_FAILED: [
      '运行 npm run build 和 npm run verify，检查损坏链接、图片和草稿泄露。',
      '修复后重新预检；不要把失败演练当作上线。',
    ],
    REVISION_CONFLICT: ['重新读取正文并比较合并；不要使用旧版本覆盖。'],
    REVIEW_STALE: ['项目或配置已改变，重新预检后使用新的 reviewToken。'],
    REMOTE_DISABLED: ['远程未启用；继续使用演练。真实发布需另行明确授权目标。'],
    INVALID_CONFIG: ['通过配置向导重新填写目标并保存，远程保持关闭。'],
    DEPLOY_FAILED: [
      '打开对应 Actions 运行查看错误；修复前保留提交号和任务 ID。',
      '不要重新创建内容或盲目重推。',
    ],
    COMMAND_FAILED: [
      '根据任务中的最后状态、提交号核对本地 Git 与 Actions。',
      '提交后失败先人工核对远程结果，不自动重复推送。',
    ],
    REQUEST_INTERRUPTED: ['先刷新任务记录并核对请求 ID；中断不表示没有执行。'],
    STATUS_UNAVAILABLE: ['检查 GitHub CLI 身份与网络后手动查询；保留原状态，不视为上线。'],
  };
  return map[code] || ['按错误信息修复后重新检查；若已提交或推送，先核对任务与远程结果。'];
}
export function jobView(job) {
  return {
    ...job,
    nextSteps: job.error
      ? failureAdvice(job.error.code)
      : job.status === 'simulated'
        ? ['演练通过，原稿和线上状态未改变。']
        : job.status === 'deploying'
          ? ['手动查询部署状态；已推送不代表已上线。']
          : [],
  };
}
