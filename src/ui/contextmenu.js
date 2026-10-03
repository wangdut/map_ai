export function createContextMenu(map) {
  const el = document.getElementById('ctxMenu');

  function close() {
    el.classList.add('hidden');
  }

  /**
   * @param e Leaflet contextmenu 事件（用 containerPoint 定位）
   * @param title 菜单标题（命中区域时为区域名+面积）
   * @param entries [{ label, danger?, run }]
   */
  function open(e, title, entries) {
    el.innerHTML =
      (title ? `<div class="ctx-title">${title}</div>` : '') +
      entries.map((x, i) => `<button data-i="${i}" class="${x.danger ? 'danger' : ''}">${x.label}</button>`).join('');
    el.classList.remove('hidden');
    const box = map.getContainer().getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(e.containerPoint.x, box.width - el.offsetWidth - 6))}px`;
    el.style.top = `${Math.max(4, Math.min(e.containerPoint.y, box.height - el.offsetHeight - 6))}px`;
    el.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        close();
        entries[Number(b.dataset.i)].run?.();
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
