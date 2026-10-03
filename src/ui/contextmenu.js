export function createContextMenu(map) {
  const el = document.getElementById('ctxMenu');

  function close() {
    el.classList.add('hidden');
    el.innerHTML = '';
  }

  /** 菜单高度会随二级展开变化，每次展开都要重新夹紧到容器内 */
  function position(e) {
    const box = map.getContainer().getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(e.containerPoint.x, box.width - el.offsetWidth - 6))}px`;
    el.style.top = `${Math.max(4, Math.min(e.containerPoint.y, box.height - el.offsetHeight - 6))}px`;
  }

  const subHtml = (kids) =>
    kids
      .map(
        (c, j) =>
          `<button data-j="${j}" class="${c.disabled ? 'disabled' : ''}">${c.label}${c.hint ? `<em>${c.hint}</em>` : ''}</button>`,
      )
      .join('');

  /**
   * @param e Leaflet contextmenu 事件（用 containerPoint 定位）
   * @param title 菜单标题（命中区域时为区域名+面积）
   * @param entries [{ label, danger?, run?, children? }]
   *   children 可以是数组，也可以是返回数组的异步函数——首次展开时才求值，
   *   这样右键菜单不会被一次网络反查卡住。
   */
  function open(e, title, entries) {
    el.innerHTML =
      (title ? `<div class="ctx-title">${title}</div>` : '') +
      entries
        .map((x, i) => {
          const hasSub = x.children && (Array.isArray(x.children) ? x.children.length : true);
          const pre = Array.isArray(x.children) ? `<div class="ctx-sub">${subHtml(x.children)}</div>` : '';
          return `<div class="ctx-row${hasSub ? ' has-sub' : ''}" data-i="${i}">
            <button data-i="${i}" class="${x.danger ? 'danger' : ''}">${x.label}${hasSub ? '<span class="ctx-caret">›</span>' : ''}</button>
            ${pre}
          </div>`;
        })
        .join('');
    el.classList.remove('hidden');
    position(e);

    el.querySelectorAll('.ctx-row > button').forEach((b) => {
      b.addEventListener('click', async () => {
        const i = Number(b.dataset.i);
        const entry = entries[i];
        const row = b.parentElement;
        if (!entry.children) {
          close();
          return entry.run?.();
        }
        if (row.classList.contains('open')) {
          row.classList.remove('open');
          return;
        }
        let sub = row.querySelector('.ctx-sub');
        if (!sub) {
          sub = document.createElement('div');
          sub.className = 'ctx-sub';
          sub.innerHTML = '<button class="disabled">加载中…</button>';
          row.appendChild(sub);
        }
        // 必须先展开再定位：.ctx-sub 未 open 时是 display:none，不计入 offsetHeight
        row.classList.add('open');
        position(e);
        if (typeof entry.children === 'function' && !row.dataset.loaded) {
          row.dataset.loaded = '1';
          try {
            const kids = await entry.children();
            sub.innerHTML = kids.length ? subHtml(kids) : '<button class="disabled">没有可选项</button>';
            bindChildren(sub, kids, () => close());
          } catch (err) {
            row.dataset.loaded = '';
            sub.innerHTML = `<button class="disabled">${err.message || '加载失败'}</button>`;
          }
          position(e);
        }
      });
    });

    el.querySelectorAll('.ctx-row > .ctx-sub').forEach((sub) => {
      const i = Number(sub.parentElement.dataset.i);
      if (Array.isArray(entries[i]?.children)) bindChildren(sub, entries[i].children, () => close());
    });
  }

  function bindChildren(sub, kids, after) {
    sub.querySelectorAll('button').forEach((cb) =>
      cb.addEventListener('click', () => {
        const entry = kids[Number(cb.dataset.j)];
        if (!entry || entry.disabled) return;
        after();
        entry.run?.();
      }),
    );
  }

  map.on('click zoomstart movestart dragstart', close);
  document.addEventListener('pointerdown', (ev) => {
    if (!el.contains(ev.target)) close();
  });
  map.on('contextmenu', close);

  return {
    open,
    close,
    get isOpen() {
      return !el.classList.contains('hidden');
    },
  };
}
