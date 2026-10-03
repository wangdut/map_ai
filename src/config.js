const DEFAULTS = {
  hasAmapKey: false,
  amapKeyMask: '',
  tileProvider: 'amap',
  routeProvider: 'auto',
  proxy: false,
  amapKey: '',
};

export const appConfig = { ...DEFAULTS };

export const DIRECT_BASES = {
  amap: 'https://restapi.amap.com/',
  osrm: 'https://router.project-osrm.org/',
  datav: 'https://geo.datav.aliyun.com/',
  esri: 'https://server.arcgisonline.com/',
  nominatim: 'https://nominatim.openstreetmap.org/',
  overpass: 'https://overpass-api.de/api/interpreter',
  photon: 'https://photon.komoot.io/api/',
};

export function sourceUrl(source, pathWithQuery) {
  const rel = pathWithQuery.replace(/^\/+/, '');
  if (appConfig.proxy) return `/api/${source}/${rel}`;
  return DIRECT_BASES[source] + rel;
}

export async function loadConfig() {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (res.ok) Object.assign(appConfig, { proxy: true }, await res.json());
  } catch {
    /* 无本地服务：退回浏览器直连 */
  }
  if (!appConfig.proxy && !appConfig.hasAmapKey) {
    try {
      const res = await fetch('config.json', { cache: 'no-store' });
      if (res.ok) {
        const c = await res.json();
        Object.assign(appConfig, {
          hasAmapKey: Boolean(c.amapKey),
          amapKey: c.amapKey || '',
          tileProvider: c.tileProvider || DEFAULTS.tileProvider,
          routeProvider: c.routeProvider || DEFAULTS.routeProvider,
        });
      }
    } catch {
      /* 没有 config.json 也完全可用 */
    }
  }
  return appConfig;
}

/**
 * 把 key 交给本地服务写进 config.json。明文只经过这一次请求，
 * 前端状态里只保留掩码与布尔值，避免出现在 DOM、日志或提交里。
 */
export async function saveAmapKey(key) {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'map_ai' },
    body: JSON.stringify({ amapKey: key }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `保存失败（HTTP ${res.status}）`);
  Object.assign(appConfig, {
    hasAmapKey: Boolean(data.hasAmapKey),
    amapKeyMask: data.amapKeyMask || '',
    amapKey: '',
  });
  return data;
}
