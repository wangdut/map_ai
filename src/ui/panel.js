import { store, PALETTE } from '../highlight/store.js';
import { formatArea, formatDistance, haversine } from '../geom/geo.js';
import { granularityOptions, LEVEL_SHORT, NO_OUTLINE } from '../data/admin-tree.js';
import { amapReady } from '../data/amap.js';
import { esc } from './escape.js';

const short = (s) => (s.length > 5 ? `${s.slice(0, 5)}…` : s);
/** 距离矩阵是 n² 单元格，批量高亮上百块时只会糊屏，超过这个数就不生成 */
const MATRIX_LIMIT = 12;

export function createPanel({ onGranularityChange, onShowParentChange, onListStreets, onToast, onFit }) {
  const panel = document.getElementById('panel');
  const list = document.getElementById('hlList');
  const count = document.getElementById('hlCount');
  const matrix = document.getElementById('matrix');
  const toggle = document.getElementById('panelToggle');
  const body = panel.querySelector('.panel-body');

  const gran = document.createElement('div');
  gran.className = 'gran';
  gran.innerHTML = `
    <label class="gran-row"><span class="k">粒度</span><select class="gran-select" title="按行政层级批量高亮子行政区"></select></label>
    <label class="gran-row check"><input type="checkbox" checked /><span>叠显父级轮廓（跨级搭配）</span></label>
    <div class="gran-scope"></div>
    <button class="ghost gran-street hidden"></button>`;
  body.insertBefore(gran, body.firstChild);

  const sel = gran.querySelector('.gran-select');
  const parentChk = gran.querySelector('.gran-row.check input');
  const scopeLine = gran.querySelector('.gran-scope');
  const streetBtn = gran.querySelector('.gran-street');

  sel.innerHTML = granularityOptions(null)
    .map((o) => `<option value="${o.value}">${esc(o.label)}</option>`)
    .join('');
  sel.value = 'self';
  sel.addEventListener('change', () => onGranularityChange(sel.value));
  parentChk.addEventListener('change', () => onShowParentChange(parentChk.checked));
  streetBtn.addEventListener('click', () => onListStreets());

  /** 高亮某个行政区后刷新粒度下拉：选项随级别变化，街道级永远置灰 */
  function setScope(row, { value = 'self', note = '' } = {}) {
    sel.innerHTML = granularityOptions(row.level)
      .map(
        (o) =>
          `<option value="${o.value}"${o.disabled ? ' disabled' : ''}${o.hint ? ` title="${esc(o.hint)}"` : ''}>${esc(o.label)}</option>`,
      )
      .join('');
    sel.value = value;
    scopeLine.innerHTML =
      `<b>${esc(row.name)}</b>（${LEVEL_SHORT[row.level] || row.level}）已按此粒度高亮` +
      (note ? `<br />${esc(note)}` : '') +
      (granularityOptions(row.level).some((o) => o.disabled) ? `<br /><em>${esc(NO_OUTLINE)}</em>` : '');
    const canListStreets = row.level === 'district' && amapReady();
    streetBtn.classList.toggle('hidden', !canListStreets);
    if (canListStreets) streetBtn.textContent = `街道画不了面：列出 ${row.name} 的街道/镇中心点`;
  }

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
      li.innerHTML = `<span class="chip" style="background:${esc(item.color)}"></span>
        <span class="meta"><span class="n">${esc(item.name)}</span>
        <span class="a">${formatArea(item.area)}${item.perimeter ? ` · 周长 ${formatDistance(item.perimeter)}` : ''}${item.subtitle ? ` · ${esc(item.subtitle)}` : ''}</span></span>
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
    if (withCenter.length > MATRIX_LIMIT) {
      matrix.innerHTML = `<h4>质心直线距离</h4><p class="note">当前 ${withCenter.length} 块区域，两两组合超过 ${MATRIX_LIMIT * MATRIX_LIMIT} 格不便查看；减少高亮区域数量到 ${MATRIX_LIMIT} 块以内即可自动生成距离矩阵。</p>`;
      return;
    }
    const header = `<tr><th></th>${withCenter.map((i) => `<th>${esc(short(i.name))}</th>`).join('')}</tr>`;
    const rows = withCenter
      .map(
        (a, i) =>
          `<tr><th>${esc(short(a.name))}</th>${withCenter
            .map((b, j) => (i === j ? '<td class="self">-</td>' : `<td>${formatDistance(haversine(a.centroid, b.centroid))}</td>`))
            .join('')}</tr>`,
      )
      .join('');
    matrix.innerHTML = `<h4>质心直线距离（比较两块区域的远近）</h4><table>${header}${rows}</table>`;
  }

  store.subscribe((items) => renderList(items));
  renderList(store.items);
  return { setScope, palette: PALETTE };
}
