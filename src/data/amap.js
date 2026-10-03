import { appConfig, sourceUrl } from '../config.js';

export const amapReady = () => Boolean(appConfig.hasAmapKey);

async function get(path, params = {}) {
  const qs = new URLSearchParams({ ...params, output: 'JSON' });
  if (!appConfig.proxy && appConfig.amapKey) qs.set('key', appConfig.amapKey);
  const res = await fetch(sourceUrl('amap', `${path}?${qs}`), { cache: 'no-store' });
  if (!res.ok) throw new Error(`高德接口 HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === '0') throw new Error(amapErrorText(data));
  return data;
}

function amapErrorText(data) {
  const map = {
    INVALID_USER_KEY: '未配置高德 key（config.json 的 amapKey）',
    USER_DAILY_OVER_LIMIT: '高德 key 今日配额已用完',
    DAILY_QUERY_OVER_LIMIT: '高德 key 今日配额已用完',
    INVALID_USER_IP: '高德 key 绑定了 IP 白名单，本机 IP 不在列',
    INVALID_USER_DOMAIN: '高德 key 绑定了域名白名单',
    INSUFFICIENT_PRIVILEGES: '该高德 key 未开通此服务权限',
  };
  return map[data.infocode] || data.info || `高德接口错误 (infocode ${data.infocode})`;
}

const pair = (s) => {
  const [lng, lat] = String(s).split(',').map(Number);
  return [lng, lat];
};

/** 高德折线串 "lng,lat;lng,lat|lng,lat;..." -> GeoJSON Polygon / MultiPolygon */
export function parsePolylineString(str) {
  const parts = String(str || '')
    .split('|')
    .map((seg) => seg.split(';').filter(Boolean).map(pair))
    .filter((ring) => ring.length >= 3);
  if (!parts.length) return null;
  if (parts.length === 1) return { type: 'Polygon', coordinates: [parts[0]] };
  return { type: 'MultiPolygon', coordinates: parts.map((ring) => [ring]) };
}

/** 从 POI 对象里尽力取出轮廓：不同接口/权限字段名不一致，逐个候选尝试 */
function extractGeometry(poi) {
  const candidates = [poi.polygon, poi.aoi?.polygon, poi.aois?.[0]?.polygon, poi.aois?.[0]?.polyline, poi.aoi?.map_regions];
  for (const c of candidates) {
    if (typeof c === 'string' && c.includes(';')) {
      const g = parsePolylineString(c);
      if (g) return { geometry: g, field: 'polygon' };
    }
  }
  if (Array.isArray(poi.aois) && poi.aois.length) {
    const aoi = poi.aois.reduce((a, b) => (Number(b.area) > Number(a.area) ? b : a), poi.aois[0]);
    return { geometry: null, aoiArea: Number(aoi.area) || null, aoiName: aoi.name || null };
  }
  return { geometry: null };
}

export async function searchPOI(keyword, { city = '', limit = 10 } = {}) {
  const data = await get('/v3/place/text', {
    keywords: keyword,
    city,
    citylimit: city ? 'true' : 'false',
    offset: Math.min(limit, 25),
    page: 1,
    extensions: 'all',
  });
  return (data.pois || []).map((p) => {
    const { geometry, aoiArea, aoiName } = extractGeometry(p);
    return {
      kind: 'poi',
      id: `amap:${p.id}`,
      name: p.name,
      address: typeof p.address === 'string' ? p.address : '',
      type: (p.type || '').split(';').pop(),
      adcode: p.adcode,
      latlng: p.location ? pair(p.location).reverse() : null,
      geometry,
      aoiArea,
      aoiName,
      source: 'amap',
    };
  });
}

export async function geocode(address, city = '') {
  const data = await get('/v3/geocode/geo', { address, city });
  return (data.geocodes || []).map((g) => ({
    kind: 'point',
    name: g.formatted_address,
    latlng: pair(g.location).reverse(),
    adcode: g.adcode,
    level: g.level,
    source: 'amap',
  }));
}

export async function regeo(latlng, radius = 500) {
  const data = await get('/v3/geocode/regeo', {
    location: `${latlng[1]},${latlng[0]}`,
    radius,
    extensions: 'base',
  });
  const c = data.regeocode?.addressComponent || {};
  const town = typeof c.town === 'string' ? c.town : '';
  return {
    name: data.regeocode?.formatted_address || '',
    adcode: typeof c.adcode === 'string' ? c.adcode : String(c.adcode || ''),
    province: typeof c.province === 'string' ? c.province : '',
    city: typeof c.city === 'string' ? c.city : '',
    district: typeof c.district === 'string' ? c.district : '',
    town,
    latlng,
  };
}

export async function districtBoundary(keyword, subdistrict = 1) {
  const data = await get('/v3/config/district', {
    keywords: keyword,
    subdistrict,
    extensions: 'all',
    strategy: 'search',
  });
  const walk = (list, depth = 1) =>
    (list || []).flatMap((d) => [
      {
        kind: 'admin',
        id: `amap-district:${d.adcode}`,
        adcode: String(d.adcode),
        name: d.name,
        levelLabel: { 0: '国家', 1: '省级', 2: '地级市', 3: '区县级', 4: '乡镇街道级' }[d.level] || d.level,
        center: d.center ? pair(d.center).reverse() : null,
        geometry: d.polygon ? parsePolylineString(d.polygon) : null,
        children: walk(d.districts, depth + 1),
        source: 'amap',
      },
    ]);
  return walk(data.districts);
}

const AMAP_MODE = { driving: 'driving', walking: 'walking', bicycling: 'riding' };

export async function route(mode, from, to, { city = '' } = {}) {
  const [lng1, lat1] = from;
  const [lng2, lat2] = to;
  if (mode === 'transit') {
    if (!city) throw new Error('公交规划需要城市名（请在起点输入里带上城市，如"广州"）');
    const data = await get('/v3/direction/transit/integrated', {
      origin: `${lng1},${lat1}`,
      destination: `${lng2},${lat2}`,
      city,
      strategy: 0,
    });
    const t = data.route?.transits?.[0];
    if (!t) throw new Error('没有公交方案');
    const coords = (t.segments || []).flatMap((s) => (s.walk?.polyline || s.bus?.segments?.[0]?.polyline || '').split(';').filter(Boolean).map(pair));
    return {
      engine: '高德公交',
      distance: Number(t.distance) || 0,
      duration: Number(t.duration) || 0,
      geometry: coords.length > 1 ? { type: 'LineString', coordinates: coords } : null,
      summary: (t.segments || [])
        .flatMap((s) => (s.bus?.buslines || []).map((b) => b.name))
        .filter(Boolean)
        .join(' → '),
    };
  }
  const path = `/v3/direction/${AMAP_MODE[mode] || 'driving'}`;
  const data = await get(path, {
    origin: `${lng1},${lat1}`,
    destination: `${lng2},${lat2}`,
    extensions: 'all',
  });
  const p = data.route?.paths?.[0];
  if (!p) throw new Error('没有可用路线');
  const coords = (p.steps || []).flatMap((s) => String(s.polyline || '').split(';').filter(Boolean).map(pair));
  return {
    engine: `高德${{ driving: '驾车', walking: '步行', bicycling: '骑行' }[mode] || mode}`,
    distance: Number(p.distance) || 0,
    duration: Number(p.duration) || 0,
    geometry: coords.length > 1 ? { type: 'LineString', coordinates: coords } : null,
    summary: (p.steps || []).map((s) => s.instruction).slice(0, 6).join('；'),
    tolls: p.tolls ? `${p.tolls} 元` : '',
  };
}

export async function measureDistance(mode, points) {
  if (points.length < 2) return null;
  const data = await get('/v3/distance', {
    type: { driving: '1', walking: '3', bicycling: '4' }[mode] || '1',
    origins: points.map((p) => `${p[1]},${p[0]}`).join(';'),
  });
  const r = data.results?.[0];
  return r ? { distance: Number(r.distance) || 0, duration: Number(r.duration) || 0 } : null;
}
