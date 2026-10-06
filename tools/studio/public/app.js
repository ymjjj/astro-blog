import { setupMaintenance } from './maintenance.js';
import { setupPublishCenter, renderJobs } from './publish-center.js';
let publishing;
const $ = (id) => document.getElementById(id);
let maintenance;
const token = document.querySelector('meta[name=studio-token]').content;
let current = null,
  dirty = false,
  busy = false,
  config = null;
let sessionId = crypto.randomUUID(),
  recoveryVersion = null,
  autoTimer,
  sequence = 0;
let blocked = false,
  comparedExternal = null,
  pendingSave = null,
  selectedDiff = null;
let autoDone = null;
const formKeys = ['kind', 'slug', 'title', 'description', 'date', 'updated', 'tags', 'body'];
const cachePrefix = () => `studio-recovery:${config?.workspaceId}:`;
const capture = () => Object.fromEntries(formKeys.map((k) => [k, $(k).value]));
function cache() {
  if (!config || !dirty) return true;
  try {
    localStorage.setItem(
      cachePrefix() + sessionId,
      JSON.stringify({
        sessionId,
        version: recoveryVersion,
        id: current?.id || null,
        baseRevision: current?.revision || null,
        form: capture(),
        savedAt: new Date().toISOString(),
        pendingSave,
      }),
    );
    return true;
  } catch {
    $('save-state').textContent = '浏览器恢复副本未保存，请尽快手动保存';
    return false;
  }
}
function edited() {
  document.dispatchEvent(new Event('content-changed'));
  dirty = true;
  sequence++;
  const cached = cache();
  clearTimeout(autoTimer);
  $('save-state').textContent = blocked
    ? '有冲突，自动保存已暂停'
    : '有未保存的修改 · 等待自动保存';
  if (!cached) $('save-state').textContent = '浏览器恢复副本未保存，请尽快手动保存';
  autoTimer = setTimeout(autoSave, 1800);
}
async function checkpoint() {
  let result;
  try {
    result = await api('checkpoint', {
      sessionId,
      expectedVersion: recoveryVersion,
      id: current?.id || null,
      baseRevision: current?.revision || null,
      form: capture(),
      requestId: crypto.randomUUID(),
    });
  } catch (e) {
    if (e.code !== 'RECOVERY_CONFLICT') throw e;
    // A timed-out checkpoint or another client may have advanced this copy. Fork, never overwrite it.
    sessionId = crypto.randomUUID();
    recoveryVersion = null;
    cache();
    result = await api('checkpoint', {
      sessionId,
      expectedVersion: null,
      id: current?.id || null,
      baseRevision: current?.revision || null,
      form: capture(),
      requestId: crypto.randomUUID(),
    });
  }
  recoveryVersion = result.version;
  cache();
}
async function clearRecovery() {
  if (recoveryVersion) {
    await api('discard', {
      sessionId,
      expectedVersion: recoveryVersion,
      requestId: crypto.randomUUID(),
    });
    recoveryVersion = null;
  }
  try {
    localStorage.removeItem(cachePrefix() + sessionId);
  } catch {}
}
async function autoSave() {
  if (!dirty) return;
  if (busy) {
    autoTimer = setTimeout(autoSave, 800);
    return;
  }
  busy = true;
  let finish;
  autoDone = new Promise((resolve) => {
    finish = resolve;
  });
  try {
    await checkpoint();
    if (blocked) return;
    if (!$('editor').checkValidity() || !$('body').value.trim()) {
      $('save-state').textContent = '未填完整 · 恢复副本已保存';
      return;
    }
    await save(true);
  } catch (e) {
    say(e.message, true);
    $('save-state').textContent = blocked
      ? '有冲突，自动保存已暂停'
      : '自动保存未完成 · 请重试保存';
  } finally {
    busy = false;
    autoDone = null;
    finish();
  }
}
const labels = {
  saved: '已保存',
  checking: '检查中',
  simulated: '演练通过（未上线）',
  committed: '已提交',
  pushed: '已推送',
  deploying: '部署中',
  online: '已上线',
  withdrawn: '已撤回',
  failed: '失败',
};
const localTime = (value) => {
  const d = new Date(value);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const say = (message, error = false) => {
  $('message').textContent = message;
  $('message').dataset.error = String(error);
};
async function api(op, args = {}) {
  const response = await fetch('/api/' + op, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(['publish', 'preflight'].includes(op) ? 180000 : 30000),
  });
  const result = await response.json();
  if (!result.ok) {
    if (result.error.code === 'REVISION_CONFLICT') {
      blocked = true;
      $('conflict-panel').hidden = false;
    }
    const error = Error(
      `${result.error.code}：${result.error.message}${result.error.details ? '\n' + JSON.stringify(result.error.details) : ''}`,
    );
    error.code = result.error.code;
    throw error;
  }
  return result.data;
}
async function task(fn) {
  if (autoDone) await autoDone;
  if (busy) return;
  busy = true;
  $('editor').inert = true;
  $('setup-form').inert = true;
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    say(e.message, true);
  } finally {
    busy = false;
    $('editor').inert = false;
    $('setup-form').inert = false;
    document.querySelectorAll('button').forEach((b) => (b.disabled = false));
    $('publish').disabled = $('withdraw').disabled = !config?.remoteEnabled;
    $('restore-version').disabled = !selectedDiff || dirty;
    document.dispatchEvent(new Event('studio-idle'));
  }
}
function fields() {
  const result = {
    body: $('body').value,
    title: $('title').value.trim(),
    tags: $('tags')
      .value.split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean),
    date:
      current && $('date').value === localTime(current.data.date)
        ? current.data.date
        : new Date($('date').value).toISOString(),
  };
  if ($('kind').value === 'posts') {
    result.description = $('description').value.trim();
    result.updated = $('updated').value
      ? current?.data.updated && $('updated').value === localTime(current.data.updated)
        ? current.data.updated
        : new Date($('updated').value).toISOString()
      : null;
  }
  return result;
}
function kindChanged() {
  const post = $('kind').value === 'posts';
  $('description-field').hidden = $('updated-field').hidden = !post;
  $('title').required = $('description').required = post;
  $('title-hint').textContent = post ? '文章必填' : '可留空';
}
function show(entry) {
  document.dispatchEvent(new Event('content-changed'));
  clearTimeout(autoTimer);
  sequence++;
  sessionId = crypto.randomUUID();
  recoveryVersion = null;
  blocked = false;
  pendingSave = null;
  comparedExternal = null;
  selectedDiff = null;
  $('conflict-panel').hidden = true;
  $('history-controls').hidden = true;
  $('accept-merge').hidden = $('use-external').hidden = true;
  current = entry;
  dirty = false;
  $('kind').value = entry?.kind || 'posts';
  $('kind').disabled = !!entry;
  $('slug').disabled = !!entry;
  $('slug').value = entry?.id.split('/').slice(1).join('/') || '';
  for (const k of ['title', 'description']) $(k).value = entry?.data[k] || '';
  $('body').value = entry?.body || '';
  $('tags').value = entry?.data.tags?.join('，') || '';
  $('date').value = localTime(entry?.data.date || new Date());
  $('updated').value = entry?.data.updated ? localTime(entry.data.updated) : '';
  $('editor-heading').textContent = entry ? entry.data.title || '一枚碎碎念' : '新的一页';
  $('save-state').textContent = entry
    ? entry.data.draft
      ? '草稿已保存'
      : '已标记发布 · 本地内容'
    : '尚未保存';
  $('save').textContent = entry && !entry.data.draft ? '保存修改' : '保存草稿';
  document.querySelector('.preview-panel').hidden = true;
  kindChanged();
}
async function list() {
  const args = { query: $('query').value };
  if ($('filter').value !== 'all') args.draft = $('filter').value === 'draft';
  const entries = await api('list', args);
  $('entries').replaceChildren();
  for (const e of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'entry';
    button.setAttribute('aria-current', String(e.id === current?.id));
    const title = document.createElement('strong');
    title.textContent =
      e.data.title || e.excerpt.replace(/[#*_]/g, '').slice(0, 28) || '一枚碎碎念';
    const meta = document.createElement('small');
    meta.textContent = `${e.kind === 'posts' ? '文章' : '碎碎念'} · ${e.data.draft ? '草稿' : '已标记发布'} · ${new Date(e.data.date).toLocaleDateString()}`;
    button.append(title, meta);
    button.onclick = () =>
      task(async () => {
        if (dirty && !confirm('有尚未保存的内容，放弃修改并打开其他内容？')) return;
        show(await api('read', { id: e.id }));
        await list();
      });
    $('entries').append(button);
  }
  if (!entries.length) $('entries').textContent = '还没有匹配的手记，写下第一句吧。';
}
async function save(automatic = false) {
  if (blocked) throw Error('自动保存已暂停，请先读取磁盘版本并比较合并。');
  if (!$('editor').reportValidity()) throw Error('请补全必填字段');
  const savedSequence = sequence;
  const args = { ...fields(), requestId: crypto.randomUUID() };
  if (!pendingSave)
    pendingSave = current
      ? {
          op: automatic ? 'autosave' : 'update',
          args: { ...args, id: current.id, expectedRevision: current.revision },
        }
      : {
          op: 'create',
          args: {
            ...args,
            kind: $('kind').value,
            ...($('slug').value ? { slug: $('slug').value } : {}),
          },
        };
  // Persist the exact request before sending. A lost response can be replayed without duplicate creation.
  const submitted = pendingSave;
  cache();
  let entry;
  try {
    entry = await api(submitted.op, submitted.args);
  } catch (e) {
    if (e.code) pendingSave = null;
    cache();
    throw e;
  }
  pendingSave = null;
  current = entry;
  $('kind').disabled = $('slug').disabled = true;
  $('slug').value = entry.id.split('/').slice(1).join('/');
  // Never replace text typed while an autosave request was in flight.
  const stillSame =
    sequence === savedSequence &&
    fields().body === submitted.args.body &&
    Object.entries(fields()).every(
      ([k, v]) => JSON.stringify(v) === JSON.stringify(submitted.args[k]),
    );
  dirty = !stillSame;
  if (!dirty) {
    await clearRecovery();
    if (sequence !== savedSequence) {
      dirty = true;
      cache();
      autoTimer = setTimeout(autoSave, 1800);
    }
    $('save-state').textContent = dirty
      ? '有未保存的修改'
      : automatic
        ? '已自动保存到本地'
        : '已保存到本地';
  } else {
    cache();
    autoTimer = setTimeout(autoSave, 1800);
  }
  $('editor-heading').textContent = entry.data.title || '一枚碎碎念';
  $('save').textContent = entry.data.draft ? '保存草稿' : '保存修改';
  await list();
  say(
    '已保存到本地。' +
      (entry.data.draft ? '仍是草稿，没有上线。' : '线上版本尚未更新，请完成发布。'),
  );
  return entry;
}
async function preview() {
  const e = await save();
  const result = await api('preview', { id: e.id });
  $('preview-link').href = result.url;
  $('preview-frame').src = result.url + '?preview=' + Date.now();
  document.querySelector('.preview-panel').hidden = false;
  say('已保存并打开预览。预览首次启动可能需要几秒；空白时可独立窗口打开。');
}
async function jobs() {
  renderJobs(await api('status'), {
    labels,
    refresh: (jobId) =>
      task(async () => {
        try {
          await api('status', { jobId, refresh: true });
        } catch (e) {
          $('publish-feedback').textContent = e.message + '。保留原状态；查询失败不代表已上线。';
          throw e;
        } finally {
          await jobs();
        }
      }),
    reopen: (id, action) =>
      task(async () => {
        if (dirty) throw Error('请先保存当前编辑。');
        show(await api('read', { id }));
        await list();
        $('review-action').value = action;
        $('review-action').dispatchEvent(new Event('change'));
        await publishing.inspect(false, action);
      }),
  });
}
$('job-filter').onchange = () => task(jobs);
async function deploy(mode, action = 'publish') {
  if (!current || dirty) throw Error('请先保存当前内容，再进行发布操作。');
  if (
    mode === 'remote' &&
    !confirm(
      `即将${action === 'withdraw' ? '撤回' : '发布'} ${current.data.title || current.id} 到 ${config.repository}。继续？`,
    )
  )
    return;
  const review = publishing.getReview();
  const checked =
    review &&
    review.id === current.id &&
    review.revision === current.revision &&
    review.action === action
      ? review
      : await publishing.inspect(false, action);
  if (!checked.passed) throw Error('发布前检查未通过，请先修复检查项。');
  say('正在隔离构建与校验，请稍候……');
  $('publish-feedback').textContent = '正在隔离构建与校验，请稍候……';
  let job;
  try {
    job = await api('publish', {
      id: current.id,
      expectedRevision: current.revision,
      requestId: crypto.randomUUID(),
      mode,
      action,
      expectedReview: checked.reviewToken,
    });
  } catch (e) {
    $('publish-feedback').textContent =
      e.message + '。可刷新任务查看结果；先核对任务，再重新检查。';
    throw e;
  } finally {
    await jobs();
  }
  $('publish-feedback').textContent = job.message;
  say(job.error?.message || job.message, job.status === 'failed');
  show(await api('read', { id: current.id }));
  await list();
  await jobs();
}
$('editor').addEventListener('input', (e) => {
  if (e.target.id !== 'image') edited();
});
$('kind').onchange = kindChanged;
$('editor').onsubmit = (e) => {
  e.preventDefault();
  task(save);
};
$('preview').onclick = () => task(preview);
$('new').onclick = () => {
  if (busy) return;
  if (dirty && !confirm('放弃尚未保存的修改，开始新的一页？')) return;
  show(null);
  say('新内容默认保存为草稿，不会自动上线。');
};
$('check').onclick = () =>
  task(async () => {
    if (!current || dirty) throw Error('请先保存再检查');
    const result = await api('check', { id: current.id });
    say(`检查通过：${result.checked} 条内容。发布演练会进一步构建完整站点。`);
  });
$('image').onchange = () => importImages(Array.from($('image').files));
function importImages(files) {
  return task(async () => {
    if (!current) throw Error('请先保存草稿，再插入图片');
    let count = 0;
    for (const file of files) {
      if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type))
        throw Error(`不支持的图片格式：${file.name}`);
      if (file.size > 10 * 1024 * 1024) throw Error('图片不能超过 10 MB');
      const alt = prompt('请为图片写一句描述（用于替代文本）', file.name.replace(/\.[^.]+$/, ''));
      if (!alt?.trim()) continue;
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await api('image', {
        id: current.id,
        base64,
        alt,
        requestId: crypto.randomUUID(),
      });
      const body = $('body');
      body.setRangeText(
        '\n' + result.markdown + '\n',
        body.selectionStart,
        body.selectionEnd,
        'end',
      );
      edited();
      count++;
    }
    say(`图片已导入：已插入 ${count} 张，将自动保存到本地。`);
    $('image').value = '';
  });
}
$('body').addEventListener('paste', (e) => {
  const files = Array.from(e.clipboardData?.files || []);
  if (files.length) {
    e.preventDefault();
    importImages(files);
  }
});
$('body').addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('Files')) {
    e.preventDefault();
    $('body').dataset.drag = 'true';
  }
});
$('body').addEventListener('dragleave', () => delete $('body').dataset.drag);
$('body').addEventListener('drop', (e) => {
  delete $('body').dataset.drag;
  if (e.dataTransfer.files.length) {
    e.preventDefault();
    importImages(Array.from(e.dataTransfer.files));
  }
});
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files.length) e.preventDefault();
});
$('simulate').onclick = () => task(() => deploy('simulate', $('review-action').value));
$('publish').onclick = () => task(() => deploy('remote'));
$('withdraw').onclick = () => task(() => deploy('remote', 'withdraw'));
$('refresh-jobs').onclick = () => task(jobs);
let searchTimer;
$('query').oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => task(list), 250);
};
$('filter').onchange = () => task(list);
async function recoveries() {
  const items = new Map(
    (await api('recovery', { summary: true })).map((r) => [
      r.sessionId,
      { ...r, serverVersion: r.version },
    ]),
  );
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith(cachePrefix())) continue;
      const item = JSON.parse(localStorage.getItem(key));
      if (!items.has(item.sessionId) || item.savedAt >= items.get(item.sessionId).savedAt)
        items.set(item.sessionId, {
          ...item,
          serverVersion: items.get(item.sessionId)?.serverVersion || null,
        });
    }
  } catch {
    say('部分浏览器恢复副本无法读取，请保留当前编辑并手动保存。', true);
  }
  $('recoveries').replaceChildren();
  $('recovery-panel').hidden = items.size === 0 && !$('recovery-query').value;
  $('recovery-space').textContent = `${items.size} 份副本 · 约 ${Array.from(items.values())
    .reduce((s, r) => s + (r.bytes || new TextEncoder().encode(JSON.stringify(r)).length), 0)
    .toLocaleString()} B（浏览器副本按UTF-8估算）`;
  for (const item of items.values()) {
    if (
      $('recovery-query').value &&
      !JSON.stringify(item).toLowerCase().includes($('recovery-query').value.toLowerCase())
    )
      continue;
    const box = document.createElement('div');
    box.className = 'recovery-item';
    const text = document.createElement('div');
    text.textContent = `${item.form.title || '未命名草稿'} · ${new Date(item.savedAt).toLocaleString()} · ${item.id || '尚未创建正式内容'} · ${item.bytes || new TextEncoder().encode(JSON.stringify(item)).length} B`;
    const preview = document.createElement('details'),
      summary = document.createElement('summary'),
      body = document.createElement('pre');
    summary.textContent = '预览副本';
    body.textContent =
      JSON.stringify({ ...item.form, body: undefined }, null, 2) + '\n\n' + item.form.body;
    preview.append(summary, body);
    const open = document.createElement('button');
    open.textContent = '恢复编辑';
    open.onclick = () =>
      task(async () => {
        if (dirty && !confirm('当前编辑已保留恢复副本，打开选中的恢复内容？')) return;
        let entry = null;
        if (item.id) entry = await api('read', { id: item.id });
        const conflict = entry && entry.revision !== item.baseRevision;
        show(entry ? { ...entry, revision: item.baseRevision } : null);
        for (const key of formKeys) $(key).value = item.form[key];
        kindChanged();
        pendingSave = item.pendingSave || null;
        // Fork the recovered editing session: never overwrite another open tab's checkpoint.
        blocked = !!conflict && !pendingSave;
        $('conflict-panel').hidden = !blocked;
        edited();
        say(
          blocked
            ? '已找回编辑，但磁盘内容已变化。请先比较合并。'
            : '已找回编辑；原恢复副本保留，可在确认保存后清理。',
          blocked,
        );
      });
    const remove = document.createElement('button');
    remove.textContent = '预览清理';
    remove.onclick = () =>
      task(async () => {
        await syncRecoveryCopies();
        const serverItems = await api('recovery');
        const server = serverItems.find((r) => r.sessionId === item.sessionId);
        if (server) {
          const key = cachePrefix() + item.sessionId;
          maintenance.reviewPlan(
            await api('plan', {
              kind: 'cleanup',
              paths: [`.blog/recovery/${item.sessionId}.json`],
              requestId: crypto.randomUUID(),
            }),
            [[key, localStorage.getItem(key)]],
          );
        } else {
          throw Error('该副本尚未同步，请刷新恢复中心后重试。');
        }
      });
    box.append(text, preview, open, remove);
    $('recoveries').append(box);
  }
}
$('refresh-recovery').onclick = () => task(recoveries);
$('recovery-query').oninput = () => task(recoveries);
async function syncRecoveryCopies() {
  if (dirty) await checkpoint();
  const server = new Map((await api('recovery')).map((r) => [r.sessionId, r]));
  for (const key of Object.keys(localStorage).filter((k) => k.startsWith(cachePrefix()))) {
    const item = JSON.parse(localStorage.getItem(key)),
      existing = server.get(item.sessionId);
    if (
      existing &&
      JSON.stringify(existing.form) === JSON.stringify(item.form) &&
      existing.id === item.id &&
      existing.baseRevision === item.baseRevision
    )
      continue;
    if (existing && existing.version !== item.version)
      throw Error('浏览器与本机恢复副本不同，请先恢复合并后再备份或清理。');
    const result = await api('checkpoint', {
      sessionId: item.sessionId,
      expectedVersion: existing?.version || null,
      id: item.id,
      baseRevision: item.baseRevision,
      form: item.form,
      requestId: crypto.randomUUID(),
    });
    item.version = result.version;
    localStorage.setItem(key, JSON.stringify(item));
    if (item.sessionId === sessionId) recoveryVersion = result.version;
  }
}
$('compare-external').onclick = () =>
  task(async () => {
    if (!current) throw Error('尚无正式内容可比较，请重试保存或检查请求记录。');
    comparedExternal = await api('read', { id: current.id });
    $('external-content').textContent =
      JSON.stringify(comparedExternal.data, null, 2) + '\n\n' + comparedExternal.body;
    $('accept-merge').hidden = $('use-external').hidden = false;
  });
