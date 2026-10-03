/**
 * 探测当前网络下各数据源是否可用：node scripts/probe-sources.mjs
 * 换网络 / 被墙情况变化后重跑一次，据此判断哪些功能需要走本地代理。
 */
const SOURCES = [
  {
    name: '高德标准瓦片',
    url: 'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=1915&y=878&z=11',
    use: '标准底图（中文注记）',
  },
  { name: '高德卫星瓦片', url: 'https://webst01.is.autonavi.com/appmaptile?style=6&x=1915&y=878&z=11', use: '卫星影像底图' },
  { name: '高德路网注记叠加', url: 'https://webst01.is.autonavi.com/appmaptile?style=8&x=1915&y=878&z=11', use: '卫星图上的路网层' },
  {
    name: 'Esri World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/11/878/1915',
    use: '卫星影像备用源',
  },
  { name: 'DataV 行政区边界', url: 'https://geo.datav.aliyun.com/areas_v3/bound/440106.json', use: '免 key 行政区面（核心）' },
  {
    name: 'DataV 下级边界',
    url: 'https://geo.datav.aliyun.com/areas_v3/bound/440100_full.json',
    use: '一次拿到全市各区县',
  },
  { name: '高德 Web 服务', url: 'https://restapi.amap.com/v3/config/district?keywords=%E5%B9%BF%E5%B7%9E%E5%B8%82&subdistrict=0', use: 'POI/AOI、区划、路径（需 key）' },
  {
    name: 'OSRM 路径',
    url: 'https://router.project-osrm.org/route/v1/driving/113.324,23.106;113.353,23.158?overview=full&geometries=geojson',
    use: '免 key 路径规划兜底',
  },
  { name: 'Photon 地理编码', url: 'https://photon.komoot.io/api/?q=%E5%B9%BF%E5%B7%9E%E5%A1%94&limit=1', use: '免 key 地址解析兜底（需经本地代理，无 CORS）' },
  { name: 'Nominatim', url: 'https://nominatim.openstreetmap.org/status?format=json', use: 'OSM 兴趣点面（polygon_geojson）' },
  { name: 'Overpass', url: 'https://overpass-api.de/api/interpreter?data=%5Bout%3Ajson%5D%3Bnode%281%29%3Bout%3B', use: 'OSM 建筑/校区轮廓' },
  { name: 'OSM 瓦片', url: 'https://tile.openstreetmap.org/11/1915/878.png', use: '标准底图备用' },
];

const corsOk = (res) => (res.headers.get('access-control-allow-origin') || '').includes('*');

async function probe(src) {
  const t = Date.now();
  try {
    const res = await fetch(src.url, { signal: AbortSignal.timeout(9000), redirect: 'follow' });
    let note = '';
    if (src.name.startsWith('高德 Web')) {
      // 未带 key 时高德会返回业务错误，但能返回就说明网络与 CORS 都通
      const text = await res.text();
      note = text.includes('INVALID_USER_KEY') ? '网络通·缺 key' : '网络通';
    }
    return { ...src, ok: res.ok, status: res.status, ms: Date.now() - t, cors: corsOk(res), note };
  } catch (e) {
    return { ...src, ok: false, status: '-', ms: Date.now() - t, cors: false, note: e.cause?.code || e.name || String(e.message).slice(0, 30) };
  }
}

const results = await Promise.all(SOURCES.map(probe));
const pad = (s, n) => String(s).padEnd(n - [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 1 : 0), 0));

console.log('\n数据源可用性（当前网络）\n');
console.log(`${pad('状态', 8)}${pad('源', 24)}${pad('HTTP', 8)}${pad('耗时', 10)}${pad('CORS', 8)}说明`);
console.log('-'.repeat(100));
for (const r of results) {
  console.log(
    `${pad(r.ok ? '可用' : '不可用', 8)}${pad(r.name, 24)}${pad(r.status, 8)}${pad(`${r.ms}ms`, 10)}${pad(r.cors ? '是' : '否', 8)}${r.use}${r.note ? ` · ${r.note}` : ''}`,
  );
}
const bad = results.filter((r) => !r.ok).map((r) => r.name);
console.log(
  `\n结论：${bad.length ? `以下源当前不可达，相关功能会自动降级或跳过：${bad.join('、')}` : '全部可用'}\n` +
    '浏览器里请通过 node serve.mjs 访问，/api/* 代理可绕开 CORS 与部分拦截。\n',
);
