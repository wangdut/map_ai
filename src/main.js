import { loadConfig, appConfig } from './config.js';
import { createBasemaps } from './layers/basemaps.js';
import { store } from './highlight/store.js';
import { createRenderer } from './highlight/render.js';
import { createPanel } from './ui/panel.js';
import { createSearch, NO_KEY_HINT } from './ui/search.js';
import { createContextMenu } from './ui/contextmenu.js';
import { createDrawTool } from './ui/draw.js';
import { createMeasureTool } from './ui/measure.js';
import { createRouteTool } from './ui/route.js';
import { createSettings } from './ui/settings.js';
import { probeOsm } from './data/osm.js';
import { amapReady, regeo } from './data/amap.js';
import { findAdmin, searchAdmin, loadAdminIndex, LEVEL_LABEL } from './data/admin-index.js';
import { formatArea } from './geom/geo.js';

const state = { expandChildren: false, osm: { nominatim: false, photon: false, osrm: false }, activeTool: null };

const toastEl = document.getElementById('toast');
const tipEl = document.getElementById('tip');
const coordsEl = document.getElementById('coords');
const zoomEl = document.getElementById('zoom');
const srcFlagEl = document.getElementById('srcFlag');
let toastTimer = null;

function toast(msg, ms = 3600) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), ms);
}

function setTip(msg) {
  tipEl.textContent = msg || '';
}

const map = L.map('map', {
  center: [23.13, 113.35],
  zoom: 11,
  minZoom: 3,
  maxZoom: 19,
  preferCanvas: true,
  zoomControl: false,
});
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 160 }).addTo(map);
window.map = map;

const renderer = createRenderer(map, store);
const pointMarkers = [];

