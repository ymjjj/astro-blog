const $ = (id) => document.getElementById(id);
const size = (n) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KiB`
      : `${(n / 1024 / 1024).toFixed(2)} MiB`;
const node = (tag, text, className) => {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
};
export function setupMaintenance({ api, task, sync, assertClean, afterChange }) {
  let pending = null,
    clearCache = [];
  const tell = (text) => {
    $('maintenance-message').textContent = text;
  };
  const run = (fn) =>
    task(async () => {
      try {
        await fn();
      } catch (e) {
        tell(e.message);
        throw e;
      }
    });
  const button = (label, fn) => {
    const b = node('button', label);
    b.type = 'button';
    b.onclick = () => run(fn);
    return b;
  };
  const updateApply = () => {
    $('apply-plan').disabled = !pending || !$('confirm-plan').checked || pending.count === 0;
  };
  document.addEventListener('studio-idle', updateApply);
  function reviewPlan(result, keys = []) {
    pending = result;
    $('plan-panel').dataset.planId = result.planId;
    clearCache = keys;
    $('plan-panel').hidden = false;
    $('confirm-plan').checked = false;
    updateApply();
    $('plan-notice').textContent = `${result.count} 项变更。${result.notice}`;
    $('plan-files').replaceChildren();
    for (const file of result.files) {
      const row = node('details', '', 'manage-row');
      row.append(
        node(
          'summary',
          `${file.action} · ${file.path} · ${size(file.before?.bytes || 0)} → ${size(file.after?.bytes || 0)}`,
        ),
      );
      row.append(
        node(
          'pre',
          `执行前：\n${file.beforePreview ?? '（不存在或二进制文件）'}\n\n执行后：\n${file.afterPreview ?? '（移入回收站或二进制文件）'}`,
        ),
      );
      $('plan-files').append(row);
    }
    tell('清单已生成，尚未修改任何文件。');
    $('plan-panel').scrollIntoView({ behavior: 'instant', block: 'start' });
  }
  async function images() {
    $('asset-panel').hidden = false;
    const result = await api('assets', {
      query: $('asset-query').value,
      unused: $('asset-filter').value === 'unused',
    });
    $('asset-space').textContent = `${result.images.length} 张图片 · ${size(result.bytes)}`;
    $('asset-list').replaceChildren();
    for (const asset of result.images) {
      const card = node('div', '', 'asset-card');
      card.append(
        node('strong', asset.path),
        node(
          'p',
          `${size(asset.bytes)} · ${asset.width || '?'} × ${asset.height || '?'} · ${asset.reason}`,
        ),
      );
      const preview = button('预览图片', async () => {
        const result = await api('asset', { path: asset.path });
        let img = card.querySelector('img');
        if (!img) {
          img = document.createElement('img');
          img.alt = asset.path;
          card.append(img);
        }
        img.src = result.dataUrl;
      });
      if (!asset.path.toLowerCase().endsWith('.svg')) card.append(preview);
      else card.append(node('p', '矢量资源：保留源文件，不生成栅格缩略图。'));
      const refs = node('details', '');
      refs.append(node('summary', `引用位置（${asset.references.length}）`));
      for (const ref of asset.references)
        refs.append(
          node(
            'p',
            `${{ content: '正文', history: '历史', recovery: '恢复副本', trash: '回收站', source: '站点源码' }[ref.type]} · ${ref.owner}`,
          ),
        );
      card.append(refs);
      if (asset.cleanupAllowed)
        card.append(
          button('预览清理', async () => {
            await sync();
            reviewPlan(
              await api('plan', {
                kind: 'cleanup',
                paths: [asset.path],
                requestId: crypto.randomUUID(),
              }),
            );
          }),
        );
      $('asset-list').append(card);
    }
  }
  async function download(id) {
    const token = document.querySelector('meta[name=studio-token]').content;
    const response = await fetch('/api/backupdownload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token },
      body: JSON.stringify({ backupId: id }),
    });
    if (!response.ok) {
      const r = await response.json();
      throw Error(r.error?.message || '下载失败');
    }
    const href = URL.createObjectURL(await response.blob()),
      a = document.createElement('a');
    a.href = href;
    a.download = id + '.blogbackup.gz';
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
    tell('备份下载已发起，请妥善保存文件。');
  }
  async function backups() {
    $('backup-panel').hidden = false;
    $('backup-list').replaceChildren();
    for (const b of await api('backups')) {
      const row = node('div', '', 'manage-row');
      row.append(
        node('strong', `${new Date(b.createdAt).toLocaleString()} · ${size(b.bytes)}`),
        node('p', b.backupId),
      );
      row.append(
        button('下载备份', () => download(b.backupId)),
        button('校验与查看清单', async () => {
          const checked = await api('backupcheck', { backupId: b.backupId });
          $('backup-inspection').hidden = false;
          $('backup-inspection').textContent =
            `完整性校验通过 · ${checked.files.length} 文件 · ${size(checked.bytes)}\n` +
            checked.files.map((f) => `${f.path} · ${size(f.bytes)} · ${f.sha256}`).join('\n');
          tell('所有文件内容、路径与清单哈希校验通过。');
        }),
        button('预览恢复', async () => {
          await sync();
          reviewPlan(
            await api('plan', {
              kind: 'restore',
              backupId: b.backupId,
              requestId: crypto.randomUUID(),
            }),
          );
        }),
      );
      $('backup-list').append(row);
    }
    if (!$('backup-list').children.length)
      $('backup-list').textContent = '还没有备份，可以先生成一份。';
  }
  async function trash() {
    $('trash-panel').hidden = false;
    $('trash-list').replaceChildren();
    for (const t of await api('trash')) {
      const row = node('div', '', 'manage-row');
      row.append(
        node(
          'strong',
          `${new Date(t.createdAt).toLocaleString()} · ${t.kind} · ${{ completed: '已完成，可撤销', applying: '执行中或已中断', failed: '执行失败，需核对', undone: '已撤销' }[t.status] || t.status}`,
        ),
        node('p', `${t.transactionId} · ${t.count} 项 · ${size(t.bytes)}`),
      );
      const details = node('details', '');
      details.append(node('summary', '查看涉及文件'), node('pre', t.paths.join('\n')));
      row.append(details);
      if (t.status !== 'undone')
        row.append(
          button('预览撤销', async () => {
            await sync();
            reviewPlan(
              await api('plan', {
                kind: 'undo',
                transactionId: t.transactionId,
                requestId: crypto.randomUUID(),
              }),
            );
          }),
        );
      $('trash-list').append(row);
    }
    if (!$('trash-list').children.length) $('trash-list').textContent = '没有可撤销事务。';
  }
  $('manage-images').onclick = $('refresh-assets').onclick = () => run(images);
  $('manage-backups').onclick = $('refresh-backups').onclick = () => run(backups);
  $('manage-trash').onclick = $('refresh-trash').onclick = () => run(trash);
  $('create-backup').onclick = () =>
    run(async () => {
      await sync();
      const b = await api('backup', { requestId: crypto.randomUUID() });
      await backups();
      tell(`备份已生成并校验，${b.files} 个文件。可点击下载另存。`);
    });
  $('import-backup').onchange = () =>
    run(async () => {
      const file = $('import-backup').files[0];
      if (!file) return;
      if (file.size > 64 * 1024 * 1024) throw Error('备份包不得超过64 MiB');
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const b = await api('backupimport', { base64, requestId: crypto.randomUUID() });
      await backups();
      tell(`导入校验通过，${b.files} 个文件。尚未恢复，请先预览恢复清单。`);
      $('import-backup').value = '';
    });
  $('confirm-plan').onchange = updateApply;
  $('apply-plan').onclick = () =>
    run(async () => {
      if (!pending || !$('confirm-plan').checked) throw Error('请先审查并确认清单。');
      assertClean();
      for (const [key, value] of clearCache)
        if (localStorage.getItem(key) !== value)
          throw Error('浏览器恢复副本已变化，请刷新并重新审查。');
      const result = await api('apply', {
        planId: pending.planId,
        expectedPlan: pending.expectedPlan,
        confirm: true,
        requestId: crypto.randomUUID(),
      });
      for (const [key] of clearCache) localStorage.removeItem(key);
      pending = null;
      clearCache = [];
      $('plan-panel').hidden = true;
      updateApply();
      await afterChange();
      await trash();
      tell(result.notice || '没有需要修改的文件。');
    });
  updateApply();
  return { reviewPlan };
}
