import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC_URL = 'https://cdn.jsdelivr.net/gh/modood/Administrative-divisions-of-China@master/dist/pcas-code.json';
const LOCAL_RAW = resolve(ROOT, 'data/.pcas-code.json');
const OUT = resolve(ROOT, 'data/admin-index.json');

/** 只保留 DataV 可解析的 adcode（6 位），丢弃直辖市/直筒子市的合成市级与"直辖县"分组节点 */
const SKIP_CITY = /(直辖县级行政区划|直辖县|县级行政区)$/;
const MUNICIPALITY = new Set(['11', '12', '31', '50']);

async function loadRaw() {
  try {
    return JSON.parse(await readFile(LOCAL_RAW, 'utf8'));
  } catch {
    const res = await fetch(SRC_URL);
    if (!res.ok) throw new Error(`下载行政区划源失败: ${res.status}`);
    const text = await res.text();
    await writeFile(LOCAL_RAW, text);
    return JSON.parse(text);
  }
}

/** modood 代码层级：省 2 位、市 4 位、区县 6 位、街道 9 位；DataV 用 6 位 adcode */
const toAdcode = (code, level) =>
  level === 'province' ? code.padEnd(6, '0') : level === 'city' ? code.padEnd(6, '0') : code.slice(0, 6);

const seen = new Set();
const items = [];

function push({ code, name, level, parent, path }) {
  const c = toAdcode(code, level);
  if (!/^\d{6}$/.test(c) || seen.has(c)) return;
  seen.add(c);
  items.push({ c, n: name, l: level, p: parent ?? null, path });
}

const tree = await loadRaw();

push({ code: '100000000000', name: '中国', level: 'country', parent: null, path: '中国' });

for (const prov of tree) {
  const pCode = toAdcode(prov.code, 'province');
  push({ code: prov.code, name: prov.name, level: 'province', parent: '100000', path: prov.name });
  if (prov.children) {
    for (const city of prov.children) {
      const cCode = toAdcode(city.code, 'city');
      const skipCity = SKIP_CITY.test(city.name) || (MUNICIPALITY.has(pCode.slice(0, 2)) && cCode !== pCode);
      const cityPath = `${prov.name}/${city.name}`;
      if (!skipCity) push({ code: city.code, name: city.name, level: 'city', parent: pCode, path: cityPath });
      for (const dist of city.children || []) {
        push({
          code: dist.code,
          name: dist.name,
          level: 'district',
          parent: skipCity ? pCode : cCode,
          path: skipCity ? `${prov.name}/${dist.name}` : `${cityPath}/${dist.name}`,
        });
      }
    }
  }
}

/** modood 源不含港澳台，DataV 有对应边界，补齐 */
for (const [c, n] of [
  ['710000', '台湾省'],
  ['810000', '香港特别行政区'],
  ['820000', '澳门特别行政区'],
]) {
  if (!seen.has(c)) {
    seen.add(c);
    items.push({ c, n, l: 'province', p: '100000', path: n });
  }
}

const payload = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: 'modood/Administrative-divisions-of-China (GB/T 2260) 前 6 位 adcode，配合阿里云 DataV.GeoAtlas 边界',
  count: items.length,
  items,
};

await writeFile(OUT, JSON.stringify(payload), 'utf8');
console.log(`已生成 ${OUT}  条目 ${items.length}（国 1 / 省 / 市 / 区县）`);
