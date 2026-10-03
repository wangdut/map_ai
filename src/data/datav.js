import { sourceUrl } from '../config.js';

const cache = new Map();

/**
 * 阿里云 DataV.GeoAtlas：免 key、CORS 全开的行政区划边界。
 * `{adcode}.json` = 该区域合并轮廓；`{adcode}_full.json` = 其下级分区（叶节点无 _full，会 404）。
 */
export async function fetchBoundary(adcode, withChildren = false) {
  const key = `${adcode}${withChildren ? '_full' : ''}`;
  if (cache.has(key)) return cache.get(key);
  const res = await fetch(sourceUrl('datav', `areas_v3/bound/${key}.json`));
  if (!res.ok) {
    if (withChildren) return fetchBoundary(adcode, false);
    throw new Error(`DataV 无 adcode ${adcode} 的边界数据 (HTTP ${res.status})`);
  }
  const json = await res.json();
  cache.set(key, json);
  return json;
}

export function featuresOf(fc) {
  return fc?.features || [];
}

/** 单要素 FeatureCollection -> { geometry, props } */
export async function regionOf(adcode) {
  const fc = await fetchBoundary(adcode, false);
  const f = featuresOf(fc)[0];
  if (!f) throw new Error(`adcode ${adcode} 返回空边界`);
  return { geometry: f.geometry, props: f.properties || {} };
}

export async function childrenOf(adcode) {
  const fc = await fetchBoundary(adcode, true);
  return featuresOf(fc)
    .filter((f) => f.geometry)
    .map((f) => ({ geometry: f.geometry, props: f.properties || {} }));
}
