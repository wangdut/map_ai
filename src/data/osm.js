import { appConfig, DIRECT_BASES } from '../config.js';
import { convertGeometry, wgs2gcj, gcj2wgs } from '../geom/coortransform.js';

/**
 * OSM 系数据源（Nominatim / Photon / Overpass / OSRM）。
 * 本机网络下 Nominatim 与 Overpass 通常不可达，启动时探测一次，不可用则整条链路自动跳过。
 * 这些源是 WGS84，高德底图是 GCJ-02，返回的几何一律转换成 GCJ-02 再绘制。
 */

const url = (source, rel) => (appConfig.proxy ? `/api/${source}/${rel}` : DIRECT_BASES[source] + rel);

let availability = null;

async function tryFetch(target, ms = 4000) {
  const res = await fetch(target, { cache: 'no-store', signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(String(res.status));
  return res;
}

export async function probeOsm() {
  if (availability) return availability;
  const out = { nominatim: false, photon: false, osrm: false };
  availability = (async () => {
    try {
      await tryFetch(url('nominatim', 'status?format=json'));
      out.nominatim = true;
    } catch {
      /* 被墙或未授权 */
    }
    try {
      await tryFetch(url('photon', '?q=%E4%B8%AD%E5%9B%BD&limit=1'));
      out.photon = true;
    } catch {
      /* noop */
    }
    try {
      await tryFetch(url('osrm', 'route/v1/driving/113.37,23.16;113.38,23.17?overview=false'));
      out.osrm = true;
    } catch {
      /* noop */
    }
    return out;
  })();
  return availability;
}

function toGcjGeometry(geometry) {
  return geometry ? convertGeometry(geometry, wgs2gcj) : null;
}

export async function searchWithNominatim(keyword, limit = 8) {
  const res = await tryFetch(
    url(
      'nominatim',
      `search?q=${encodeURIComponent(keyword)}&format=jsonv2&limit=${limit}&polygon_geojson=1&addressdetails=1&accept-language=zh-CN`,
    ),
    8000,
  );
  const list = await res.json();
  return list.map((p) => ({
    kind: p.category === 'administrative' || p.type === 'administrative' ? 'admin-osm' : 'poi',
    id: `osm:${p.osm_type}-${p.osm_id}`,
    name: p.name || p.display_name,
    address: p.display_name,
    type: `${p.type}`,
    latlng: [Number(p.lat), Number(p.lon)],
    geometry: p.geojson ? toGcjGeometry(p.geojson) : null,
    source: 'osm',
  }));
}

export async function geocodeWithPhoton(keyword) {
  const res = await tryFetch(url('photon', `?q=${encodeURIComponent(keyword)}&limit=1`), 6000);
  const json = await res.json();
  const f = json.features?.[0];
  if (!f) return null;
  const [lng, lat] = f.geometry.coordinates;
  const p = f.properties || {};
  const [gLat, gLng] = wgs2gcj(lat, lng);
  return {
    kind: 'point',
    name: [p.name, p.city, p.district, p.state].filter(Boolean).join(' ') || keyword,
    latlng: [gLat, gLng],
    source: 'photon',
  };
}

const OSRM_PROFILE = { driving: 'driving', walking: 'foot', bicycling: 'bike' };

/** OSRM 用 WGS84：入参 GCJ 坐标先转换，返回几何再转回 GCJ 以便在高德底图上绘制 */
export async function routeWithOsrm(mode, fromGcj, toGcj) {
  const profile = OSRM_PROFILE[mode] || 'driving';
  const [a, b] = [fromGcj, toGcj].map((p) => {
    const [lat, lng] = gcj2wgs(p[0], p[1]);
    return `${lng},${lat}`;
  });
  const res = await tryFetch(url('osrm', `route/v1/${profile}/${a};${b}?overview=full&geometries=geojson`), 12000);
  const json = await res.json();
  const r = json.routes?.[0];
  if (!r) throw new Error(`OSRM 未返回路线（${json.code || 'unknown'}）`);
  return {
    engine: `OSRM ${profile}`,
    distance: r.distance,
    duration: r.duration,
    geometry: toGcjGeometry(r.geometry),
    summary: (r.legs?.[0]?.steps || []).map((s) => s.maneuver?.type).slice(0, 6).join(' → '),
  };
}
