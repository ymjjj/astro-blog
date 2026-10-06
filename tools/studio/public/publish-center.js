const $ = (id) => document.getElementById(id);
const node = (tag, text, className) => {
  const n = document.createElement(tag);
  n.textContent = text;
  if (className) n.className = className;
  return n;
};
function checks(id, rows) {
  $(id).replaceChildren();
  for (const item of rows) {
    const li = node(
      'li',
      `${{ pass: '✓', warning: '待确认', error: '未通过', info: '说明' }[item.level]} · ${item.message}`,
    );
    li.dataset.level = item.level;
    if (item.next) li.append(node('small', item.next));
    $(id).append(li);
  }
}
export function setupPublishCenter({ api, task, current, assertClean, onConfig, open }) {
  let settings, review;
  const target = () =>
    Object.fromEntries(
      ['repository', 'branch', 'site', 'base'].map((k) => [k, $('setup-' + k).value.trim()]),
    );
  const action = (fn) =>
    task(async () => {
      $('publish-feedback').textContent = '';
      try {
        await fn();
      } catch (e) {
        $('publish-feedback').textContent = e.message;
        throw e;
      }
    });
  async function load() {
    settings = await api('setup');
    for (const [k, v] of Object.entries(settings.target)) $('setup-' + k).value = v;
    checks('setup-checks', settings.checks);
    $('setup-notice').textContent = settings.valid
      ? '已读取本地配置。修改前请检查目标。'
      : '配置无效，可以重新填写修复；原配置不会回显。';
    if (!settings.complete || !settings.valid) $('setup-panel').open = true;
  }
  $('reload-setup').onclick = () => action(load);
  $('check-setup').onclick = () =>
    action(async () => {
      if (!$('setup-form').reportValidity()) return;
      const result = await api('setup', { target: target() });
      checks('setup-checks', result.checks);
      $('setup-notice').textContent =
        '候选配置检查完成，尚未保存。警告需在真实发布前核对；未验证远程权限。';
    });
  $('setup-form').onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      if (!settings) await load();
      const submitted = target();
      settings = await api('configure', {
        target: submitted,
        expectedConfig: settings.revision,
        requestId: crypto.randomUUID(),
      });
      checks('setup-checks', settings.checks);
      await onConfig();
      review = null;
      $('review-panel').hidden = true;
      $('setup-notice').textContent = '已保存到本机，远程发布关闭。可以开始完整检查和演练。';
    });
  };
  async function pending() {
    const result = await api('pending', { query: $('pending-query').value });
    $('pending-notice').textContent =
      result.notice +
      (result.head
        ? ` 基线：${result.head.slice(0, 12)}`
        : ' 当前无 Git 基线，不能判断哪些修改已提交或上线。');
    $('pending-list').replaceChildren();
    const labels = {
      draft: '草稿',
      new: '新内容',
      modified: '本地修改',
      unchanged: '与本地提交相同',
      unknown: '基线未知',
      deleted: '本地已移除',
      invalid: '内容错误',
    };
    for (const item of result.items) {
      const row = node('div', '', 'manage-row');
      row.append(
        node('strong', `${labels[item.state]} · ${item.title || item.id}`),
        node('small', item.id),
      );
      if (item.error) row.append(node('p', item.error.message));
      if (item.revision) {
        const button = node('button', '打开并预览修改');
        button.type = 'button';
        button.onclick = () =>
          action(async () => {
            assertClean();
            await open(item.id);
            await inspect(false);
          });
        row.append(button);
      }
      $('pending-list').append(row);
    }
    if (!result.items.length) $('pending-list').textContent = '没有匹配内容。';
  }
  $('refresh-pending').onclick = () => action(pending);
  $('pending-panel').ontoggle = () => {
    if ($('pending-panel').open) action(pending);
  };
  async function inspect(build = false, requestedAction = $('review-action').value) {
    assertClean();
    const entry = current();
    if (!entry) throw Error('请先打开并保存一篇内容。');
    $('publish-feedback').textContent = build
      ? '正在隔离构建并扫描产物，请稍候……'
      : '正在检查当前内容……';
    review = null;
    $('review-panel').hidden = true;
    const result = await api('preflight', {
      id: entry.id,
      expectedRevision: entry.revision,
      action: requestedAction,
      build,
    });
    review = result;
    $('review-panel').hidden = false;
    $('review-panel').dataset.revision = result.revision;
    $('review-notice').textContent =
      `${result.passed ? '检查通过' : '检查未通过'} · ${requestedAction === 'withdraw' ? '撤回预览' : '发布预览'} · ${result.id}。${result.notice}`;
    checks('review-checks', result.checks);
    $('review-url').textContent = result.targetUrl
      ? `预计地址（未上线）：${result.targetUrl}`
      : '尚未配置正式地址；仍可本地演练。';
    $('review-diff').replaceChildren();
    for (const line of result.lines)
      $('review-diff').append(
        node(
          'div',
          { add: '+ ', remove: '− ', equal: '  ' }[line.type] + line.text,
          'diff-' + line.type,
        ),
      );
    $('review-images').replaceChildren(
      ...result.files.map((f) => node('li', `${f.path} · ${f.bytes.toLocaleString()} B`)),
    );
    if (!result.files.length) $('review-images').append(node('li', '没有本地 Markdown 图片引用。'));
    $('publish-feedback').textContent = result.passed
      ? build
        ? '完整检查通过；未改变原稿或上线。'
        : '快速检查通过；演练会继续构建完整网站。'
      : '请根据检查结果修复后再试。';
    return result;
  }
  $('inspect-publish').onclick = () => action(() => inspect(false));
  $('build-preflight').onclick = () => action(() => inspect(true));
  $('review-action').onchange = () => {
    review = null;
    $('review-panel').hidden = true;
    $('simulate').textContent = $('review-action').value === 'withdraw' ? '演练撤回' : '演练发布';
  };
  document.addEventListener('content-changed', () => {
    review = null;
    $('review-panel').hidden = true;
  });
  return { load, pending, inspect, getReview: () => review };
}