function addPointMarker(latlng, name) {
  const marker = L.circleMarker(latlng, {
    radius: 6,
    color: '#e53935',
    weight: 2,
    fillColor: '#fff',
    fillOpacity: 0.95,
  }).addTo(map);
  marker.bindTooltip(name, { permanent: true, direction: 'top', offset: [0, -8], className: 'hl-label' }).openTooltip();
  pointMarkers.push(marker);
  map.panTo(latlng);
  return marker;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let dialogEl = null;
function closeDialog() {
  dialogEl?.remove();
  dialogEl = null;
}

/**
 * 通用说明弹窗。html 由本仓库自己拼接（其中的外部数据需调用方先 esc()）。
 * buttons: [{ label, run?, primary? }]
 */
function dialog({ title, html, buttons = [] }) {
  closeDialog();
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <div class="dlg-head"><b>${esc(title)}</b><button class="ghost" data-x title="关闭">✕</button></div>
    <div class="dlg-body">${html || ''}</div>
    ${
      buttons.length
        ? `<div class="dlg-actions">${buttons
            .map((b, i) => `<button class="${b.primary ? 'btn-primary' : 'ghost'}" data-b="${i}">${esc(b.label)}</button>`)
            .join('')}</div>`
        : ''
    }
  </div>`;
  document.body.appendChild(mask);
  dialogEl = mask;
  mask.addEventListener('click', (e) => {
    const hit = e.target.closest('button');
    if (!hit) return e.target === mask ? closeDialog() : undefined;
    if (hit.hasAttribute('data-x')) return closeDialog();
    if (hit.dataset.b === undefined) return;
    const b = buttons[Number(hit.dataset.b)];
    closeDialog();
    b?.run?.();
  });
  return mask;
}

/** 数据源给不出轮廓时的统一说明口径（搜索到的 POI 与右键的街道级都走这里） */
function explainNoOutline({ name, latlng, extra = '', actions = [] }) {
  if (!latlng) return toast(`${name}：连中心点都拿不到`);
  dialog({
    title: `「${name}」拿不到真实轮廓`,
    html: `<p>已用你的 key 实测：高德开放平台对个人认证 key 的
      <code>place/text</code>、<code>place/detail</code>（v3 与 v5）、<code>place/around</code>
      都<b>不返回轮廓字段</b>；<code>config/district</code> 能识别乡镇街道但边界串为空。</p>
      <p>另外阿里云 DataV 最细只到区县级，本机也连不上含中国数据的 OSM 边界服务，所以这一级只能定位到点。</p>
      ${extra ? `<p>${extra}</p>` : ''}
      <p>想要真实范围：切到<b>卫星</b>底图后用「绘制区域」沿边界描点，面积与周长会自动算出来。</p>`,
    buttons: [
      ...actions,
      { label: '只标记中心点', run: () => addPointMarker(latlng, name) },
      {
        label: '沿卫星影像描边',
        primary: true,
        run: () => {
          map.panTo(latlng);
          if (map.getZoom() < 16) map.setZoom(16);
          setTool('draw');
          toast('已进入绘制模式：左键逐点描边，右键或回车闭合');
        },
      },
    ],
  });
}

const ui = { toast, setTip, askName: (title, def) => window.prompt(title, def), addPointMarker, dialog, esc, explainNoOutline };

const basemaps = createBasemaps(map);
const search = createSearch({ renderer, ui, state });
const ctx = createContextMenu(map);
const route = createRouteTool(map, ui, state);
const draw = createDrawTool(map, ui, { onCreated: (item) => renderer.fitItem(item.id) });
const measure = createMeasureTool(map, ui);

const settings = createSettings({ ui, onChange: updateSourceFlag });

createPanel({
  onExpandChange: (v) => {
    state.expandChildren = v;
    toast(v ? '已开启「展开下级」：搜索省/市会把它的所有子分区各上一色' : '已关闭「展开下级」');
  },
  onToast: toast,
  onFit: (id) => renderer.fitItem(id),
});

const tools = { draw, measure, route };

function setTool(name) {
  if (state.activeTool === name) name = null;
  if (state.activeTool) tools[state.activeTool].deactivate();
  state.activeTool = name;
  document.querySelectorAll('#tools .tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === name));
  if (name) tools[name].activate();
}

document.getElementById('tools').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tool]');
  if (btn) setTool(btn.dataset.tool);
});

document.getElementById('fitAll').addEventListener('click', () => {
  if (!store.items.length) return toast('还没有高亮区域');
  renderer.fitAll();
});

document.getElementById('clearAll').addEventListener('click', () => {
  store.clear();
  store.clearPersisted();
  measure.reset();
  route.clear();
  pointMarkers.splice(0).forEach((m) => map.removeLayer(m));
  toast('已清除全部高亮与临时标记');
});

const layerButtons = [...document.querySelectorAll('#layerSwitch button')];
layerButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    basemaps.switchTo(btn.dataset.basemap);
    layerButtons.forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelector('.layer-switch .anno').style.display = basemaps.hasLabels(basemaps.current) ? 'none' : '';
    toast(basemaps.current === 'satellite' ? '卫星图：描边/看图更清楚' : '已切换标准图');
  }),
);
document.getElementById('annoChk').addEventListener('change', (e) => basemaps.setAnnotation(e.target.checked));

map.on('mousemove', (e) => {
  coordsEl.textContent = `经纬度 ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
});
function updateZoomLabel() {
  zoomEl.textContent = `缩放 ${map.getZoom()} 级`;
}
map.on('zoomend', updateZoomLabel);
updateZoomLabel();

const adminRowOf = (a) => ({
  kind: 'admin',
  adcode: a.c,
  name: a.n,
  level: a.l,
  levelLabel: LEVEL_LABEL[a.l] || a.l,
  path: a.path,
});

/** 沿索引的父链把「此处」各级行政区取出来，细 → 粗 */
function adminChainOf(item) {
  const chain = [];
  for (let a = item; a && chain.length < 6; a = a.p ? findAdmin(a.p) : null) chain.push(a);
  return chain;
}

