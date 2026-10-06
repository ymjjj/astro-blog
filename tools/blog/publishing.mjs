import { cp, mkdir, symlink, rm, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { targetSchema } from './contracts.mjs';
import { reviewToken, jobView } from './publish-center.mjs';
import { fail, safePath, json, saveJson, atomic, within, locked } from './storage.mjs';
import { allEntries, checkImages, validate, serialize, readEntry } from './core.mjs';

export async function run(cwd, command, args, env = {}, timeout = 180000) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      shell: false,
    });
    let out = '',
      err = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.stdout.on('data', (b) => {
      out = (out + b.toString()).slice(-1000000);
    });
    child.stderr.on('data', (b) => {
      err = (err + b.toString()).slice(-1000000);
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(
        Object.assign(new Error(), {
          code: 'COMMAND_UNAVAILABLE',
          publicMessage: `无法启动 ${command}，请检查安装与 PATH。`,
        }),
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveResult({ code: timedOut ? -1 : code, out, err });
    });
  });
}
const configSchema = z
  .object({
    enabled: z.boolean().default(false),
    repository: z
      .string()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
      .optional(),
    remote: z.literal('origin').default('origin'),
    branch: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/)
      .default('main'),
    site: z.string().url().optional(),
    base: z
      .string()
      .regex(/^\/(?:[a-zA-Z0-9_-]+\/)*$/)
      .default('/'),
    workflow: z.literal('deploy.yml').default('deploy.yml'),
  })
  .strict();
export async function readConfig(root) {
  const input = await json(await safePath(root, '.blog/publish.json'), { enabled: false });
  const parsed = configSchema.safeParse(input);
  if (!parsed.success)
    fail(
      'INVALID_CONFIG',
      '发布配置格式错误；参考 blog.publish.example.json，不要在配置中放 token。',
    );
  const c = parsed.data;
  if (c.enabled && (!c.repository || !c.site || !c.site.startsWith('https://')))
    fail('INVALID_CONFIG', '启用远程发布需指定 repository 和 HTTPS site。');
  if (c.site) {
    const u = new URL(c.site);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.pathname !== '/' ||
      u.search ||
      u.hash
    )
      fail('INVALID_CONFIG', 'site 只填写 HTTPS 站点源，子目录填写在 base。');
  }
  if (
    c.repository &&
    c.site &&
    !targetSchema.safeParse({
      repository: c.repository,
      branch: c.branch,
      site: c.site,
      base: c.base,
    }).success
  )
    fail('INVALID_CONFIG', '发布目标格式无效；通过配置向导修复。');
  return c;
}
async function checked(cwd, command, args, message) {
  const r = await run(cwd, command, args);
  if (r.code !== 0) fail('COMMAND_FAILED', message);
  return r.out.trim();
}

