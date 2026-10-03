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

const ui = { toast, setTip, askName: (title, def) => window.prompt(title, def), addPointMarker };

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

async function highlightAdminAt(latlng) {
  if (!amapReady()) {
    return toast(`反查「此处属于哪个行政区」需要高德 key。${NO_KEY_HINT}`);
  }
  try {
    const g = await regeo(latlng);
    await loadAdminIndex();
    const byCode = g.adcode ? findAdmin(g.adcode) : null;
    const byName = byCode
      ? null
      : searchAdmin([g.city, g.district].filter(Boolean).join('') || g.province || '', 1)[0];
    if (!byCode && !byName) return toast(`${g.name || ''}：行政区索引里没有匹配项`);
    const r = byCode
      ? { kind: 'admin', adcode: byCode.c, name: byCode.n, level: byCode.l, levelLabel: LEVEL_LABEL[byCode.l], path: byCode.path }
      : byName;
    await search.highlightAdmin(r);
  } catch (e) {
    toast(`反查失败：${e.message}`);
  }
}

map.on('contextmenu', (e) => {
  if (state.activeTool) return;
  const latlng = [e.latlng.lat, e.latlng.lng];
  const hit = store.hitTest(latlng);
  const entries = [];
  if (hit) {
    entries.push({ label: `取消高亮「${hit.name}」`, danger: true, run: () => store.remove(hit.id) });
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
  if (!hit) entries.push({ label: '高亮此处所属行政区', run: () => highlightAdminAt(latlng) });
  ctx.open(e, hit ? `${hit.name} · ${formatArea(hit.area)}` : `${latlng[0].toFixed(5)}, ${latlng[1].toFixed(5)}`, entries);
});

document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
  if (e.key === 'Escape') {
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
