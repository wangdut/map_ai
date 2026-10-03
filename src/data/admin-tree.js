import { childrenOf } from './datav.js';
import { amapReady, districtBoundary } from './amap.js';

/** 行政层级阶梯；street 及以下在任何可达数据源里都没有轮廓 */
export const LADDER = ['country', 'province', 'city', 'district', 'street'];
export const LEVEL_SHORT = { country: '国家', province: '省', city: '市', district: '区县', street: '乡镇街道' };

export const NO_OUTLINE =
  '乡镇街道级拿不到轮廓：高德 config/district 能识别但边界串长度为 0，阿里云 DataV 最细只到区县级';

/** 粒度下拉的值 → 向下几级 */
export const GRAN_DEPTH = { self: 0, d1: 1, d2: 2 };

/**
 * 给定某行政区的级别，列出可选粒度。
 * 返回 [{ value: 'self' | 'd1' | 'd2' | 'street', label, disabled?, hint? }]
 */
export function granularityOptions(level) {
  const from = LADDER.indexOf(level);
  // 还没选区域时给出通用说法，选定后按该区域级别换成具体名称
  if (from < 0) {
    return [
      { value: 'self', label: '仅本级' },
      { value: 'd1', label: '直接下级' },
      { value: 'd2', label: '下两级（如省→区县）' },
    ];
  }
  const opts = [{ value: 'self', label: `仅本级（${LEVEL_SHORT[level]}）` }];
  for (const depth of [1, 2]) {
    const target = LADDER[from + depth];
    if (!target) continue;
    if (target === 'street') {
      opts.push({ value: 'street', label: `下级${LEVEL_SHORT[target]}`, disabled: true, hint: NO_OUTLINE });
      continue;
    }
    opts.push({ value: `d${depth}`, label: depth === 1 ? `下级${LEVEL_SHORT[target]}` : `下两级${LEVEL_SHORT[target]}` });
  }
  return opts;
}

const datavChild = (parent, f) => ({
  adcode: String(f.props.adcode),
  name: f.props.name,
  level: f.props.level,
  geometry: f.geometry,
  centroid: f.props.centroid ? [f.props.centroid[1], f.props.centroid[0]] : null,
  parent: parent.name,
  parentAdcode: String(parent.adcode),
});

/** DataV 只有「直接下级」，需要逐层递归；到叶子时 _full 会回退成自身，据此判停 */
async function descendantsViaDatav(parent, depth) {
  let frontier = [{ adcode: String(parent.adcode), name: parent.name }];
  let out = [];
  for (let d = 0; d < depth; d++) {
    const groups = await Promise.all(
      frontier.map(async (node) => {
        const kids = await childrenOf(node.adcode).catch(() => []);
        return kids
          .filter((k) => k.geometry && String(k.props?.adcode) !== node.adcode)
          .map((k) => datavChild(node, k));
      }),
    );
    out = groups.flat();
    if (!out.length) return [];
    frontier = out;
  }
  return out;
}

function collectAmap(nodes, depth) {
  if (depth === 0) return nodes;
  return nodes.flatMap((n) => collectAmap(n.children || [], depth - 1));
}

/** 高德 keywords 支持 adcode，比中文名精确（避免「州」「县」这类重名） */
const amapKey = (row) => (/^\d{6}$/.test(String(row.adcode)) ? String(row.adcode) : row.name);

/**
 * 取某个行政区向下 depth 级的全部子区（1=直接下级，2=下下级）。
 * 有 key 时优先用高德一次请求拿整棵树；拿不齐（深层没给边界串）则退回 DataV 逐层递归。
 */
export async function descendantsOf(row, depth) {
  const from = LADDER.indexOf(row.level);
  const target = from < 0 ? null : LADDER[from + depth];
  if (!target) throw new Error(`${row.name} 已经是最低一级，没有向下第 ${depth} 级的子区`);
  if (target === 'street') throw new Error(NO_OUTLINE);

  if (amapReady()) {
    try {
      const [root] = await districtBoundary(amapKey(row), depth);
      const atDepth = collectAmap(root?.children || [], depth - 1);
      const outlined = atDepth.filter((n) => n.hasOutline);
      // 只有整层都拿到边界串才算成功，否则宁可走 DataV，免得画出一半少一半
      if (atDepth.length && outlined.length === atDepth.length) {
        return outlined.map((k) => ({
          adcode: k.adcode,
          name: k.name,
          level: k.level,
          targetLevel: target,
          geometry: k.geometry,
          centroid: k.center,
          parent: row.name,
          parentAdcode: String(row.adcode),
        }));
      }
    } catch {
      /* 高德这条路径没给树时退回 DataV 递归 */
    }
  }
  const kids = await descendantsViaDatav(row, depth);
  if (!kids.length) throw new Error(`${row.name} 的下第 ${depth} 级没有可用的边界数据`);
  return kids.map((k) => ({ ...k, targetLevel: target }));
}

/**
 * 街道级没有轮廓，但高德 district 能给出街道名与中心点 —— 退一步的「列清单 + 打点」视图。
 * 返回 [{ name, center:[lat,lng], adcode }]
 */
export async function streetPointsOf(row) {
  if (!amapReady()) throw new Error('列出街道需要高德 key：district 接口要用');
  const [root] = await districtBoundary(amapKey(row), 1);
  const kids = (root?.children || []).filter((k) => k.center);
  if (!kids.length) throw new Error(`${row.name} 没有返回街道/镇列表`);
  return kids.map((k) => ({ name: k.name, center: k.center, adcode: k.adcode, levelLabel: k.levelLabel }));
}
