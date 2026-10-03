import { amapReady, route as amapRoute, geocode, searchPOI, searchAround, regeo } from '../data/amap.js';
import { routeWithOsrm, geocodeWithPhoton } from '../data/osm.js';
import { haversine, formatDistance, formatDuration } from '../geom/geo.js';
import { esc } from './escape.js';

const LINE_COLOR = '#0091ff';
const MODE_LABEL = { driving: '驾车', walking: '步行', bicycling: '骑行', transit: '公交' };

/** 允许直接粘贴「纬度,经度」，但界面上永远以地名示人 */
const LL = /^(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)$/;

/** 「广州石化小学，大门」→ { subject: '广州石化小学', sub: '大门' } */
export function splitSubject(text) {
  const s = String(text || '').trim();
  let parts = s.split(/[，,、;；]+/).filter(Boolean);
  if (parts.length < 2) parts = s.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { subject: parts.join(''), sub: '' };
  return { subject: parts.slice(0, -1).join(''), sub: parts[parts.length - 1] };
}

const normName = (s) => String(s || '').replace(/[（(）)\[\]【】\s·\-]/g, '');
const GATE = /^(大门|正门|主门|后门|侧门|[东南西北]门|eastgate|westgate|northgate|southgate)$/i;

/** 附属词匹配：「大门」这类泛指与任意方位门互通 */
function subMatcher(sub) {
  const n = normName(sub);
  if (GATE.test(n)) return (name) => /(大门|正门|[东南西北]门)/.test(normName(name));
  return (name) => normName(name).includes(n);
}

/** 高德 POI / 地理编码 / 已归一行，三种来源统一成候选行 */
const rowOf = (p) => ({
  name: p.name,
  sub: p.sub ?? (p.address || p.type || ''),
  latlng: p.latlng,
  adcode: p.adcode || '',
  city: p.cityName || p.city || '',
});

