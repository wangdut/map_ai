/**
 * 把高德矢量瓦片变成海报：像素分类 → 连通域去字 → 按海报色板重着色。
 * 只操作 Uint8ClampedArray，不碰 DOM，可单测。
 *
 * 分类阈值来自实测瓦面色方（webrd style=8，广州 z12–z14）：
 * 底色 #fcf9f2、主干道 #ffa45c / #f68121、次干 #f1d05f / #f8d392、
 * 水系 #a4cdff / #73b2f4 / #d8e7ee、绿地 #c9e59e、普通路 #e3ded4 / #dfdacf、
 * 文字 #4e4f52 / #4c4d50、注记蓝 #657bcb、描边白 #fdfdfd。
 */

export const STYLES = {
  amber: {
    label: '琥珀',
    paper: '#f6f1e6',
    water: '#1f7fa6',
    green: '#b6d7b2',
    arterial: '#ef9a2a',
    secondary: '#f3cd83',
    minor: '#ded6c4',
    line: '#2f3a45',
    ink: '#2f3a45',
  },
  ink: {
    label: '纸墨',
    paper: '#faf9f6',
    water: '#aebfc9',
    green: '#dde2d6',
    arterial: '#3c434c',
    secondary: '#8b9199',
    minor: '#d8d5ce',
    line: '#3c434c',
    ink: '#3c434c',
  },
  night: {
    label: '暗夜',
    paper: '#151a21',
    water: '#2f8fb0',
    green: '#254439',
    arterial: '#f2b13c',
    secondary: '#8a6a35',
    minor: '#2b333d',
    line: '#e6e1d3',
    ink: '#e6e1d3',
  },
  /* 蓝染／蓝印花布：整幅只用一种颜料的不同浓度。水系偏青、主干道偏紫，靠色相而不是明度分开 */
  indigo: {
    label: '靛蓝',
    paper: '#f2efe6',
    water: '#0e5a7d',
    green: '#a9c2c9',
    arterial: '#2b3f77',
    secondary: '#7b9ccb',
    minor: '#d5dbe2',
    line: '#26313f',
    ink: '#26313f',
  },
  /* 龙泉青瓷：梅子青釉做底，路网是刻花后的深色积釉，水系另取一味湖绿 */
  celadon: {
    label: '青瓷',
    paper: '#eef2e9',
    water: '#4f8a8b',
    green: '#c6dcbc',
    arterial: '#2f5d53',
    secondary: '#89ac96',
    minor: '#dfe2d5',
    line: '#2b3a34',
    ink: '#2b3a34',
  },
  /* 赭石陶土：黄土纸配砖红主干道，水系故意用冷青，免得整幅糊成一片暖色 */
  ochre: {
    label: '赭石',
    paper: '#f2e8d9',
    water: '#3f6d7a',
    green: '#c2b98a',
    arterial: '#a8442a',
    secondary: '#d9924f',
    minor: '#e3d5bd',
    line: '#40291d',
    ink: '#40291d',
  },
  /* 暮紫藕荷：淡紫底配梅紫主干道，水系取普鲁士蓝紫，与暖紫的路网拉开 */
  dusk: {
    label: '暮紫',
    paper: '#f3eff3',
    water: '#46589c',
    green: '#cbc6d6',
    arterial: '#7c3b62',
    secondary: '#b98aa6',
    minor: '#ded9e0',
    line: '#2f2637',
    ink: '#2f2637',
  },
};

const BG = 0;
const WATER = 1;
const GREEN = 2;
const ARTERIAL = 3;
const SECONDARY = 4;
const MINOR = 5;
const DROP = 6;

/** 单个像素归类。返回 BG 表示并入底色，DROP 表示文字/图标，同样抹成底色 */
export function classify(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  if (light < 110) return DROP;
  if (b > r + 18 && b > 120 && g >= r - 20) return WATER;
  if (g > b + 24 && g >= r - 12) return GREEN;
  if (r > 200 && g > 95 && g < 200 && b < 150) return ARTERIAL;
  if (r > 205 && g >= 185 && b < 190) return SECONDARY;
  if (max - min < 26 && light >= 195 && light <= 236) return MINOR;
  return BG;
}

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function paletteOf(styleKey) {
  const s = STYLES[styleKey] || STYLES.amber;
  const table = new Array(7);
  table[BG] = table[DROP] = hexRgb(s.paper);
  table[WATER] = hexRgb(s.water);
  table[GREEN] = hexRgb(s.green);
  table[ARTERIAL] = hexRgb(s.arterial);
  table[SECONDARY] = hexRgb(s.secondary);
  table[MINOR] = hexRgb(s.minor);
  return table;
}

