/**
 * 高德 Web 服务真实响应探测：node scripts/probe-amap.mjs [关键词] [城市]
 * 目的：写解析代码前先看清楚字段名（尤其是 POI 是否带 AOI 轮廓），不要凭记忆猜。
 * 需要 config.json 里已填 amapKey（复制 config.example.json 为 config.json）。
 */
import { readFile, writeFile } from 'node:fs/promises';

const KEY = await readFile(new URL('../config.json', import.meta.url), 'utf8')
  .then((t) => JSON.parse(t).amapKey)
  .catch(() => '');

if (!KEY) {
  console.log('未找到 config.json 里的 amapKey。先执行：cp config.example.json config.json 并填入 key。');
  process.exit(1);
}

const keyword = process.argv[2] || '华南农业大学';
const city = process.argv[3] || '广州';
const B = 'https://restapi.amap.com';

const CALLS = [
  { name: 'POI 搜索 v3/place/text extensions=all', url: `/v3/place/text?keywords=${encodeURIComponent(keyword)}&city=${encodeURIComponent(city)}&extensions=all&citylimit=true&offset=5&page=1&key=${KEY}` },
  { name: 'POI 搜索 v3/place/text extensions=base', url: `/v3/place/text?keywords=${encodeURIComponent(keyword)}&city=${encodeURIComponent(city)}&extensions=base&key=${KEY}` },
  { name: '关键字搜索 v5/place/text', url: `/v5/place/text?keywords=${encodeURIComponent(keyword)}&region=${encodeURIComponent(city)}&show_fields=business,children,indoor&key=${KEY}` },
  { name: '行政区 v3/config/district extensions=all', url: `/v3/config/district?keywords=${encodeURIComponent(city)}&subdistrict=1&extensions=all&key=${KEY}` },
  { name: '地理编码 v3/geocode/geo', url: `/v3/geocode/geo?address=${encodeURIComponent(city + keyword)}&key=${KEY}` },
  { name: '驾车 v5/direction/driving', url: `/v5/direction/driving?origin=113.324,23.106&destination=113.364,23.158&show_fields=cost,polyline&key=${KEY}` },
  { name: '测距 v3/distance', url: `/v3/distance?origins=113.324,23.106&destination=113.364,23.158&type=1&key=${KEY}` },
];

/** 递归列出对象结构（只到第 4 层），便于肉眼找轮廓字段 */
function shape(v, depth = 0, keyName = '') {
  const pad = '  '.repeat(depth);
  if (Array.isArray(v)) {
    if (!v.length) return `${pad}${keyName}: []\n`;
    return `${pad}${keyName}: [${v.length}]\n${shape(v[0], depth + 1, '0')}`;
  }
  if (v && typeof v === 'object') {
    return (
      `${pad}${keyName}: {}\n` +
      Object.entries(v).map(([k, x]) => shape(x, depth + 1, k)).join('')
    );
  }
  const s = String(v);
  return `${pad}${keyName}: ${s.length > 60 ? `${s.slice(0, 60)}…(${s.length} 字符)` : s}\n`;
}

const dump = {};

for (const c of CALLS) {
  const t = Date.now();
  let json;
  try {
    const res = await fetch(B + c.url, { signal: AbortSignal.timeout(15000) });
    json = await res.json();
  } catch (e) {
    console.log(`\n### ${c.name}\n  请求失败：${e.message}\n`);
    continue;
  }
  const raw = JSON.stringify(json);
  const hits = [...raw.matchAll(/"([a-zA-Z_0-9.]*(?:polygon|aoi|polyline|area|boundary)[a-zA-Z_0-9.]*)"\s*:\s*("(?:[^"\\]|\\.){0,80}|[0-9.]+)/gi)];
  console.log(`\n### ${c.name}  (${Date.now() - t}ms, status=${json.status}, infocode=${json.infocode})`);
  if (json.status !== '1') console.log(`  ${json.info}`);
  console.log(shape(json.count !== undefined ? { count: json.count, first: json.pois || json.geocodes || json.districts || json.route || json.results } : json, 1, 'root'));
  if (hits.length) {
    console.log('  轮廓/面积相关字段：');
    for (const h of hits.slice(0, 12)) console.log(`    ${h[1]} = ${h[2]}`);
  } else {
    console.log('  ⚠ 响应里没有任何 polygon/aoi/area 类字段 —— 该接口拿不到真实轮廓');
  }
  dump[c.name] = json;
}

await writeFile(new URL('../.amap-probe.json', import.meta.url), JSON.stringify(dump, null, 2));
console.log(`\n完整响应已写入 .amap-probe.json，可据此核对字段名后再改 src/data/amap.js 的解析。`);