export async function buildSnapshot(root, change, config = { base: '/' }) {
  const snapshot = await safePath(root, `.blog/staging/${randomUUID()}`);
  await mkdir(snapshot, { recursive: true });
  try {
    const inputs = [
      'src',
      'public',
      'scripts',
      'astro.config.mjs',
      'package.json',
      'tsconfig.json',
    ];
    for (const name of inputs)
      await cp(await safePath(root, name), join(snapshot, name), { recursive: true });
    await symlink(
      join(root, 'node_modules'),
      join(snapshot, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    if (change) await atomic(join(snapshot, 'src/content', change.id + '.md'), change.source);
    const env = { BLOG_BASE: config.base || '/', BLOG_SITE: config.site || 'https://example.com' };
    const build = await run(
      snapshot,
      process.execPath,
      [join(root, 'node_modules/astro/bin/astro.mjs'), 'build', '--force'],
      env,
    );
    if (build.code !== 0)
      fail(
        'BUILD_FAILED',
        '隔离构建失败；运行 npm run check 检查字段与 Markdown，修复后用新 requestId 重试。',
      );
    const scan = await run(snapshot, process.execPath, ['scripts/verify-build.mjs'], env);
    if (scan.code !== 0) fail('VERIFY_FAILED', '生产产物校验失败；检查图片、链接与草稿隔离。');
    return { passed: true, isolated: true, summary: JSON.parse(scan.out) };
  } finally {
    // 先移除依赖链接，再清理已核验的隔离目录；绝不递归操作真实 node_modules。
    await rm(join(snapshot, 'node_modules'), { force: true });
    if (within(resolve(root, '.blog/staging'), snapshot))
      await rm(snapshot, { recursive: true, force: true });
  }
}
async function remoteReady(root, c, allowed = []) {
  if (!c.enabled)
    fail(
      'REMOTE_DISABLED',
      '尚未授权远程发布。请配置 .blog/publish.json；当前可使用 simulate 演练。',
    );
  const staged = await checked(
    root,
    'git',
    ['diff', '--cached', '--name-only'],
    '不是可用的 Git 仓库；先按部署指南配置仓库。',
  );
  if (staged) fail('DIRTY_INDEX', '暂存区已有内容，请先审查并提交或取消暂存，再发布。');
  const tracked = await run(root, 'git', ['diff', '--name-only', '-z']);
  const untracked = await run(root, 'git', ['ls-files', '--others', '--exclude-standard', '-z']);
  if (tracked.code !== 0 || untracked.code !== 0) fail('GIT_UNAVAILABLE', '无法读取 Git 工作区');
  const changes = (tracked.out + untracked.out).split('\0').filter(Boolean);
  if (changes.some((path) => !allowed.includes(path)))
    fail('DIRTY_WORKTREE', '工作区还有本次内容及其配图之外的修改，请先审查并提交其他修改。');
  const branch = await checked(root, 'git', ['branch', '--show-current'], '无法读取分支');
  if (branch !== c.branch) fail('WRONG_BRANCH', '当前分支与授权发布分支不一致');
  const remote = await checked(root, 'git', ['remote', 'get-url', 'origin'], '缺少 origin 远程');
  const allowedRemotes = [
    `https://github.com/${c.repository}.git`,
    `https://github.com/${c.repository}`,
    `git@github.com:${c.repository}.git`,
  ];
  if (!allowedRemotes.includes(remote))
    fail('REMOTE_MISMATCH', 'origin 与授权的 GitHub repository 不一致，或 URL 包含凭据。');
  await checked(root, 'gh', ['auth', 'status'], '请先运行 gh auth login 配置 GitHub CLI 身份。');
  // 不允许顺带推送先前本地提交；发布前必须与远程目标完全同步。
  await checked(root, 'git', ['fetch', 'origin', c.branch], '无法获取授权远程分支');
  const head = await checked(root, 'git', ['rev-parse', 'HEAD'], '无法读取 HEAD');
  const remoteHead = await checked(
    root,
    'git',
    ['rev-parse', `refs/remotes/origin/${c.branch}`],
    '远程发布分支不存在',
  );
  if (head !== remoteHead) fail('UNSYNCED_BRANCH', '本地与远程发布分支未同步，请先审查并同步。');
  return head;
}
export async function publish(root, args, entry, recordJob) {
  if (args.expectedReview && args.expectedReview !== (await reviewToken(root, args)))
    fail('REVIEW_STALE', '项目或配置已改变，请重新预检后再演练或发布。');
  const c = await readConfig(root);
  const entryFile = await safePath(root, `src/content/${args.id}.md`);
  const images = await checkImages(root, entry);
  const allowed = [entryFile, ...images].map((file) => relative(root, file).replaceAll('\\', '/'));
  if (args.mode === 'remote') await remoteReady(root, c, allowed);
  for (const e of await allEntries(root)) {
    validate(e.kind, e.data, e.body);
    await checkImages(root, e);
  }
  const data = { ...entry.data, draft: args.action === 'withdraw' };
  const source = serialize(data, entry.body);
  const job = {
    jobId: randomUUID(),
    requestId: args.requestId,
    id: args.id,
    inputRevision: entry.revision,
    reviewToken: args.expectedReview || null,
    action: args.action,
    mode: args.mode,
    status: 'saved',
    createdAt: new Date().toISOString(),
    history: [],
    target:
      args.mode === 'remote'
        ? {
            repository: c.repository,
            branch: c.branch,
            site: c.site,
            base: c.base,
            workflow: c.workflow,
          }
        : null,
  };
  const jobFile = await safePath(root, `.blog/jobs/${job.jobId}.json`);
  const save = async (state) => {
    job.status = state;
    job.updatedAt = new Date().toISOString();
    job.history.push({ status: state, at: job.updatedAt });
    await saveJson(jobFile, job);
  };
  await save('saved');
  await recordJob(job.jobId);
  try {
    await save('checking');
    job.build = await buildSnapshot(root, { id: args.id, source }, c);
    if (args.expectedReview && args.expectedReview !== (await reviewToken(root, args)))
      fail('REVIEW_STALE', '构建期间项目发生变化，请重新预检。');
    if (args.mode === 'simulate') {
      job.message =
        '演练通过：隔离副本完成构建与产物扫描，原内容发布状态未改变，没有提交、推送或上线。';
      await save('simulated');
      return jobView(job);
    }
    // 隔离构建期间外部编辑或提交也必须被发现。
    await remoteReady(root, c, allowed);
    const fresh = await readEntry(root, args.id);
    if (fresh.revision !== entry.revision)
      fail('REVISION_CONFLICT', '构建期间内容发生变化，请重新读取后发布。');
    const file = await safePath(root, `src/content/${args.id}.md`);
    const original = await readFile(file, 'utf8');
    if (fresh.data.draft !== data.draft) await atomic(file, source);
    let hasCommit = false;
    try {
      await checked(root, 'git', ['add', '--', ...allowed], '无法暂存内容与配图');
      const diff = await run(root, 'git', ['diff', '--cached', '--quiet']);
      if (diff.code === 1) {
        await checked(
          root,
          'git',
          ['commit', '--only', '-m', `blog: ${args.action} ${args.id}`, '--', ...allowed],
          '提交失败，请检查 Git 作者设置。',
        );
        hasCommit = true;
      } else if (diff.code !== 0) fail('GIT_FAILED', '无法检查暂存区');
    } catch (e) {
      await run(root, 'git', ['reset', '--', ...allowed]);
      // 没有新的外部修改才撤销本次状态切换。
      if ((await readFile(file, 'utf8')) === source) await atomic(file, original);
      throw e;
    }
    job.commit = await checked(root, 'git', ['rev-parse', 'HEAD'], '无法读取提交');
    job.trigger = hasCommit ? 'push' : 'workflow_dispatch';
    await save('committed');
    await checked(
      root,
      'git',
      ['push', 'origin', `HEAD:refs/heads/${c.branch}`],
      '推送失败；请按任务记录的提交号恢复推送，勿重复创建内容。',
    );
    await save('pushed');
    if (!hasCommit)
      await checked(
        root,
        'gh',
        [
          'workflow',
          'run',
          c.workflow,
          '--repo',
          c.repository,
          '--ref',
          c.branch,
          '--raw-field',
          `blog_request_id=${job.jobId}`,
        ],
        '触发部署失败，请按任务提交号检查 Actions。',
      );
    job.message = '已推送，尚未确认上线。使用 status refresh 查询部署结果。';
    await save('deploying');
    return jobView(job);
  } catch (e) {
    job.lastSuccessfulState = job.status;
    job.error = {
      code: e.code || 'PUBLISH_FAILED',
      message: e.publicMessage || '发布未完成，请检查配置与本地权限。',
    };
    await save('failed');
    return jobView(job);
  }
}
export function matchingRun(job, runs) {
  return runs
    .filter(
      (run) =>
        run.headSha === job.commit &&
        run.event === job.trigger &&
        new Date(run.createdAt) >= new Date(job.createdAt) - 1000 &&
        (job.trigger !== 'workflow_dispatch' || run.displayTitle === `Blog deploy · ${job.jobId}`),
    )
    .sort((a, b) => b.databaseId - a.databaseId)[0];
}
export async function status(root, args) {
  if (!args.jobId) {
    const dir = await safePath(root, '.blog/jobs');
    let names;
    try {
      names = await (await import('node:fs/promises')).readdir(dir);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    const jobs = await Promise.all(
      names.filter((n) => n.endsWith('.json')).map((n) => json(join(dir, n), null)),
    );
    return jobs
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 30)
      .map(jobView);
  }
  const file = await safePath(root, `.blog/jobs/${args.jobId}.json`);
  const job = await json(file, null);
  if (!job) fail('NOT_FOUND', '发布任务不存在');
  if (!args.refresh || job.mode !== 'remote' || !job.commit) return jobView(job);
  return locked(root, async () => {
    const c = job.target;
    const r = await run(root, 'gh', [
      'run',
      'list',
      '--repo',
      c.repository,
      '--workflow',
      c.workflow,
      '--branch',
      c.branch,
      '--commit',
      job.commit,
      '--limit',
      '20',
      '--json',
      'databaseId,headSha,status,conclusion,url,createdAt,event,displayTitle',
    ]);
    if (r.code !== 0)
      fail('STATUS_UNAVAILABLE', '无法查询 GitHub Actions；保留原状态，不视为已上线。');
    const runInfo = matchingRun(job, JSON.parse(r.out));
    if (!runInfo) {
      job.message = '尚未找到本次提交对应的部署运行，请稍后查询。';
      return jobView(job);
    }
    job.runUrl = runInfo.url;
    if (runInfo.status !== 'completed') {
      job.status = 'deploying';
      delete job.error;
      delete job.url;
      job.message = '对应提交仍在部署，尚未确认上线。';
    } else if (runInfo.conclusion === 'success') {
      delete job.error;
      job.status = job.action === 'withdraw' ? 'withdrawn' : 'online';
      job.url = new URL(c.base + (job.action === 'withdraw' ? '' : job.id + '/'), c.site).href;
      job.message =
        job.action === 'withdraw' ? '撤回部署已成功完成。' : '对应提交的部署已成功完成。';
    } else {
      job.status = 'failed';
      delete job.url;
      job.error = { code: 'DEPLOY_FAILED', message: `GitHub Actions 结果：${runInfo.conclusion}` };
    }
    job.updatedAt = new Date().toISOString();
    job.history.push({ status: job.status, at: job.updatedAt });
    await saveJson(file, job);
    return jobView(job);
  });
}
