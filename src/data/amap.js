import { appConfig, sourceUrl } from '../config.js';

export const amapReady = () => Boolean(appConfig.hasAmapKey);

const MIN_INTERVAL = 380;
/** 高德把符号错误名放在 info、数字码放在 infocode，两边都做映射 */
const AMAP_ERRORS = {
  INVALID_USER_KEY: '未配置高德 key（config.json 的 amapKey）',
  DAILY_QUERY_OVER_LIMIT: '高德 key 今日配额已用完',
  USER_DAILY_OVER_LIMIT: '高德 key 今日配额已用完',
  ACCESS_TOO_FREQUENTLY: '高德接口访问过于频繁，请稍候再试',
  CUQPS_HAS_EXCEEDED_THE_LIMIT: '高德接口并发超限（个人 key 限流），自动重试后仍未放行，请稍候再试',
  INVALID_USER_IP: '高德 key 绑定了 IP 白名单，本机 IP 不在列',
  INVALID_USER_DOMAIN: '高德 key 绑定了域名白名单',
  INSUFFICIENT_PRIVILEGES: '该高德 key 未开通此服务权限',
  USERKEY_PLAT_NOMATCH: 'key 的平台类型不匹配：需要「Web 服务」key，而不是「Web端(JS API)」key',
  INVALID_PARAMS: '高德接口参数有误（请检查地址是否完整、经纬度是否在范围内）',
  '10021': 'CUQPS_HAS_EXCEEDED_THE_LIMIT',
  '10004': 'ACCESS_TOO_FREQUENTLY',
};
const RETRYABLE = new Set(['CUQPS_HAS_EXCEEDED_THE_LIMIT', 'ACCESS_TOO_FREQUENTLY', '10021', '10004']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let queue = Promise.resolve();
let lastAt = 0;

/** 串行 + 限速：个人 key 的 QPS 上限很低，并发请求只会整片失败 */
function request(url) {
  const run = async () => {
    const wait = lastAt + MIN_INTERVAL - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`高德接口 HTTP ${res.status}`);
    return res.json();
  };
  queue = queue.then(run, run);
  return queue;
}

async function get(path, params = {}) {
  const qs = new URLSearchParams({ ...params, output: 'JSON' });
  if (!appConfig.proxy && appConfig.amapKey) qs.set('key', appConfig.amapKey);
  const url = sourceUrl('amap', `${path}?${qs}`);
  let data = await request(url);
  const throttled = data.status === '0' && (RETRYABLE.has(data.info) || RETRYABLE.has(data.infocode));
  if (throttled) {
    await sleep(1300);
    data = await request(url);
  }
  if (data.status === '0') throw new Error(amapErrorText(data));
  return data;
}