/** 登记一个待回填像素；回填阶段直接读这张表 */
function mark(mask, p) {
  mask[p] = 1;
}

/**
 * 把「被同一种实色整圈包住的小块底色」登记成空洞。
 * 地名压在大片绿地或水面上时，字的白色描边圈就是这种小块底色。
 */
function markEnclosed(cls, width, height, mask) {
  const n = width * height;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const list = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (cls[start] !== BG || seen[start]) continue;
    let sp = 0;
    let area = 0;
    let touch = false;
    let minX = n;
    let maxX = -1;
    let minY = n;
    let maxY = -1;
    stack[sp++] = start;
    seen[start] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      list[area++] = p;
      const x = p % width;
      const y = (p - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touch = true;
      if (x > 0 && cls[p - 1] === BG && !seen[p - 1]) (seen[p - 1] = 1), (stack[sp++] = p - 1);
      if (x < width - 1 && cls[p + 1] === BG && !seen[p + 1]) (seen[p + 1] = 1), (stack[sp++] = p + 1);
      if (y > 0 && cls[p - width] === BG && !seen[p - width]) (seen[p - width] = 1), (stack[sp++] = p - width);
      if (y < height - 1 && cls[p + width] === BG && !seen[p + width]) (seen[p + width] = 1), (stack[sp++] = p + width);
    }
    if (touch || area > 1500 || Math.min(maxX - minX + 1, maxY - minY + 1) > 40) continue;
    for (let k = 0; k < area; k++) mark(mask, list[k]);
  }
}

/**
 * 回填待抹像素：先按 8 邻接把空洞聚成连通块，再看每块边界外侧是什么颜色。
 * 只有一种类别占到边界总数 60% 以上——也就是这块空洞基本被同一种颜色包住——才整块灌进去。
 * 于是压在绿地、水系上的地名会被长回来，散在路网之间的仍留在纸上，不会把路网越补越密。
 */
function heal(cls, mask, width, height) {
  const n = width * height;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const list = new Int32Array(n);
  const tally = new Int32Array(7);
  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    let m = 0;
    stack[sp++] = start;
    seen[start] = 1;
    tally.fill(0);
    while (sp > 0) {
      const p = stack[--sp];
      list[m++] = p;
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (mask[q]) {
            if (!seen[q]) {
              seen[q] = 1;
              stack[sp++] = q;
            }
          } else tally[cls[q]]++;
        }
      }
    }
    let total = 0;
    let best = BG;
    let bestN = 0;
    for (let t = BG; t <= DROP; t++) {
      total += tally[t];
      if (t >= WATER && t <= MINOR && tally[t] > bestN) {
        bestN = tally[t];
        best = t;
      }
    }
    if (bestN >= total * 0.6) for (let k = 0; k < m; k++) cls[list[k]] = best;
  }
}

/**
 * 绿地、水面上的地名带一圈白色描边，描边常把实色切开、和外头大片底色连成一体，
 * 于是「被围住的小块底色」那条判据根本认不出它是字。这里补一轮形态学闭运算：
 * 从底色像素往上下左右各探几步，只要两侧都在近距离内撞到同一种面状实色（绿地或水系），
 * 就说明这个点是陷在实色里的一条细缝，把它长回去。迭代几轮就能把描边缝连同笔画本身一起补掉。
 * 只认绿地和水系，路网之间零星的底色碰不到，图面不会被越补越密。
 */
function closeSolid(cls, width, height, { radius = 8, span = 6, passes = 3 } = {}) {
  const solid = (v) => v === GREEN || v === WATER;
  let src = cls;
  let dst = new Uint8Array(width * height);
  const hit = (x, y, dx, dy) => {
    for (let step = 1; step <= radius; step++) {
      const xx = x + dx * step;
      const yy = y + dy * step;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) return null;
      const v = src[yy * width + xx];
      if (v !== BG) return step;
    }
    return null;
  };
  for (let t = 0; t < passes; t++) {
    dst.set(src);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const p = row + x;
        if (src[p] !== BG) continue;
        const u = hit(x, y, 0, -1);
        const v = u === null ? null : src[(y - u) * width + x];
        if (v !== null && solid(v)) {
          const d = hit(x, y, 0, 1);
          if (d !== null && src[(y + d) * width + x] === v && u + d <= span) {
            dst[p] = v;
            continue;
          }
        }
        const l = hit(x, y, -1, 0);
        const w = l === null ? null : src[row + x - l];
        if (w !== null && solid(w)) {
          const r = hit(x, y, 1, 0);
          if (r !== null && src[row + x + r] === w && l + r <= span) dst[p] = w;
        }
      }
    }
    const swap = src;
    src = dst;
    dst = swap;
  }
  if (src !== cls) cls.set(src);
}

