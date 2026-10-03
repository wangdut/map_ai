import { store, PALETTE } from '../highlight/store.js';
import { formatArea, formatDistance, haversine } from '../geom/geo.js';

const short = (s) => (s.length > 5 ? `${s.slice(0, 5)}…` : s);

export function createPanel({ onExpandChange, onToast, onFit }) {
  const panel = document.getElementById('panel');
  const list = document.getElementById('hlList');
  const count = document.getElementById('hlCount');
  const matrix = document.getElementById('matrix');
  const toggle = document.getElementById('panelToggle');

  const head = panel.querySelector('.panel-head');
  const expand = document.createElement('label');
  expand.className = 'expand';
  expand.innerHTML = '<input type="checkbox" /> 展开下级';
  head.insertBefore(expand, toggle);
  expand.querySelector('input').addEventListener('change', (e) => onExpandChange(e.target.checked));

  toggle.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    toggle.textContent = panel.classList.contains('collapsed') ? '+' : '–';
  });

  function renderList(items) {
    count.textContent = String(items.length);
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<li class="empty">还没有高亮区域。在上方搜索框输入地名回车即可。</li>';
      matrix.classList.add('hidden');
      return;
    }
    items.forEach((item) => {
      const li = document.createElement('li');
      const ops = item.centroid
        ? `<div class="ops"><button class="ghost" data-act="fit">定位</button><button class="ghost" data-act="copy">复制</button><button class="ghost" data-act="del">删除</button></div>`
        : `<div class="ops"><button class="ghost" data-act="copy">复制</button><button class="ghost" data-act="del">删除</button></div>`;
      li.innerHTML = `<span class="chip" style="background:${item.color}"></span>
        <span class="meta"><span class="n">${item.name}</span>
        <span class="a">${formatArea(item.area)}${item.perimeter ? ` · 周长 ${formatDistance(item.perimeter)}` : ''}${item.subtitle ? ` · ${item.subtitle}` : ''}</span></span>
        ${ops}`;
      li.addEventListener('mouseenter', () => store.setFocus(item.id));
      li.addEventListener('mouseleave', () => store.setFocus(null));
      li.addEventListener('click', (e) => {
        const act = e.target.dataset?.act;
        if (act === 'del') store.remove(item.id);
        else if (act === 'copy') {
          navigator.clipboard
            ?.writeText(`${item.name}\t${formatArea(item.area)}\t${JSON.stringify(item.geometry)}`)
            .then(() => onToast('已复制名称、面积与 GeoJSON'))
            .catch(() => onToast('复制失败'));
        } else if (e.target.dataset?.act === 'fit') onFit(item.id);
      });
      list.appendChild(li);
    });
    renderMatrix(items);
  }

  function renderMatrix(items) {
    const withCenter = items.filter((i) => i.centroid);
    if (withCenter.length < 2) {
      matrix.classList.add('hidden');
      return;
    }
    matrix.classList.remove('hidden');
    const header = `<tr><th></th>${withCenter.map((i) => `<th>${short(i.name)}</th>`).join('')}</tr>`;
    const rows = withCenter
      .map(
        (a, i) =>
          `<tr><th>${short(a.name)}</th>${withCenter
            .map((b, j) => (i === j ? '<td class="self">-</td>' : `<td>${formatDistance(haversine(a.centroid, b.centroid))}</td>`))
            .join('')}</tr>`,
      )
      .join('');
    matrix.innerHTML = `<h4>质心直线距离（比较两块区域的远近）</h4><table>${header}${rows}</table>`;
  }

  store.subscribe((items) => renderList(items));
  renderList(store.items);
  return { expandInput: expand.querySelector('input'), palette: PALETTE };
}
