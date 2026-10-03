const DEFAULTS = {
  hasAmapKey: false,
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
  if (!appConfig.hasAmapKey) {
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