$('accept-merge').onclick = () =>
  task(async () => {
    if (!comparedExternal) return;
    if (!confirm('确认已比较磁盘内容并完成合并？将以刚才读取的版本为基础保存上方编辑。')) return;
    current = comparedExternal;
    blocked = false;
    pendingSave = null;
    comparedExternal = null;
    $('conflict-panel').hidden = true;
    edited();
    await save();
  });
$('use-external').onclick = () =>
  task(async () => {
    if (!comparedExternal || !confirm('放弃上方编辑并使用磁盘版本？')) return;
    const entry = await api('read', { id: comparedExternal.id });
    await clearRecovery();
    show(entry);
    say('已读取磁盘版本。');
  });
async function loadHistory() {
  if (!current) throw Error('先保存一篇内容，再查看修改历史。');
  const result = await api('history', { id: current.id });
  $('history-version').replaceChildren();
  selectedDiff = null;
  for (const item of result.versions) {
    const option = document.createElement('option');
    option.value = item.revision;
    const reason =
      {
        create: '首次保存',
        update: '手动保存',
        autosave: '自动保存',
        restore: '版本恢复',
        external: '磁盘版本',
      }[item.reason] || '保存前版本';
    option.textContent = `${item.current ? '当前 · ' : ''}${item.recordedAt ? new Date(item.recordedAt).toLocaleString() : ''} · ${reason} · ${item.revision.slice(0, 8)}`;
    $('history-version').append(option);
  }
  $('history-controls').hidden = false;
  $('version-diff').replaceChildren();
  $('diff-summary').textContent = '选择版本后进行比较。';
}
$('load-history').onclick = () => task(loadHistory);
$('history-version').onchange = () => {
  selectedDiff = null;
  $('restore-version').disabled = true;
};
$('compare-version').onclick = () =>
  task(async () => {
    if (!current) return;
    selectedDiff = await api('diff', { id: current.id, fromRevision: $('history-version').value });
    $('version-diff').replaceChildren();
    $('diff-summary').textContent =
      `旧版本 → 当前磁盘版本；${selectedDiff.fields.length} 个字段变化。恢复会保留当前发布状态。`;
    for (const f of selectedDiff.fields) {
      const row = document.createElement('div');
      row.textContent = `${f.field}: ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`;
      $('version-diff').append(row);
    }
    for (const line of selectedDiff.lines) {
      const row = document.createElement('div');
      row.className = 'diff-' + line.type;
      row.textContent = { add: '+ ', remove: '− ', equal: '  ' }[line.type] + line.text;
      $('version-diff').append(row);
    }
  });
