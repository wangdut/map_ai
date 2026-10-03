import { amapReady, route as amapRoute, geocode } from '../data/amap.js';
import { routeWithOsrm, geocodeWithPhoton } from '../data/osm.js';
import { findAdmin } from '../data/admin-index.js';
import { formatDistance, formatDuration } from '../geom/geo.js';

const LINE_COLOR = '#0091ff';

const MODE_LABEL = { driving: '驾车', walking: '步行', bicycling: '骑行', transit: '公交' };

export function createRouteTool(map, ui, state) {
  const card = document.getElementById('routeCard');
  const fromIn = document.getElementById('rcFrom');
  const toIn = document.getElementById('rcTo');
  const modes = document.getElementById('rcModes');
  const result = document.getElementById('rcResult');
  let mode = 'driving';
  let shapes = [];
  let cityHint = '';

  if (!map.getPane('route')) {
    map.createPane('route');
    map.getPane('route').style.zIndex = 420;
  }

  const LL = /^(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)$/;

  function parse(text) {
    const m = LL.exec((text || '').trim());
    return m ? [Number(m[1]), Number(m[2])] : null;
  }

  async function resolve(text) {
    const direct = parse(text);
    if (direct) return direct;
    const q = (text || '').trim();
    if (!q) throw new Error('请填写起点和终点（地址或"纬度,经度"）');
    if (amapReady()) {
      const list = await geocode(q);
      if (!list.length) throw new Error(`高德无法解析：${q}`);
      const g = list[0];
      const path = findAdmin(g.adcode)?.path || '';
      cityHint = cityHint || path.split('/')[1] || '';
      return g.latlng;
    }
    if (state.osm?.photon) {
      const g = await geocodeWithPhoton(q);
      if (g) return g.latlng;
    }
    throw new Error('没有可用的地理编码（配置高德 key，或改用在地图上右键取点）');
  }

  function clearLine() {
    shapes.forEach((s) => map.removeLayer(s));
    shapes = [];
  }

  function draw(r, a, b) {
    clearLine();
    if (r.geometry) {
      shapes.push(
        L.geoJSON({ type: 'Feature', properties: {}, geometry: r.geometry }, {
          pane: 'route',
          interactive: false,
          style: { color: LINE_COLOR, weight: 5, opacity: 0.85, className: 'route-line' },
        }).addTo(map),
      );
      map.fitBounds(L.geoJSON({ type: 'Feature', properties: {}, geometry: r.geometry }).getBounds(), { padding: [50, 50] });
    }
    [a, b].forEach((p, i) =>
      shapes.push(
        L.circleMarker(p, {
          radius: 6,
          color: i === 0 ? '#16a085' : '#e53935',
          fillColor: '#fff',
          fillOpacity: 0.95,
          weight: 2,
        }).addTo(map),
      ),
    );
  }

  async function plan() {
    result.textContent = '规划中…';
    try {
      const a = await resolve(fromIn.value);
      const b = await resolve(toIn.value);
      let r;
      if (amapReady()) {
        r = await amapRoute(mode, a, b, { city: mode === 'transit' ? cityHint : '' });
      } else {
        if (mode === 'transit') throw new Error('公交规划需要高德 key（OSRM 只有驾车/步行/骑行）');
        if (!state.osm?.osrm) throw new Error('未配置高德 key，且本机无法连接 OSRM 兜底路线服务');
        r = await routeWithOsrm(mode, a, b);
      }
      draw(r, a, b);
      result.innerHTML =
        `<b>${formatDistance(r.distance)}</b> · 约 ${formatDuration(r.duration)}` +
        `<br><span style="color:#6b7280">引擎：${r.engine}${r.tolls ? ` · 过路费 ${r.tolls}` : ''}</span>` +
        (r.summary ? `<br><span style="color:#6b7280">${r.summary}</span>` : '');
      ui.setTip(`路径规划：${MODE_LABEL[mode]} ${formatDistance(r.distance)}（${r.engine}）`);
    } catch (e) {
      result.innerHTML = `<span class="warn">${e.message}</span>`;
      ui.setTip('');
    }
  }

  function setEndpoint(which, latlng) {
    const text = `${latlng[0].toFixed(6)}, ${latlng[1].toFixed(6)}`;
    (which === 'from' ? fromIn : toIn).value = text;
    card.classList.remove('hidden');
    ui.toast(which === 'from' ? '已设为路径起点' : '已设为路径终点');
  }

  modes.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    mode = btn.dataset.mode;
    modes.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
  });
  document.getElementById('rcGo').addEventListener('click', plan);
  document.getElementById('rcClose').addEventListener('click', () => card.classList.add('hidden'));
  document.getElementById('rcSwap').addEventListener('click', () => {
    [fromIn.value, toIn.value] = [toIn.value, fromIn.value];
  });
  [fromIn, toIn].forEach((el) => el.addEventListener('keydown', (e) => e.key === 'Enter' && plan()));

  return {
    activate() {
      card.classList.remove('hidden');
      ui.setTip('路径规划：填起终点地址（或直接输入"纬度,经度"），也可在地图上右键取点');
    },
    deactivate() {
      ui.setTip('');
    },
    clear() {
      clearLine();
      result.textContent = '输入起终点后规划，支持高德（需 key）与 OSRM 兜底。';
    },
    setEndpoint,
    plan,
    get hasKey() {
      return amapReady();
    },
  };
}
