import { searchAdmin, loadAdminIndex } from '../data/admin-index.js';
import { regionOf, childrenOf } from '../data/datav.js';
import { amapReady, searchPOI, poiOutlineFallback } from '../data/amap.js';
import { searchWithNominatim } from '../data/osm.js';
import { store } from '../highlight/store.js';
import { circleGeometry, radiusFromArea, formatArea } from '../geom/geo.js';

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
            ? `<div class="note">${r.name}</div>`
            : `<div class="item" data-i="${i}"><span class="t"><span class="tag ${r.kind === 'admin' ? '' : r.geometry ? 'poi' : 'draw'}">${r.tag}</span>${r.name}</span><span class="s">${r.sub || ''}</span></div>`,
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

  async function highlightAdmin(r) {
    if (state.expandChildren && r.level !== 'district' && r.level !== 'country') {
      const kids = await childrenOf(r.adcode);
      if (!kids.length) throw new Error('该区域没有下级分区数据');
      const added = store.addMany(
        kids.map((k) => ({
          id: `admin:${k.props.adcode}`,
          name: k.props.name,
          subtitle: `${r.name}的下级`,
          source: 'admin',
          geometry: k.geometry,
          centroid: k.props.centroid ? [k.props.centroid[1], k.props.centroid[0]] : undefined,
          meta: { adcode: k.props.adcode, level: k.props.level },
        })),
      );
      added.forEach((item, i) => i === added.length - 1 && renderer.fitItem(item.id));
      ui.toast(`已按 ${r.name} 的下级分区高亮 ${added.length} 块，每块一色便于比较`);
      return;
    }
    const { geometry, props } = await regionOf(r.adcode);
    const item = store.add({
      id: `admin:${r.adcode}`,
      name: r.name,
      subtitle: `${r.levelLabel} · ${r.path}`,
      source: 'admin',
      geometry,
      centroid: props.centroid ? [props.centroid[1], props.centroid[0]] : undefined,
      meta: { adcode: r.adcode, level: r.level },
    });
    renderer.fitItem(item.id);
    ui.toast(`${r.name}：${formatArea(item.area)}`);
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

  return { submit, select, input, suggest, highlightAdmin };
}