$('restore-version').onclick = () =>
  task(async () => {
    if (!current || dirty || !selectedDiff) throw Error('请先保存编辑并比较版本，再恢复。');
    if (!confirm('将选中的历史内容恢复到本地？当前版本会保留，不改变发布状态，也不会推送。'))
      return;
    const entry = await api('restore', {
      id: current.id,
      revision: selectedDiff.fromRevision,
      expectedRevision: selectedDiff.toRevision,
      requestId: crypto.randomUUID(),
    });
    show(entry);
    await list();
    await loadHistory();
    say('历史内容已恢复到本地，未推送或上线。');
  });
try {
  document.documentElement.dataset.theme = localStorage.getItem('studio-theme') || 'light';
} catch {}
$('theme').onclick = () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('studio-theme', theme);
  } catch {}
};
window.addEventListener('beforeunload', (e) => {
  cache();
  if (dirty) {
    e.preventDefault();
  }
});
show(null);
maintenance = setupMaintenance({
  api,
  task,
  sync: syncRecoveryCopies,
  assertClean: () => {
    if (dirty) throw Error('请先保存当前编辑，再执行清单；有新修改时需要重新预览。');
  },
  afterChange: async () => {
    if (current) {
      try {
        show(await api('read', { id: current.id }));
      } catch (e) {
        if (e.code === 'NOT_FOUND') show(null);
        else throw e;
      }
    }
    await list();
    await recoveries();
  },
});

publishing = setupPublishCenter({
  api,
  task,
  current: () => current,
  assertClean: () => {
    if (dirty) throw Error('请先保存当前编辑，再检查发布。');
  },
  onConfig: async () => {
    config = await api('config');
    $('config-status').textContent = config.notice;
  },
  open: async (id) => {
    show(await api('read', { id }));
    await list();
  },
});
await task(async () => {
  config = await api('config');
  $('config-status').textContent = config.notice;
  await publishing.load();
  await jobs();
  await recoveries();
  await list();
});
