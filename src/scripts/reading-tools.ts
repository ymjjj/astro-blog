/** 渐进增强：原始图片、代码、锚点在没有 JavaScript 时仍能阅读。 */
function setupImageViewer() {
  const dialog = document.querySelector<HTMLDialogElement>('#image-viewer');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const stage = dialog.querySelector<HTMLDivElement>('.image-viewer-stage')!;
  const caption = dialog.querySelector<HTMLParagraphElement>('#image-viewer-caption')!;
  const close = dialog.querySelector<HTMLButtonElement>('.viewer-close')!;
  let trigger: HTMLButtonElement | undefined;
  close.addEventListener('click', () => dialog.close());
  // 当前弹层只有关闭按钮可交互，Tab / Shift+Tab 保持在弹层中，Escape 仍由 dialog 处理。
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      close.focus();
    }
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('image-viewer-open');
    stage.replaceChildren();
    trigger?.focus({ preventScroll: true });
  });
  document.querySelectorAll<HTMLImageElement>('.prose img').forEach((image) => {
    // 图片本来是链接时保留链接的语义，不嵌套按钮或劫持导航。
    if (image.closest('a, button')) return;
    const target = image.closest('picture') || image;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'image-zoom';
    button.setAttribute('aria-label', `放大图片：${image.alt || '正文配图'}`);
    button.setAttribute('aria-haspopup', 'dialog');
    target.replaceWith(button);
    button.append(target);
    button.addEventListener('click', () => {
      trigger = button;
      const enlarged = new Image();
      enlarged.alt = image.alt;
      enlarged.src = image.currentSrc || image.src;
      stage.replaceChildren(enlarged);
      caption.textContent = image.alt || '正文配图';
      dialog.showModal();
      document.documentElement.classList.add('image-viewer-open');
      close.focus();
    });
  });
}

function setupCodeCopy() {
  const status = document.querySelector<HTMLElement>('#copy-status')!;
  document.querySelectorAll<HTMLPreElement>('.prose pre').forEach((pre, index) => {
    const code = pre.querySelector('code');
    if (!code) return;
    const block = document.createElement('div');
    block.className = 'code-block';
    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';
    const label = document.createElement('span');
    label.textContent = '代码';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-code';
    button.textContent = '复制代码';
    button.setAttribute('aria-label', `复制第 ${index + 1} 段代码`);
    toolbar.append(label, button);
    pre.replaceWith(block);
    block.append(toolbar, pre);
    let timer: ReturnType<typeof setTimeout>;
    button.addEventListener('click', async () => {
      clearTimeout(timer);
      button.disabled = true;
      status.textContent = '';
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(code.textContent || '');
        button.textContent = '已复制';
        button.dataset.state = 'success';
        status.textContent = `第 ${index + 1} 段代码已复制。`;
      } catch {
        // 不伪报成功；选中原文让用户使用系统复制快捷键。
        pre.tabIndex = -1;
        pre.focus({ preventScroll: true });
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        button.textContent = '请手动复制';
        button.dataset.state = 'error';
        status.textContent = `第 ${index + 1} 段代码未能自动复制，已选中原文，请使用系统复制操作。`;
      } finally {
        button.disabled = false;
        timer = setTimeout(() => {
          button.textContent = '复制代码';
          delete button.dataset.state;
        }, 3500);
      }
    });
  });
}

function setupActiveHeading() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.toc a[href^="#"]')];
  const sections = links
    .map((link) => ({
      link,
      heading: document.getElementById(decodeURIComponent(link.hash.slice(1))),
    }))
    .filter((entry) => entry.heading !== null);
  if (!sections.length) return;
  let scheduled = false;
  function update() {
    scheduled = false;
    let current = sections[0];
    // 与页面 scroll-padding-top 留出的阅读边距一致，并留少量容差。
    for (const section of sections)
      if (section.heading!.getBoundingClientRect().top <= 130) current = section;
    const bottom = document.documentElement.scrollHeight - innerHeight;
    if (bottom > 0 && scrollY >= bottom - 2) current = sections[sections.length - 1];
    for (const { link } of sections) {
      if (link === current.link) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }
  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(update);
    }
  }
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  addEventListener('hashchange', schedule);
  addEventListener('pageshow', schedule);
  addEventListener('load', schedule);
  const article = document.querySelector('.article-main');
  if (article && 'ResizeObserver' in window) new ResizeObserver(schedule).observe(article);
  update();
}

setupImageViewer();
setupCodeCopy();
setupActiveHeading();
