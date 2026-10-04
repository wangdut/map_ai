import { loadAdminIndex, searchAdmin, shortName, LEVEL_LABEL } from '../data/admin-index.js';
import { regionOf, childrenOf } from '../data/datav.js';
import { bboxOfGeoJSON } from '../geom/geo.js';
import {
  renderPoster,
  planCapture,
  frameSpan,
  frameRatio,
  fitFrame,
  TAG_ROOM,
  innerLongEdge,
  posterDims,
  FONTS,
  TITLE_SIZE_RATIO,
  SUB_SIZE_RATIO,
} from '../export/tileprint.js';
import { STYLES } from '../export/artstyle.js';
import { esc } from './escape.js';

const SEQ_KEY = 'map_ai.poster_seq';

/** 同一城市反复导出会撞名、被浏览器悄悄追加 (1) 覆盖。按基础名自增编号，编号记在 localStorage 里跨刷新继续 */
function numberedName(base) {
  let seq = {};
  try {
    seq = JSON.parse(localStorage.getItem(SEQ_KEY) || '{}') || {};
  } catch {
    seq = {};
  }
  const n = (Number(seq[base]) || 0) + 1;
  try {
    seq[base] = n;
    localStorage.setItem(SEQ_KEY, JSON.stringify(seq));
  } catch {
    /* 存不下（隐私模式等）就每次都从 01 开始，浏览器自己会加 (1) 兜底 */
  }
  return `${base}_${String(n).padStart(2, '0')}.png`;
}

const RATIOS = [
  ['4:3', 4 / 3],
  ['16:9', 16 / 9],
  ['1:1', 1],
  ['3:4', 3 / 4],
  ['9:16', 9 / 16],
  ['1.414:1', Math.SQRT2],
  ['1:1.414', 1 / Math.SQRT2],
];

/** 档位数值 = 成图（含留白）长边像素。z 只能取整数，抓取被瓦片数或画布面积上限压住时会达不到档位，界面上如实报实际尺寸 */
const QUALITIES = [
  ['网页', 1600],
  ['高清', 3000],
  ['超清', 4500],
  ['巨幅', 6000],
];

const chips = (list, selected) =>
  list
    .map(
      ([label, v]) =>
        `<button class="pc-chip${String(v) === String(selected) ? ' active' : ''}" data-v="${esc(v)}">${esc(label)}</button>`,
    )
    .join('');

const styleChips = (selected) =>
  Object.entries(STYLES)
    .map(
      ([k, s]) =>
        `<button class="pc-chip swatch${k === selected ? ' active' : ''}" data-v="${k}" title="${esc(s.label)}">
          <i style="background:${s.paper};border-color:${s.line}"><b style="background:${s.arterial}"></b></i>${esc(s.label)}</button>`,
    )
    .join('');