function amapErrorText(data) {
  return AMAP_ERRORS[data.info] || AMAP_ERRORS[data.infocode] || data.info || `高德接口错误 (infocode ${data.infocode})`;
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

/** 去掉括号分店后缀与空白，用于把「华南农业大学西区」归到「华南农业大学」这个主体 */
const stem = (s) =>
  String(s || '')
    .replace(/[（(【].*$/, '')
    .trim();

/**
 * POI 轮廓兜底。实测：高德对个人 key 的 place/text、place/detail(v3/v5)、place/around
 * 都不返回任何轮廓字段，只有 regeo 的 aois[].area 给真实面积数值。
 * 所以这里只能拿到「面积 + 中心点」，形状必须由调用方用等面积圆近似。
 */
export async function poiOutlineFallback(poi) {
  if (!poi?.latlng) return { aoiArea: null, aoiNames: [] };
  const subject = stem(poi.name);
  const r = await regeo(poi.latlng, 3000);
  const withArea = r.aois.filter((a) => a.area > 0);
  const sameSubject = subject ? withArea.filter((a) => stem(a.name).startsWith(subject)) : [];
  const picked = sameSubject.length ? sameSubject : withArea.slice(0, 1);
  if (!picked.length) return { aoiArea: null, aoiNames: [] };
  return {
    aoiArea: picked.reduce((s, a) => s + a.area, 0),
    aoiNames: picked.map((a) => a.name),
  };
}

/** 高德的 city/province/district 在无该项时会返回空数组，统一成字符串 */
const str = (v) => (typeof v === 'string' ? v : '');

function mapPoi(p) {
  return {
    kind: 'poi',
    id: `amap:${p.id}`,
    name: p.name,
    address: typeof p.address === 'string' ? p.address : '',
    type: (p.type || '').split(';').pop(),
    adcode: str(p.adcode),
    cityName: str(p.cityname),
    latlng: p.location ? pair(p.location).reverse() : null,
    geometry: typeof p.polygon === 'string' && p.polygon.includes(';') ? parsePolylineString(p.polygon) : null,
    source: 'amap',
  };
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
  return (data.pois || []).map(mapPoi);
}

/** 围绕中心点搜（「主体，附属」写法里的附属点，如某学校的大门） */
export async function searchAround(latlng, keyword, { radius = 2000, limit = 10 } = {}) {
  const data = await get('/v3/place/around', {
    location: `${latlng[1]},${latlng[0]}`,
    keywords: keyword,
    radius,
    offset: Math.min(limit, 25),
    page: 1,
    sortrule: 'distance',
    extensions: 'all',
  });
  return (data.pois || []).map(mapPoi);
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
    extensions: 'all',
  });
  const r = data.regeocode || {};
  const c = r.addressComponent || {};
  return {
    name: str(r.formatted_address),
    adcode: str(c.adcode),
    province: str(c.province),
    city: str(c.city) || str(c.province),
    district: str(c.district),
    town: str(c.township),
    towncode: str(c.towncode),
    neighborhood: str(c.neighborhood?.name),
    building: str(c.building?.name),
    businessAreas: (c.businessAreas || []).map((b) => str(b.name)).filter(Boolean),
    aois: (r.aois || [])
      .map((a) => ({
        name: str(a.name),
        area: Number(a.area) || 0,
        id: str(a.id),
        latlng: a.location ? pair(a.location).reverse() : null,
        distance: Number(a.distance) || 0,
      }))
      .sort((x, y) => y.area - x.area),
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
  const LEVEL_LABEL = {
    country: '国家',
    province: '省级',
    city: '地级市',
    district: '区县级',
    street: '乡镇街道级',
    0: '国家',
    1: '省级',
    2: '地级市',
    3: '区县级',
    4: '乡镇街道级',
  };
  const walk = (list, depth = 1) =>
    (list || []).flatMap((d) => {
      const geometry = parsePolylineString(d.polyline || d.polygon);
      return [
        {
          kind: 'admin',
          id: `amap-district:${d.adcode}`,
          adcode: String(d.adcode),
          name: d.name,
          level: d.level,
          levelLabel: LEVEL_LABEL[d.level] || String(d.level),
          center: d.center ? pair(d.center).reverse() : null,
          geometry,
          hasOutline: Boolean(geometry),
          children: walk(d.districts, depth + 1),
          source: 'amap',
        },
      ];
    });
  return walk(data.districts);
}

const AMAP_MODE = { driving: 'driving', walking: 'walking', bicycling: 'riding' };

export async function route(mode, from, to, { city = '' } = {}) {
  // 应用内部统一 [lat, lng]；高德要求 "lng,lat"
  const [lat1, lng1] = from;
  const [lat2, lng2] = to;
  const origin = `${lng1},${lat1}`;
  const destination = `${lng2},${lat2}`;
  if (mode === 'transit') {
    let city1 = city;
    if (!city1) {
      const g = await regeo(from);
      city1 = g.city || g.district;
    }
    if (!city1) throw new Error('公交规划需要城市名，但无法从起点反查出城市，请改用驾车/步行/骑行');
    const data = await get('/v3/direction/transit/integrated', {
      origin,
      destination,
      city: city1,
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
    origin,
    destination,
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