/**
 * 原地处理一块瓦片像素。
 * minArea：不贴瓦片边缘的小块直接抹掉——地名文字、图标、铁路短划线都在这里被清掉。
 * 贴边的块用 edgeMinArea，避免把跨瓦片的路网拦腰截断。
 */
export function artify(data, width, height, styleKey = 'amber', opts = {}) {
  const { minArea = 50, edgeMinArea = 12, smooth = true } = opts;
  const n = width * height;
  const cls = new Uint8Array(n);
  const holeMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    cls[i] = classify(data[o], data[o + 1], data[o + 2]);
    if (cls[i] === DROP) mark(holeMask, i);
  }

  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const list = new Int32Array(n);
  for (let c = WATER; c <= MINOR; c++) {
    for (let start = 0; start < n; start++) {
      if (cls[start] !== c || seen[start]) continue;
      let sp = 0;
      let area = 0;
      let touch = false;
      let minX = n;
      let maxX = -1;
      let minY = n;
      let maxY = -1;
      stack[sp++] = start;
      seen[start] = 1;
      while (sp > 0) {
        const p = stack[--sp];
        list[area++] = p;
        const x = p % width;
        const y = (p - x) / width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touch = true;
        if (x > 0 && cls[p - 1] === c && !seen[p - 1]) (seen[p - 1] = 1), (stack[sp++] = p - 1);
        if (x < width - 1 && cls[p + 1] === c && !seen[p + 1]) (seen[p + 1] = 1), (stack[sp++] = p + 1);
        if (y > 0 && cls[p - width] === c && !seen[p - width]) (seen[p - width] = 1), (stack[sp++] = p - width);
        if (y < height - 1 && cls[p + width] === c && !seen[p + width]) (seen[p + width] = 1), (stack[sp++] = p + width);
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const short = Math.min(bw, bh);
      /* 路牌徽标与 POI 图标：小而方、且几乎填满自己的包围盒。
         细长路段长宽比大、路口填充率低，都不会被这条误伤。 */
      const badge = area < 1200 && bw <= 56 && bh <= 40 && short >= 6 && Math.max(bw, bh) <= short * 3.2 && area > bw * bh * 0.45;
      if (!badge && area >= (touch ? edgeMinArea : minArea)) continue;
      for (let k = 0; k < area; k++) {
        cls[list[k]] = BG;
        mark(holeMask, list[k]);
      }
    }
  }

  markEnclosed(cls, width, height, holeMask);
  heal(cls, holeMask, width, height);
  /* 残留的 DROP 和底色最终都落纸色，先归一，免得闭运算的探针被深色笔画挡住 */
  for (let i = 0; i < n; i++) if (cls[i] === DROP) cls[i] = BG;
  /* 先缝住描边豁开的那几像素细缝，再回头看一遍：豁口一断，压在实色上的整块字和图标就成孤岛了 */
  closeSolid(cls, width, height);
  markEnclosed(cls, width, height, holeMask);
  heal(cls, holeMask, width, height);

  const pal = paletteOf(styleKey);
  const isInk = (v) => v >= WATER && v <= MINOR;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let rgb = pal[cls[i]];
    // 硬阈值分类会让路边呈锯齿：底色像素若与墨色相邻，就用两者中色补一圈过渡
    if (smooth && !isInk(cls[i])) {
      const x = i % width;
      const y = (i - x) / width;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let hits = 0;
      const take = (q) => {
        if (!isInk(cls[q])) return;
        const c = pal[cls[q]];
        sr += c[0];
        sg += c[1];
        sb += c[2];
        hits++;
      };
      if (x > 0) take(i - 1);
      if (x < width - 1) take(i + 1);
      if (y > 0) take(i - width);
      if (y < height - 1) take(i + width);
      if (hits) {
        const base = pal[BG];
        rgb = [
          Math.round((base[0] + sr / hits) / 2),
          Math.round((base[1] + sg / hits) / 2),
          Math.round((base[2] + sb / hits) / 2),
        ];
      }
    }
    data[o] = rgb[0];
    data[o + 1] = rgb[1];
    data[o + 2] = rgb[2];
    data[o + 3] = 255;
  }
  return data;
}