const fontOptions = (selected) =>
  Object.entries(FONTS)
    .map(([k, f]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${esc(f.label)}</option>`)
    .join('');

/** 数字输入框里的「占长边百分比」→ 排版要的比例，填了非法值就回落到默认 */
const pctToRatio = (raw, fallback) => {
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 && v <= 40 ? v / 100 : fallback;
};

/** 反方向：比例 → 输入框里显示的百分比，留一位小数 */
const toPct = (ratio) => Math.round(ratio * 1000) / 10;

/**
 * 「导出城市地图艺术海报」。
 * 成图不是屏幕截图：按取景框反推缩放级抓矢量瓦片，逐块分类去字重着色后合成，
 * 所以弹窗、面板、注记都不会混进图里，清晰度也不受屏幕限制。
 */
export function createPosterTool(map, ui) {
  let card = null;
  let overlay = null;
  let city = null;
  let ratio = 4 / 3;
  let target = 3000;
  let style = 'amber';
  let titleFont = 'sans';
  let subFont = 'sans';
  let titleColor = null;
  let subColor = null;
  let busy = false;
  let previewUrl = '';

  const state = () => {
    const num = (sel, fallback) => pctToRatio(card.querySelector(sel).value, fallback);
    return {
      clip: card.querySelector('[data-clip]').checked,
      boundary: card.querySelector('[data-boundary]').checked,
      margin: card.querySelector('[data-margin]').checked,
      title: card.querySelector('[data-title]').value.trim(),
      subtitle: card.querySelector('[data-sub]').value.trim(),
      titleFont,
      subFont,
      titleColor,
      subColor,
      titleRatio: num('[data-tsize]', TITLE_SIZE_RATIO),
      subRatio: num('[data-ssize]', SUB_SIZE_RATIO),
    };
  };

  const marginOn = () => (card ? card.querySelector('[data-margin]').checked : true);

  /** 顶栏和状态栏浮在地图上，框压上去就看不见那两条边了——量出它们占掉的高度 */
  function chrome() {
    const box = map.getContainer().getBoundingClientRect();
    const bar = document.querySelector('.topbar')?.getBoundingClientRect();
    const status = document.querySelector('.statusbar')?.getBoundingClientRect();
    return {
      top: (bar ? Math.max(0, Math.round(bar.bottom - box.top)) : 0) + TAG_ROOM,
      bottom: status ? Math.max(0, Math.round(box.bottom - status.top)) : 0,
    };
  }

  function frameRect() {
    const size = map.getSize();
    return fitFrame(size.x, size.y, frameRatio(ratio, marginOn()), chrome());
  }

  function placeOverlay() {
    if (!overlay) return;
    const f = frameRect();
    Object.assign(overlay.style, { left: `${f.left}px`, top: `${f.top}px`, width: `${f.width}px`, height: `${f.height}px` });
  }

  function updateNote() {
    if (!card) return;
    const f = frameRect();
    const note = card.querySelector('[data-note]');
    if (busy) return;
    try {
      const inner = innerLongEdge(target, marginOn());
      const plan = planCapture(map, f, inner);
      const dims = posterDims(plan, inner, marginOn());
      const span = frameSpan(map, f);
      const label = RATIOS.find(([, v]) => v === ratio)?.[0] || '';
      note.textContent =
        `成图 ${dims.width}×${dims.height} px（${label}）· z${plan.z} · ${plan.count} 块瓦片 · ` +
        `覆盖约 ${span.kmX.toFixed(1)} × ${span.kmY.toFixed(1)} km` +
        (dims.capped ? ' · 已到抓取上限，够不到该档位' : '');
    } catch (e) {
      note.textContent = `取景参数算不出来：${e.message}`;
    }
  }

  /** 取色器永远显示"当前实际会用的颜色"；没显式指定时「自动」按钮没什么可做的，置灰 */
  function syncTypeControls() {
    if (!card) return;
    const ink = (STYLES[style] || STYLES.amber).ink;
    card.querySelector('[data-tcolor]').value = titleColor || ink;
    card.querySelector('[data-scolor]').value = subColor || ink;
    card.querySelector('[data-tauto]').disabled = !titleColor;
    card.querySelector('[data-sauto]').disabled = !subColor;
  }

  function build() {
    card = document.createElement('section');
    card.className = 'poster-card';
    card.innerHTML = `
      <div class="rc-head"><b>城市地图艺术海报</b><button class="ghost" data-x title="关闭">✕</button></div>
      <div class="pc-body">
        <div class="pc-row">
          <span class="k">城市</span>
          <input data-city placeholder="如：广州 / 天河区 / 苏州" autocomplete="off" />
          <button class="ghost" data-pick title="按这个行政区取景并取轮廓">取景</button>
        </div>
        <div class="pc-row"><span class="k">比例</span><div class="pc-chips" data-ratios>${chips(RATIOS, ratio)}</div></div>
        <div class="pc-row"><span class="k">清晰度</span><div class="pc-chips" data-quality>${chips(QUALITIES, target)}</div></div>
        <div class="pc-row"><span class="k">配色</span><div class="pc-chips" data-styles>${styleChips(style)}</div></div>
        <label class="pc-row inline"><input type="checkbox" data-boundary checked /><span>叠行政界线</span></label>
        <label class="pc-row inline"><input type="checkbox" data-clip /><span>按城市轮廓裁切</span></label>
        <label class="pc-row inline"><input type="checkbox" data-margin checked /><span>留白边与细框</span></label>
        <div class="pc-row"><span class="k">标题</span><input data-title placeholder="海报上的大字，留空则不显示" /></div>
        <div class="pc-row type">
          <span class="k"></span>
          <select data-tfont title="标题字体">${fontOptions(titleFont)}</select>
          <input type="number" data-tsize min="1" max="40" step="0.1" value="${toPct(TITLE_SIZE_RATIO)}" title="字号＝成图长边的百分比" /><span class="u">%</span>
          <input type="color" data-tcolor title="标题字色" /><button class="ghost" data-tauto title="用配色方案的墨色">自动</button>
        </div>
        <div class="pc-row"><span class="k">副标题</span><input data-sub placeholder="小字，自动转大写，留空则不显示" /></div>
        <div class="pc-row type">
          <span class="k"></span>
          <select data-sfont title="副标题字体">${fontOptions(subFont)}</select>
          <input type="number" data-ssize min="1" max="40" step="0.1" value="${toPct(SUB_SIZE_RATIO)}" title="字号＝成图长边的百分比" /><span class="u">%</span>
          <input type="color" data-scolor title="副标题字色" /><button class="ghost" data-sauto title="用配色方案的墨色">自动</button>
        </div>
        <div class="pc-note" data-note></div>
        <div class="pc-actions">
          <button class="ghost" data-preview>预览小图</button>
          <button class="btn-primary" data-export>导出 PNG</button>
        </div>
        <div class="pc-bar hidden"><i></i></div>
        <div class="pc-preview hidden"><img alt="海报预览" /></div>
      </div>`;
    document.body.appendChild(card);

    card.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.hasAttribute('data-x')) return close();
      if (btn.dataset.v !== undefined) {
        const group = btn.parentElement;
        group.querySelectorAll('.pc-chip').forEach((b) => b.classList.toggle('active', b === btn));
        if (group.hasAttribute('data-ratios')) ratio = Number(btn.dataset.v);
        if (group.hasAttribute('data-quality')) target = Number(btn.dataset.v);
        if (group.hasAttribute('data-styles')) {
          style = btn.dataset.v;
          syncTypeControls();
        }
        placeOverlay();
        updateNote();
        return;
      }
      if (btn.hasAttribute('data-tauto')) {
        titleColor = null;
        return syncTypeControls();
      }
      if (btn.hasAttribute('data-sauto')) {
        subColor = null;
        return syncTypeControls();
      }
      if (btn.hasAttribute('data-pick')) return pick();
      if (btn.hasAttribute('data-preview')) return run('preview');
      if (btn.hasAttribute('data-export')) return run('export');
    });
    card.addEventListener('change', (e) => {
      const el = e.target;
      if (el.matches('[data-tfont]')) titleFont = el.value;
      if (el.matches('[data-sfont]')) subFont = el.value;
    });
    card.addEventListener('input', (e) => {
      const el = e.target;
      if (el.matches('[data-tcolor]')) {
        titleColor = el.value;
        card.querySelector('[data-tauto]').disabled = false;
      }
      if (el.matches('[data-scolor]')) {
        subColor = el.value;
        card.querySelector('[data-sauto]').disabled = false;
      }
    });
    syncTypeControls();
    card.querySelector('[data-city]').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') pick();
    });
    card.querySelector('[data-margin]').addEventListener('change', () => {
      placeOverlay();
      updateNote();
    });
    return card;
  }

  /** 输入城市名 → 本地行政索引拿 adcode → DataV 拿轮廓 → 把轮廓铺进取景框，标题与副标题一律按新城市重写 */
  async function pick() {
    const q = card.querySelector('[data-city]').value.trim();
    if (!q) return ui.toast('先填一个城市或区县名');
    await loadAdminIndex();
    const hit = searchAdmin(q, 1)[0];
    if (!hit) return ui.toast(`行政区划索引里没有「${q}」`);
    try {
      const { geometry, props } = await regionOf(hit.adcode);
      const c = props.centroid;
      city = { ...hit, geometry, centroid: c ? [c[1], c[0]] : null };
    } catch (e) {
      city = { ...hit, geometry: null };
      ui.toast(`${hit.name}：轮廓取不到（${e.message}），只按名字取景`);
    }
    card.querySelector('[data-title]').value = shortName(hit.name) || hit.name;
    const path = (hit.path || '').split('/').map(shortName).filter(Boolean);
    const c = city.centroid || bboxCenter(city.geometry);
    const coords = c
      ? `${Math.abs(c[0]).toFixed(4)}°${c[0] >= 0 ? 'N' : 'S'} / ${Math.abs(c[1]).toFixed(4)}°${c[1] >= 0 ? 'E' : 'W'} · `
      : '';
    card.querySelector('[data-sub]').value = `${coords}${[...path, '中国'].join(' · ')}`;
    fitCity();
    updateNote();
    ui.toast(`已取景 ${hit.name}（${LEVEL_LABEL[hit.level] || hit.level}），标题与副标题已刷新`);
  }

  function bboxCenter(geometry) {
    const b = bboxOfGeoJSON(geometry);
    return b ? [(b[0][1] + b[1][1]) / 2, (b[0][0] + b[1][0]) / 2] : null;
  }

  /** 让城市正好落进取景框：Leaflet 的 fitBounds 支持按矩形四边留白来算 */
  function fitCity() {
    if (!city?.geometry) return;
    const b = bboxOfGeoJSON(city.geometry);
    if (!b) return;
    const size = map.getSize();
    const f = frameRect();
    map.fitBounds(L.latLngBounds([b[0][1], b[0][0]], [b[1][1], b[1][0]]), {
      paddingTL: [f.left, f.top],
      paddingBR: [size.x - f.left - f.width, size.y - f.top - f.height],
      animate: false,
    });
  }

  async function collectGeometries(s) {
    if (!s.boundary || !city?.adcode) return [];
    const rings = city.geometry ? [city.geometry] : [];
    try {
      const kids = await childrenOf(city.adcode);
      kids.forEach((k) => k.geometry && String(k.props.adcode) !== String(city.adcode) && rings.push(k.geometry));
    } catch {
      /* 拿不到下级就只画本级轮廓 */
    }
    return rings;
  }

  function setBusy(on, text = '') {
    busy = on;
    card.querySelector('[data-preview]').disabled = on;
    card.querySelector('[data-export]').disabled = on;
    card.querySelector('[data-pick]').disabled = on;
    const bar = card.querySelector('.pc-bar');
    bar.classList.toggle('hidden', !on);
    if (!on) updateNote();
    else card.querySelector('.pc-note').textContent = text;
    map.dragging[on ? 'disable' : 'enable']();
    overlay?.classList.toggle('busy', on);
  }

  async function run(mode) {
    if (busy) return;
    const s = state();
    const px = mode === 'preview' ? 900 : target;
    const frame = frameRect();
    const plan = planCapture(map, frame, innerLongEdge(px, marginOn()));
    setBusy(true, '准备中…');
    let lastPaint = 0;
    try {
      const boundaries = await collectGeometries(s);
      const { canvas, dims, failed } = await renderPoster(map, {
        frame,
        target: px,
        style,
        boundaries,
        clip: s.clip && city?.geometry ? [city.geometry] : null,
        margin: s.margin,
        frameLine: s.margin,
        title: s.title,
        subtitle: s.subtitle,
        titleFont: s.titleFont,
        titleRatio: s.titleRatio,
        titleColor: s.titleColor,
        subFont: s.subFont,
        subRatio: s.subRatio,
        subColor: s.subColor,
        onProgress: (done, total) => {
          const now = performance.now();
          if (now - lastPaint < 90 && done < total) return;
          lastPaint = now;
          const pct = Math.round((done / total) * 100);
          card.querySelector('.pc-bar i').style.width = `${pct}%`;
          card.querySelector('.pc-note').textContent = `抓取并艺术化瓦片 ${done}/${total}（z${plan.z}）`;
        },
      });
      if (failed) ui.toast(`有 ${failed} 块瓦片没取到，海报上会是底色`);
      if (mode === 'preview') {
        const box = card.querySelector('.pc-preview');
        const img = box.querySelector('img');
        URL.revokeObjectURL(previewUrl);
        previewUrl = await new Promise((res) => canvas.toBlob((b) => res(URL.createObjectURL(b)), 'image/png'));
        img.src = previewUrl;
        box.classList.remove('hidden');
        setBusy(false);
        return ui.toast(`预览已生成：${canvas.width}×${canvas.height}，导出按所选清晰度重画`);
      }
      setBusy(false);
      const blob = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));
      if (!blob) return ui.toast('导出失败：画布太大，试试低一档清晰度');
      const url = URL.createObjectURL(blob);
      const file = numberedName(`海报_${s.title || (city ? shortName(city.name) : '') || '城市'}_${canvas.width}x${canvas.height}`);
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      const q = QUALITIES.find(([, v]) => v === target)?.[0] || '';
      ui.toast(
        `已导出 ${file}（${canvas.width}×${canvas.height}，z${plan.z}，${plan.count} 块瓦片）` +
          (dims.capped ? ` · ${q}档已到抓取上限，按原生像素出图` : ''),
      );
    } catch (e) {
      setBusy(false);
      ui.toast(`导出失败：${e.message || e}`);
    }
  }

  function open() {
    if (card) return;
    build();
    document.body.classList.add('poster-open');
    overlay = document.createElement('div');
    overlay.className = 'poster-frame';
    overlay.innerHTML = '<span class="pf-tag">海报取景框</span>';
    map.getContainer().appendChild(overlay);
    placeOverlay();
    map.on('move', onMapView).on('zoom', onMapView);
    window.addEventListener('resize', onResize);

    const q = document.getElementById('q')?.value.trim();
    if (q) card.querySelector('[data-city]').value = q;
    updateNote();
  }

  function onMapView() {
    if (!busy) updateNote();
  }

  function onResize() {
    placeOverlay();
    updateNote();
  }

  function close() {
    document.body.classList.remove('poster-open');
    map.off('move', onMapView).off('zoom', onMapView);
    window.removeEventListener('resize', onResize);
    overlay?.remove();
    overlay = null;
    card?.remove();
    card = null;
    busy = false;
    URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    map.dragging?.enable();
  }

  return {
    open,
    close,
    get isOpen() {
      return Boolean(card);
    },
  };
}