async function adminLevelEntries(latlng) {
  if (!amapReady()) throw new Error(`反查需要高德 key：${NO_KEY_HINT}`);
  const g = await regeo(latlng);
  await loadAdminIndex();
  let item = g.adcode ? findAdmin(g.adcode) : null;
  if (!item) {
    const guess = searchAdmin([g.province, g.city, g.district].filter(Boolean).join(''), 1)[0];
    item = guess ? findAdmin(guess.adcode) : null;
  }
  if (!item) throw new Error(`${g.name || '此处'}：行政区索引里没有匹配项`);
  const chain = adminChainOf(item);
  const rows = chain.map((a) => ({
    label: `${esc(a.n)} · ${LEVEL_LABEL[a.l] || a.l}`,
    run: () => search.highlightAdmin(adminRowOf(a)),
  }));
  if (g.town) {
    const deepest = chain[0];
    rows.unshift({
      label: `${esc(g.town)} · 乡镇街道`,
      run: () =>
        explainNoOutline({
          name: g.town,
          latlng,
          extra: `高德能识别这一级（towncode <code>${esc(g.towncode || '无')}</code>），但实测其边界串长度为 0。`,
          actions: [
            {
              label: `高亮所属 ${deepest.n}（${LEVEL_LABEL[deepest.l] || deepest.l}）`,
              run: () => search.highlightAdmin(adminRowOf(deepest)),
            },
          ],
        }),
    });
  }
  return rows;
}

map.on('contextmenu', (e) => {
  if (state.activeTool) return;
  const latlng = [e.latlng.lat, e.latlng.lng];
  const hit = store.hitTest(latlng);
  const entries = [];
  if (hit) {
    entries.push({ label: `取消高亮「${esc(hit.name)}」`, danger: true, run: () => store.remove(hit.id) });
    entries.push({ label: '仅保留这一块', run: () => store.keepOnly(hit.id) });
    entries.push({
      label: '复制名称与面积',
      run: () =>
        navigator.clipboard
          ?.writeText(`${hit.name}\t${formatArea(hit.area)}`)
          .then(() => toast('已复制'))
          .catch(() => toast('复制失败')),
    });
  }
  entries.push({ label: '设为路径起点', run: () => route.setEndpoint('from', latlng) });
  entries.push({ label: '设为路径终点', run: () => route.setEndpoint('to', latlng) });
  entries.push({
    label: '从这里开始绘制区域',
    run: () => {
      setTool('draw');
      toast('已进入绘制模式：继续左键逐点描边，右键闭合');
    },
  });
  entries.push({
    label: '测距：从此处开始',
    run: () => {
      setTool('measure');
      measure.addPoint(latlng);
    },
  });
  entries.push({
    label: '高亮此处所属行政区',
    children: () => adminLevelEntries(latlng),
  });
  ctx.open(
    e,
    hit ? `${esc(hit.name)} · ${formatArea(hit.area)}` : `${latlng[0].toFixed(5)}, ${latlng[1].toFixed(5)}`,
    entries,
  );
});

document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
  if (e.key === 'Escape') {
    if (dialogEl) return closeDialog();
    if (settings.isOpen) return settings.close();
    if (state.activeTool) setTool(state.activeTool);
    return;
  }
  if (typing) return;
  if (e.key === 'Enter' && state.activeTool === 'draw') draw.onEnter();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    if (state.activeTool === 'draw') draw.undo();
    else if (state.activeTool === 'measure') measure.undo();
  }
});

store.subscribe((items, event) => {
  if (event !== 'focus') store.persist();
});

function updateSourceFlag() {
  const parts = [appConfig.hasAmapKey ? '高德 key 已启用' : '免 key 模式（行政区 + 手绘）'];
  parts.push(`行政边界 DataV${state.osm.nominatim ? '+OSM' : ''}`);
  parts.push(state.osm.osrm ? '路径 OSRM 可用' : appConfig.hasAmapKey ? '路径 高德' : '路径 需 key');
  parts.push(appConfig.proxy ? '本地服务已连接' : '浏览器直连');
  srcFlagEl.textContent = parts.join(' · ');
}

const restored = store.restore();
renderer.sync();

(async function boot() {
  Object.assign(appConfig, await loadConfig());
  updateSourceFlag();
  probeOsm().then((o) => {
    state.osm = o;
    updateSourceFlag();
  });
  if (restored.length) toast(`已恢复上次高亮的 ${restored.length} 个区域（右键区域内可取消）`);
  if (!appConfig.hasAmapKey) setTimeout(() => toast(NO_KEY_HINT, 5200), 1200);
})();
