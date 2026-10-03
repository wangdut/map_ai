import { esc } from './escape.js';

/**
 * 顶栏的「功能」入口：新增能力都往这里挂一条，不再往界面上加控件。
 * items: [{ id, label, hint?, run }]
 */
export function createFeatureMenu(items) {
  const btn = document.getElementById('featureBtn');
  const menu = document.getElementById('featureMenu');

  function render() {
    menu.innerHTML = items
      .map(
        (x, i) =>
          `<button data-i="${i}" title="${esc(x.hint || '')}"><span>${esc(x.label)}</span>${
            x.hint ? `<em>${esc(x.hint)}</em>` : ''
          }</button>`,
      )
      .join('');
  }

  function close() {
    menu.classList.add('hidden');
    btn.classList.remove('active');
  }

  function open() {
    render();
    menu.classList.remove('hidden');
    btn.classList.add('active');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('hidden')) open();
    else close();
  });

  menu.addEventListener('click', (e) => {
    const hit = e.target.closest('button[data-i]');
    if (!hit) return;
    const item = items[Number(hit.dataset.i)];
    close();
    item?.run?.();
  });

  document.addEventListener('pointerdown', (e) => {
    if (!menu.contains(e.target) && e.target !== btn) close();
  });

  render();

  return {
    open,
    close,
    get isOpen() {
      return !menu.classList.contains('hidden');
    },
  };
}