export function renderJobs(tasks, { labels, refresh, reopen }) {
  $('jobs').replaceChildren();
  const filter = $('job-filter').value;
  for (const j of tasks.filter(
    (t) => filter === 'all' || (filter === 'remote' ? t.mode === 'remote' : t.status === filter),
  )) {
    const box = node('div', '', 'job');
    box.dataset.jobId = j.jobId;
    box.append(
      node('strong', `${labels[j.status] || j.status} · ${j.id}`),
      node(
        'small',
        `${j.mode === 'simulate' ? '本地演练' : '真实发布'} · ${j.action === 'withdraw' ? '撤回' : '发布 / 更新'} · ${new Date(j.createdAt).toLocaleString()}`,
      ),
      node('p', j.error?.message || j.message || '任务执行中'),
    );
    const detail = node('details', '');
    detail.append(node('summary', '任务详情与处理建议'));
    const meta = [
      `任务 ID：${j.jobId}`,
      `请求 ID：${j.requestId}`,
      j.commit && `提交：${j.commit}`,
      j.error && `错误：${j.error.code}`,
      j.lastSuccessfulState &&
        `失败前阶段：${labels[j.lastSuccessfulState] || j.lastSuccessfulState}`,
      j.inputRevision && `送检版本：${j.inputRevision}`,
      j.target && `目标：${j.target.repository} / ${j.target.branch}`,
    ].filter(Boolean);
    detail.append(node('pre', meta.join('\n')));
    const steps = node('ol', '');
    for (const h of j.history || [])
      steps.append(
        node('li', `${labels[h.status] || h.status} · ${new Date(h.at).toLocaleString()}`),
      );
    detail.append(steps);
    for (const next of j.nextSteps || []) detail.append(node('p', next));
    if (j.build?.passed) detail.append(node('p', '隔离构建与产物扫描通过；这不是上线证明。'));
    box.append(detail);
    for (const [url, label] of [
      [j.status === 'online' || j.status === 'withdrawn' ? j.url : null, '查看网站 ↗'],
      [j.runUrl, '查看部署 ↗'],
    ]) {
      if (!url) continue;
      try {
        const u = new URL(url);
        if (u.protocol !== 'https:' || u.username || u.password) continue;
      } catch {
        continue;
      }
      const a = node('a', label);
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      box.append(a);
    }
    if (j.mode === 'remote') {
      const b = node('button', '查询部署状态');
      b.onclick = () => refresh(j.jobId);
      box.append(b);
    }
    if (j.status === 'failed') {
      const b = node('button', '读取当前内容并重新检查');
      b.onclick = () => reopen(j.id, j.action);
      box.append(b);
    }
    $('jobs').append(box);
  }
  if (!$('jobs').children.length)
    $('jobs').textContent = '暂无匹配任务。保存、提交、推送和上线会分别记录。';
}
