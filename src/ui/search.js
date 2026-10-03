import { searchAdmin, loadAdminIndex } from '../data/admin-index.js';
import { regionOf } from '../data/datav.js';
import { amapReady, searchPOI, poiOutlineFallback } from '../data/amap.js';
import { descendantsOf, granularityOptions, streetPointsOf, GRAN_DEPTH, LEVEL_SHORT } from '../data/admin-tree.js';
import { searchWithNominatim } from '../data/osm.js';
import { store } from '../highlight/store.js';
import { circleGeometry, radiusFromArea, formatArea } from '../geom/geo.js';
import { esc } from './escape.js';

export const NO_KEY_HINT =
  '未配置高德 key：可高亮行政区（国/省/市/区县）；兴趣点请切卫星图后用「绘制区域」描边';

export function createSearch({ renderer, ui, state }) {
  const input = document.getElementById('q');
  const box = document.getElementById('results');
  const go = document.getElementById('goBtn');
  let timer = null;
  let lastRows = [];

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search')) hide();
  });

  function hide() {
    box.classList.add('hidden');
  }

  function render(rows) {
    box.innerHTML = rows
      .map(
        (r, i) =>
          r.kind === 'error'
            ? `<div class="note">${esc(r.name)}</div>`
            : `<div class="item" data-i="${i}"><span class="t"><span class="tag ${r.kind === 'admin' ? '' : r.geometry ? 'poi' : 'draw'}">${esc(r.tag)}</span>${esc(r.name)}</span><span class="s">${esc(r.sub || '')}</span></div>`,
      )
      .join('');
    box.querySelectorAll('.item').forEach((el) =>
      el.addEventListener('click', () => select(rows[Number(el.dataset.i)])),
    );
    box.classList.remove('hidden');
  }

  async function collectRows(q) {
    await loadAdminIndex();
    const rows = [];
    searchAdmin(q, 7).forEach((a) => rows.push({ ...a, tag: `行政区·${a.levelLabel}`, sub: a.path }));
    if (amapReady()) {
      try {
        (await searchPOI(q, { limit: 6 })).forEach((p) =>
          rows.push({ ...p, tag: `兴趣点${p.geometry ? '·有轮廓' : ''}`, sub: p.address }),
        );
      } catch (e) {
        rows.push({ kind: 'error', name: `高德搜索：${e.message}` });
      }
    }
    if (state.osm?.nominatim) {
      try {
        (await searchWithNominatim(q, 5)).forEach((o) =>
          rows.push({ ...o, tag: o.geometry ? 'OSM·有轮廓' : 'OSM·仅定位', sub: o.address }),
        );
      } catch {
        /* 探测通过但查询失败时跳过该源 */
      }
    }
    return rows;
  }

  /** 上一次批量高亮写入的区域 id，换粒度时用来精确替换同一范围 */
  let scopeRow = null;
  let scopeIds = new Set();

  /** 下拉里选的粒度未必适用于当前级别：能适用就用，否则退到不超过它的最深一级 */
  function granularityFor(row) {
    const allowed = granularityOptions(row.level).filter((o) => !o.disabled).map((o) => o.value);
    if (allowed.includes(state.granularity)) return state.granularity;
    const wanted = GRAN_DEPTH[state.granularity] ?? 0;
    return allowed.filter((v) => GRAN_DEPTH[v] <= wanted).sort((a, b) => GRAN_DEPTH[b] - GRAN_DEPTH[a])[0] || 'self';
  }

  const granularityLabel = (row, value) =>
    granularityOptions(row.level).find((o) => o.value === value)?.label || '仅本级';

  /** 写入新一批区域。同一范围换粒度时把上一批多余的清掉，不同范围之间互不干扰 */
  function replaceScope(reapply, ids, write) {
    const result = store.transaction(() => {
      if (reapply) [...scopeIds].forEach((id) => !ids.has(id) && store.remove(id));
      return write();
    }, 'add');
    scopeIds = ids;
    return result;
  }

  async function highlightSelf(r, reapply) {
    const { geometry, props } = await regionOf(r.adcode);
    const item = replaceScope(reapply, new Set([`admin:${r.adcode}`]), () =>
      store.add({
        id: `admin:${r.adcode}`,
        name: r.name,
        subtitle: `${r.levelLabel} · ${r.path}`,
        source: 'admin',
        geometry,
        centroid: props.centroid ? [props.centroid[1], props.centroid[0]] : undefined,
        meta: { adcode: r.adcode, level: r.level },
      }),
    );
    renderer.fitItem(item.id);
    ui.toast(`${r.name}：${formatArea(item.area)}`);
    return item;
  }

  /**
   * 高亮一个行政区。
   * opts.exact：右键菜单用——菜单上写的是哪一级就只画哪一级，不套用面板的批量粒度。
   */
  async function highlightAdmin(r, opts = {}) {
    const reapply = Boolean(scopeRow && scopeRow.adcode === r.adcode);
    scopeRow = r;
    const value = opts.exact ? 'self' : granularityFor(r);
    const depth = GRAN_DEPTH[value];
    if (!depth) {
      await highlightSelf(r, reapply);
      ui.setAdminScope(r, {
        value,
        note:
          opts.exact || value === state.granularity
            ? ''
            : `${r.name} 是${LEVEL_SHORT[r.level] || r.level}，按「${granularityLabel(r, value)}」高亮`,
      });
      return;
    }

    let kids;
    try {
      kids = await descendantsOf(r, depth);
    } catch (e) {
      await highlightSelf(r, reapply);
      ui.setAdminScope(r, { value: 'self' });
      ui.toast(`批量高亮失败：${e.message}。已改为只高亮 ${r.name}`);
      return;
    }

    const partials = [];
    // 父级先入集合，子区后入 → 子区画在上面，右键命中也优先落到具体的子区
    if (state.showParent) {
      const { geometry, props } = await regionOf(r.adcode);
      partials.push({
        id: `admin:${r.adcode}`,
        name: r.name,
        subtitle: `父级轮廓 · ${r.levelLabel}`,
        source: 'admin',
        geometry,
        centroid: props.centroid ? [props.centroid[1], props.centroid[0]] : undefined,
        meta: { adcode: r.adcode, level: r.level, isScopeParent: true },
      });
    }
    partials.push(
      ...kids.map((k) => ({
        id: `admin:${k.adcode}`,
        name: k.name,
        subtitle: `${r.name}的${LEVEL_SHORT[k.targetLevel] || '下级'}`,
        source: 'admin',
        geometry: k.geometry,
        centroid: k.centroid || undefined,
        meta: { adcode: k.adcode, level: k.level, parentAdcode: k.parentAdcode },
      })),
    );

    const added = replaceScope(reapply, new Set(partials.map((p) => p.id)), () => partials.map((p) => store.add(p)));
    renderer.fitAll();
    const target = LEVEL_SHORT[kids[0].targetLevel] || '下级行政区';
    const clamped =
      value === state.granularity ? '' : `${r.name} 是${LEVEL_SHORT[r.level] || r.level}，最深只到「${granularityLabel(r, value)}」；`;
    ui.setAdminScope(r, { value, note: clamped + (state.showParent ? '父级轮廓叠在最下面，子区各上一色' : '未叠加父级轮廓') });
    ui.toast(
      `已高亮 ${r.name} 的 ${added.length - (state.showParent ? 1 : 0)} 个${target}${state.showParent ? '（含父级轮廓）' : ''}，每块一色便于区分`,
    );
  }

  /** 面板改了粒度/父级开关后，对当前范围重新执行一次 */
  function applyScope() {
    if (!scopeRow) {
      const label = granularityOptions(null).find((o) => o.value === state.granularity)?.label || '仅本级';
      return ui.toast(`已设粒度为「${label}」：接下来高亮的行政区按此生效`);
    }
    return highlightAdmin(scopeRow).catch((e) => ui.toast(`重新高亮失败：${e.message}`));
  }

  async function listStreetPoints() {
    if (!scopeRow) return ui.toast('请先高亮一个区县级区域，再列出它的街道/镇');
    try {
      const pts = await streetPointsOf(scopeRow);
      ui.addStreetPoints(pts);
      ui.toast(`已标出 ${scopeRow.name} 的 ${pts.length} 个乡镇/街道中心点（这一级拿不到轮廓，只能给点）`);
    } catch (e) {
      ui.toast(`街道列表获取失败：${e.message}`);
    }
  }

  async function select(r) {
    hide();
    if (!r || r.kind === 'error') return;
    try {
      if (r.kind === 'admin') return await highlightAdmin(r);

      if (r.geometry) {
        const item = store.add({
          id: r.id,
          name: r.name,
          subtitle: r.tag || '兴趣点轮廓',
          source: r.source,
          geometry: r.geometry,
          meta: { adcode: r.adcode },
        });
        renderer.fitItem(item.id);
        ui.toast(`${r.name}：${formatArea(item.area)}`);
        return;
      }

      if (r.latlng) ui.addPointMarker(r.latlng, r.name);
      const fallback = await poiOutlineFallback(r);
      if (fallback.aoiArea) {
        const parts = fallback.aoiNames.length;
        const item = store.add({
          id: `aoi:${r.id}`,
          name: `${r.name}（等面积示意）`,
          subtitle: '面积来自高德 AOI，形状为等面积圆、非真实轮廓',
          source: 'aoi',
          geometry: circleGeometry(r.latlng, radiusFromArea(fallback.aoiArea)),
          area: fallback.aoiArea,
        });
        renderer.fitItem(item.id);
        ui.toast(
          `${r.name}：高德只给出面积 ${formatArea(fallback.aoiArea)}${parts > 1 ? `（${parts} 个同主体分区合计）` : ''}，已画等面积圆；真实轮廓请用「绘制区域」描边`,
        );
      } else {
        ui.explainNoOutline({ name: r.name, latlng: r.latlng });
      }
    } catch (e) {
      ui.toast(`高亮失败：${e.message}`);
    }
  }

  /** 回车：优先用已展开的下拉首条，否则查询后自动选最合适的一条（精确行政区名 > 有轮廓的结果） */
  async function submit() {
    const q = input.value.trim();
    if (!q) return;
    const shown = box.querySelector('.item');
    if (shown && !box.classList.contains('hidden')) return select(lastRows[Number(shown.dataset.i)]);
    const rows = await collectRows(q);
    if (!rows.length) {
      ui.toast(amapReady() ? `没有匹配结果：${q}` : `没有匹配的行政区：${q}。${NO_KEY_HINT}`);
      return;
    }
    const exact = rows.find((r) => r.kind === 'admin' && (r.name === q || r.path.split('/').pop() === q));
    const withShape = rows.find((r) => r.geometry);
    return select(exact || withShape || rows[0]);
  }

  async function suggest() {
    const q = input.value.trim();
    if (!q) return hide();
    const rows = await collectRows(q);
    lastRows = rows.length
      ? rows
      : [{ kind: 'error', name: amapReady() ? '没有匹配结果，换个关键词试试' : `没有匹配的行政区。${NO_KEY_HINT}` }];
    render(lastRows);
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(suggest, 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') hide();
  });
  go.addEventListener('click', submit);

  return { submit, select, input, suggest, highlightAdmin, applyScope, listStreetPoints };
}