export function createRouteTool(map, ui, state) {
  const card = document.getElementById('routeCard');
  const result = document.getElementById('rcResult');
  const modes = document.getElementById('rcModes');

  const blank = () => ({ text: '', latlng: null, name: '', adcode: '', city: '', full: '', note: '' });
  const side = {
    from: { ep: blank(), input: document.getElementById('rcFrom'), sug: document.getElementById('rcFromSug') },
    to: { ep: blank(), input: document.getElementById('rcTo'), sug: document.getElementById('rcToSug') },
  };
  const other = (which) => (which === 'from' ? 'to' : 'from');
  let mode = 'driving';
  let shapes = [];
  let pins = { from: null, to: null };

  if (!map.getPane('route')) {
    map.createPane('route');
    map.getPane('route').style.zIndex = 420;
  }
  if (!map.getPane('route-markers')) {
    map.createPane('route-markers');
    map.getPane('route-markers').style.zIndex = 500;
  }

  function setEp(which, patch) {
    Object.assign(side[which].ep, patch);
    if (patch.text !== undefined) side[which].input.value = patch.text;
    return side[which].ep;
  }

  function drawPin(which) {
    const e = side[which].ep;
    if (pins[which]) {
      map.removeLayer(pins[which]);
      pins[which] = null;
    }
    if (!e.latlng) return;
    const marker = L.marker(e.latlng, {
      pane: 'route-markers',
      draggable: true,
      autoPan: true,
      icon: L.divIcon({
        className: `rc-pin ${which}`,
        html: which === 'from' ? '起' : '终',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
      title: e.full || e.name,
    }).addTo(map);
    marker.bindTooltip(e.name || (which === 'from' ? '起点' : '终点'), {
      permanent: true,
      direction: 'right',
      offset: [13, 0],
      className: 'rc-pin-label',
    });
    marker.on('dragend', () => {
      const ll = marker.getLatLng();
      setEp(which, { latlng: [ll.lat, ll.lng], name: '', full: '', note: '', text: '定位中…' });
      reverseGeocode(which, true);
    });
    pins[which] = marker;
  }

  function clearLine() {
    shapes.forEach((s) => map.removeLayer(s));
    shapes = [];
  }

  function drawLine(r) {
    clearLine();
    if (!r.geometry) return;
    const g = L.geoJSON({ type: 'Feature', properties: {}, geometry: r.geometry }, {
      pane: 'route',
      interactive: false,
      style: { color: LINE_COLOR, weight: 5, opacity: 0.85, className: 'route-line' },
    }).addTo(map);
    shapes.push(g);
    map.fitBounds(g.getBounds(), { padding: [50, 50] });
  }

  /** 附属点：先按「主体+附属」整体搜，再退到以主体为中心的周边搜 */
  async function findSubPoint(main, sub) {
    if (!main.latlng) return null;
    const ok = subMatcher(sub);
    const pick = (list) => {
      const hit = list.find((p) => p.latlng && ok(p.name));
      return hit
        ? {
            name: `${main.name} · ${hit.name}`,
            sub: hit.address || sub,
            latlng: hit.latlng,
            adcode: hit.adcode,
            city: hit.cityName,
            pinned: true,
          }
        : null;
    };
    try {
      return pick(await searchPOI(`${main.name}${sub}`, { limit: 10 })) || pick(await searchAround(main.latlng, sub, { radius: 3000, limit: 10 }));
    } catch {
      return null;
    }
  }

  async function candidates(which, q) {
    const o = side[other(which)].ep;
    const rows = [];
    if (amapReady()) {
      const { subject, sub } = splitSubject(q);
      let list = await searchPOI(subject, { city: o.city || '', limit: 8 });
      if (!list.length) list = await geocode(subject, o.city || '');
      let note = '';
      if (sub && list.length) {
        const hit = await findSubPoint(list[0], sub);
        if (hit) list = [hit, ...list];
        else note = `未找到「${sub}」子点，已用主体中心`;
      }
      list.forEach((p) => {
        if (p.latlng) rows.push({ ...rowOf(p), note, pinned: Boolean(p.pinned) });
      });
    } else if (state.osm?.photon) {
      const g = await geocodeWithPhoton(q).catch(() => null);
      if (g?.latlng) rows.push({ ...rowOf(g), note: '', pinned: false });
    }
    const dist = (r) => (o.latlng ? haversine(o.latlng, r.latlng) : 0);
    rows.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || dist(a) - dist(b));
    rows.forEach((r) => (r.dist = dist(r)));
    return rows.slice(0, 6);
  }

  function hideSug(which) {
    side[which].sug.classList.add('hidden');
  }

  function showError(which, msg) {
    const box = side[which].sug;
    box.innerHTML = `<div class="err">${esc(msg)}</div>`;
    box.classList.remove('hidden');
  }

  function showSug(which, rows) {
    const box = side[which].sug;
    if (!rows.length) return showError(which, '没有匹配的地名，可换个说法或直接在地图上右键取点');
    box.innerHTML = rows
      .map(
        (r, i) =>
          `<button data-i="${i}"><span>${esc(r.name)}</span><span class="d">${esc(
            [r.sub, r.dist ? `距另一端 ${formatDistance(r.dist)}` : ''].filter(Boolean).join(' · '),
          )}</span></button>`,
      )
      .join('');
    box.querySelectorAll('button').forEach((b, i) =>
      b.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        choose(which, rows[i]);
      }),
    );
    box.classList.remove('hidden');
  }

  /** 选定一个端点；autoPlan=false 供 ensure() 使用，避免规划流程递归 */
  function choose(which, row, autoPlan = true) {
    hideSug(which);
    setEp(which, {
      text: row.name,
      name: row.name,
      latlng: row.latlng,
      adcode: row.adcode,
      city: row.city,
      full: row.full || '',
      note: row.note || '',
    });
    drawPin(which);
    if (autoPlan && side[other(which)].ep.latlng) plan();
  }

  /** 输入框文字 → 端点坐标：已选过的直接用，纯数字直接解析，否则取候选首条 */
  async function ensure(which) {
    const e = side[which].ep;
    const text = side[which].input.value.trim();
    if (e.latlng && e.text === text) return e;
    if (!text) throw new Error(which === 'from' ? '请填写起点' : '请填写终点');
    const m = LL.exec(text);
    if (m) return setEp(which, { text, latlng: [Number(m[1]), Number(m[2])], name: text, note: '' });
    const rows = await candidates(which, text);
    if (!rows.length) throw new Error(`找不到「${text}」的位置${amapReady() ? '' : '（未配置高德 key）'}`);
    choose(which, rows[0], false);
    return e;
  }

  async function plan() {
    card.classList.remove('hidden');
    result.textContent = '规划中…';
    try {
      const a = await ensure('from');
      const b = await ensure('to');
      let r;
      if (amapReady()) {
        r = await amapRoute(mode, a.latlng, b.latlng, { city: a.city || b.city || '' });
      } else {
        if (mode === 'transit') throw new Error('公交规划需要高德 key（OSRM 只有驾车/步行/骑行）');
        if (!state.osm?.osrm) throw new Error('未配置高德 key，且本机连不上 OSRM 兜底路线服务');
        r = await routeWithOsrm(mode, a.latlng, b.latlng);
      }
      drawLine(r);
      const notes = [a.note, b.note].filter(Boolean);
      result.innerHTML =
        `<b>${formatDistance(r.distance)}</b> · 约 ${formatDuration(r.duration)}` +
        `<div class="rc-meta">引擎：${esc(r.engine)}${r.tolls ? ` · 过路费 ${esc(r.tolls)}` : ''} · 起终点为 GCJ-02 坐标，与高德底图一致</div>` +
        (notes.length ? `<div class="rc-meta warn">${esc(notes.join('；'))}</div>` : '') +
        (r.summary ? `<div class="rc-meta">${esc(r.summary)}</div>` : '');
      ui.setTip(`路径规划：${MODE_LABEL[mode]} ${formatDistance(r.distance)}（${r.engine}）`);
    } catch (e) {
      result.innerHTML = `<span class="warn">${esc(e.message)}</span>`;
      ui.setTip('');
    }
  }

  /** 右键/拖动取点后反查地名，输入框里显示地名而不是数字 */
  async function reverseGeocode(which, replan) {
    const e = side[which].ep;
    if (!e.latlng) return;
    if (!amapReady()) {
      const t = `${e.latlng[0].toFixed(5)}, ${e.latlng[1].toFixed(5)}`;
      setEp(which, { text: t, name: t, city: '' });
      drawPin(which);
      ui.toast('未配置高德 key，无法反查地名，已暂用坐标');
      return;
    }
    try {
      const g = await regeo(e.latlng, 300);
      const label =
        g.building || g.neighborhood || g.aois[0]?.name || [g.district, g.town].filter(Boolean).join('') || g.name || '取点';
      setEp(which, { text: label, name: label, full: g.name, adcode: g.adcode, city: g.city || g.district, note: '' });
      drawPin(which);
      if (replan && side[other(which)].ep.latlng) plan();
    } catch (err) {
      ui.toast(`反查地名失败：${err.message}`);
    }
  }

  function setEndpoint(which, latlng) {
    card.classList.remove('hidden');
    setEp(which, { latlng, name: '', full: '', note: '', text: '定位中…' });
    drawPin(which);
    ui.toast(which === 'from' ? '已设为路径起点，正在反查地名' : '已设为路径终点，正在反查地名');
    reverseGeocode(which, true);
  }

  function bindInput(which) {
    const { input, sug } = side[which];
    let timer = null;
    input.addEventListener('input', () => {
      const t = input.value.trim();
      Object.assign(side[which].ep, { text: t, latlng: null, note: '' });
      clearTimeout(timer);
      if (!t || LL.test(t)) return hideSug(which);
      timer = setTimeout(async () => {
        try {
          const rows = await candidates(which, t);
          if (input.value.trim() === t) showSug(which, rows);
        } catch (e) {
          if (input.value.trim() === t) showError(which, e.message);
        }
      }, 350);
    });
    input.addEventListener('blur', () => setTimeout(() => hideSug(which), 120));
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const first = sug.querySelector('button');
      if (first) first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      else plan();
    });
  }

  bindInput('from');
  bindInput('to');

  modes.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    mode = btn.dataset.mode;
    modes.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    if (side.from.ep.latlng && side.to.ep.latlng) plan();
  });
  document.getElementById('rcGo').addEventListener('click', plan);
  document.getElementById('rcClose').addEventListener('click', () => card.classList.add('hidden'));
  document.getElementById('rcSwap').addEventListener('click', () => {
    const a = { ...side.from.ep };
    const b = { ...side.to.ep };
    side.from.ep = b;
    side.to.ep = a;
    side.from.input.value = b.text;
    side.to.input.value = a.text;
    drawPin('from');
    drawPin('to');
    hideSug('from');
    hideSug('to');
    if (side.from.ep.latlng && side.to.ep.latlng) plan();
  });

  return {
    activate() {
      card.classList.remove('hidden');
      ui.setTip('路径规划：输入地名会出候选（支持「主体，附属」如「某小学，大门」），也可右键取点或直接拖动圆牌改点');
    },
    deactivate() {
      ui.setTip('');
    },
    clear() {
      clearLine();
      ['from', 'to'].forEach((which) => {
        if (pins[which]) map.removeLayer(pins[which]);
        pins[which] = null;
        side[which].ep = blank();
        side[which].input.value = '';
        hideSug(which);
      });
      result.textContent = '输入起终点地名，或在地图上右键取点。';
      ui.setTip('');
    },
    setEndpoint,
    plan,
    get hasKey() {
      return amapReady();
    },
  };
}
