import { artify, STYLES } from './artstyle.js';
import { haversine } from '../geom/geo.js';

const TILE = 256;
const MAX_AMAP_ZOOM = 18;
const MAX_CANVAS_PX = 30_000_000;
const SUBS = ['1', '2', '3', '4'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const tileUrl = (z, x, y) =>
  `https://webrd0${SUBS[(Math.abs(x) + Math.abs(y)) % 4]}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}`;

/** 留白边宽度占成图长边的比例 */
export const MARGIN_RATIO = 0.055;

/**
 * 取景框是「内框」，成图还要在四周加留白，两者比例不同。
 * 这里按 外框 = 内框 + 两侧留白 反推内框比例，保证成图正好是用户选的比例。
 */
export function frameRatio(target, withMargin) {
  if (!withMargin) return target;
  const m = MARGIN_RATIO;
  return target >= 1 ? (target * (1 - 2 * m)) / (1 - 2 * m * target) : (target - 2 * m) / (1 - 2 * m);
}

/** 框顶那行「海报取景框」标签占的高度 */
export const TAG_ROOM = 26;

/**
 * 取景框矩形：在「真正看得见」的地图区域里画最大的 r 比例矩形，水平居中，绝不溢出容器。
 * top / bottom 是浮在地图上的界面（顶栏、状态栏）占掉的条——框压上去会被挡住，看不见框边也看不见那截构图；
 * 剩下的可用带再按 fill 留一点呼吸空间，框在带内垂直居中。
 * 容器比取景框"更宽"时受限的是高度（宽 = 高 × 比例），反之受限的是宽度——取两者里较小的那个。
 */
export function fitFrame(mapW, mapH, r, opts = {}) {
  const { top = TAG_ROOM, bottom = 0, fill = 0.94 } = opts;
  const band = Math.max(1, mapH - top - bottom);
  const gx = Math.round((mapW * (1 - fill)) / 2);
  const gy = Math.round((band * (1 - fill)) / 2);
  const availW = Math.max(1, mapW - gx * 2);
  const availH = Math.max(1, band - gy * 2);
  const width = Math.min(availW, Math.round(availH * r));
  const height = Math.round(width / r);
  return {
    left: Math.round((mapW - width) / 2),
    top: top + gy + Math.round((band - gy * 2 - height) / 2),
    width,
    height,
  };
}

/** 取景框（容器像素矩形）在当前视图下覆盖的地理范围 */
export function frameCorners(map, frame) {
  const nw = map.containerPointToLatLng([frame.left, frame.top]);
  const se = map.containerPointToLatLng([frame.left + frame.width, frame.top + frame.height]);
  return { nw, se };
}

/** 取景框覆盖范围的地面尺寸（公里），用来在界面上写「约 24 × 18 km」 */
export function frameSpan(map, frame) {
  const { nw, se } = frameCorners(map, frame);
  return {
    kmX: haversine([nw.lat, nw.lng], [nw.lat, se.lng]) / 1000,
    kmY: haversine([nw.lat, nw.lng], [se.lat, nw.lng]) / 1000,
  };
}

/**
 * 反推成图参数：目标长边像素 → 需要的缩放级 → 瓦片网格。
 * 瓦片数或画布面积超限时降一级重算，绝不靠放大插值冒充高清。
 */
export function planCapture(map, frame, targetLongEdge, opts = {}) {
  const { maxTiles = 420 } = opts;
  const { nw, se } = frameCorners(map, frame);
  const lngSpan = Math.abs(se.lng - nw.lng) || 1e-6;
  const target = clamp(targetLongEdge, 600, 8000);
  const measure = (z) => {
    const a = map.project(nw, z);
    const b = map.project(se, z);
    return { a, b, w: b.x - a.x, h: b.y - a.y };
  };
  let z = clamp(Math.ceil(Math.log2((target * 360) / (lngSpan * TILE))), 1, MAX_AMAP_ZOOM);
  let m = measure(z);
  let width = Math.round(m.w);
  let height = Math.round(m.h);
  let grid;
  for (;;) {
    const x0 = Math.floor(m.a.x / TILE);
    const y0 = Math.floor(m.a.y / TILE);
    grid = { x0, y0, x1: Math.floor((m.b.x - 1) / TILE), y1: Math.floor((m.b.y - 1) / TILE) };
    grid.count = (grid.x1 - x0 + 1) * (grid.y1 - y0 + 1);
    if ((grid.count <= maxTiles && width * height <= MAX_CANVAS_PX) || z <= 1) break;
    m = measure(--z);
    width = Math.round(m.w);
    height = Math.round(m.h);
  }
  return {
    z,
    minX: m.a.x,
    minY: m.a.y,
    width,
    height,
    ...grid,
    cols: grid.x1 - grid.x0 + 1,
    rows: grid.y1 - grid.y0 + 1,
    dx: m.a.x - grid.x0 * TILE,
    dy: m.a.y - grid.y0 * TILE,
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('瓦片加载失败'));
    img.src = url;
  });
}

/** 并发抓取 + 逐块艺术化。限流是为了不把瓦片 CDN 打成雪崩式失败 */
async function eachTile(plan, sink, { concurrency = 6, onProgress } = {}) {
  const jobs = [];
  for (let y = plan.y0; y <= plan.y1; y++) for (let x = plan.x0; x <= plan.x1; x++) jobs.push([x, y]);
  let done = 0;
  let failed = 0;
  let cursor = 0;
  async function worker() {
    const scratch = document.createElement('canvas');
    scratch.width = TILE;
    scratch.height = TILE;
    const sctx = scratch.getContext('2d', { willReadFrequently: true });
    while (cursor < jobs.length) {
      const [x, y] = jobs[cursor++];
      let img = null;
      for (let attempt = 0; attempt < 2 && !img; attempt++) {
        try {
          img = await loadImage(tileUrl(plan.z, x, y));
        } catch {
          await new Promise((r) => setTimeout(r, 220));
        }
      }
      if (img) {
        sctx.clearRect(0, 0, TILE, TILE);
        sctx.drawImage(img, 0, 0);
        const data = sctx.getImageData(0, 0, TILE, TILE);
        artify(data.data, TILE, TILE, sink.style, sink.artOptions);
        sctx.putImageData(data, 0, 0);
        sink.draw(scratch, (x - plan.x0) * TILE - plan.dx, (y - plan.y0) * TILE - plan.dy);
      } else failed++;
      done++;
      onProgress?.(done, jobs.length, failed);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return failed;
}

/** GeoJSON Polygon/MultiPolygon → 画布像素路径 */
function traceGeometry(map, ctx, geometry, plan) {
  const polys =
    geometry.type === 'MultiPolygon' ? geometry.coordinates : geometry.type === 'Polygon' ? [geometry.coordinates] : [];
  for (const poly of polys) {
    for (const ring of poly) {
      if (ring.length < 3) continue;
      ring.forEach(([lng, lat], i) => {
        const p = map.project([lat, lng], plan.z);
        if (i === 0) ctx.moveTo(p.x - plan.minX, p.y - plan.minY);
        else ctx.lineTo(p.x - plan.minX, p.y - plan.minY);
      });
      ctx.closePath();
    }
  }
  return polys.length > 0;
}

export function drawBoundaries(map, ctx, geometries, plan, { color, width, alpha = 1 }) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  for (const g of geometries) {
    ctx.beginPath();
    if (traceGeometry(map, ctx, g, plan)) ctx.stroke();
  }
  ctx.restore();
}

/** 沿城市轮廓裁切：轮廓之外的地图像素挖成透明，露出底下的留白 */
function clipTo(map, canvas, geometries, plan) {
  const mask = document.createElement('canvas');
  mask.width = canvas.width;
  mask.height = canvas.height;
  const mctx = mask.getContext('2d');
  mctx.fillStyle = '#fff';
  mctx.beginPath();
  for (const g of geometries) traceGeometry(map, mctx, g, plan);
  mctx.fill('evenodd');
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const octx = out.getContext('2d');
  octx.drawImage(canvas, 0, 0);
  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(mask, 0, 0);
  return out;
}

/** 可选字体：只列各平台都有的家族，靠 fallback 兜底，不引外部字体 */
export const FONTS = {
  sans: { label: '无衬线', stack: '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif' },
  song: { label: '宋体', stack: '"Songti SC", SimSun, "Noto Serif CJK SC", Georgia, serif' },
  kai: { label: '楷体', stack: '"Kaiti SC", KaiTi, STKaiti, "Microsoft YaHei", serif' },
  hei: { label: '黑体', stack: 'SimHei, "Heiti SC", "Microsoft YaHei", Arial, sans-serif' },
};

/** 默认字号：占成图长边的比例 */
export const TITLE_SIZE_RATIO = 0.062;
export const SUB_SIZE_RATIO = 0.0155;

const fontStack = (key) => (FONTS[key] || FONTS.sans).stack;

/** 逐字排版，用自算字距——canvas 的 letterSpacing 不是到处都有 */
function trackedWidth(ctx, text, spacing) {
  const chars = [...String(text)];
  return chars.reduce((a, c) => a + ctx.measureText(c).width, 0) + spacing * Math.max(0, chars.length - 1);
}

function drawTracked(ctx, text, cx, y, spacing, stroke = false) {
  const chars = [...String(text)];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  let x = cx - total / 2;
  chars.forEach((c, i) => {
    const gx = x + widths[i] / 2;
    if (stroke) ctx.strokeText(c, gx, y);
    else ctx.fillText(c, gx, y);
    x += widths[i] + spacing;
  });
  return total;
}

/** 版式：留白边 + 细内框 + 底部居中的大字标题组 */
function layout(canvas, style, opts) {
  const s = STYLES[style] || STYLES.amber;
  const longEdge = Math.max(canvas.width, canvas.height);
  const margin = opts.margin ? Math.round((longEdge * MARGIN_RATIO) / (1 - 2 * MARGIN_RATIO)) : 0;
  const out = document.createElement('canvas');
  out.width = canvas.width + margin * 2;
  out.height = canvas.height + margin * 2;
  const ctx = out.getContext('2d');
  ctx.fillStyle = s.paper;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, margin, margin);

  if (opts.frameLine) {
    ctx.strokeStyle = s.line;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(1, longEdge / 2400);
    const inset = margin + Math.round(longEdge * 0.012);
    ctx.strokeRect(inset, inset, out.width - inset * 2, out.height - inset * 2);
    ctx.globalAlpha = 1;
  }

  const title = String(opts.title ?? '').trim();
  const sub = String(opts.subtitle ?? '').trim().toUpperCase();
  if (title || sub) {
    const cx = out.width / 2;
    const tSize = Math.round(longEdge * (opts.titleRatio || TITLE_SIZE_RATIO));
    const sSize = Math.round(longEdge * (opts.subRatio || SUB_SIZE_RATIO));
    const bottom = out.height - margin;
    const tBase = bottom - Math.round(longEdge * 0.085);
    const sBase = title ? tBase + Math.round(tSize * 0.74) : bottom - Math.round(longEdge * 0.05);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    const line = ({ text, y, px, weight, family, color, track, haloRatio, alpha = 1 }) => {
      const spacing = px * track;
      ctx.font = `${weight} ${px}px ${family}`;
      const width = trackedWidth(ctx, text, spacing);
      /* 字面先描一圈纸色高亮再落墨：底图再花也读得出字，且不像整块底板那样在留白处留下印子 */
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = s.paper;
      ctx.lineWidth = Math.round(px * haloRatio);
      drawTracked(ctx, text, cx, y, spacing, true);
      ctx.fillStyle = color;
      drawTracked(ctx, text, cx, y, spacing);
      ctx.globalAlpha = 1;
      return width;
    };

    if (title) {
      const tw = line({
        text: title,
        y: tBase,
        px: tSize,
        weight: 700,
        family: fontStack(opts.titleFont),
        color: opts.titleColor || s.ink,
        track: 0.2,
        haloRatio: 0.13,
      });
      const half = Math.round(Math.min(longEdge * 0.045, tw * 0.35));
      ctx.strokeStyle = opts.titleColor || s.line;
      ctx.lineWidth = Math.max(1, longEdge / 2600);
      ctx.beginPath();
      ctx.moveTo(cx - half, tBase + Math.round(tSize * 0.3));
      ctx.lineTo(cx + half, tBase + Math.round(tSize * 0.3));
      ctx.stroke();
    }
    if (sub) {
      line({
        text: sub,
        y: sBase,
        px: sSize,
        weight: 500,
        family: fontStack(opts.subFont),
        color: opts.subColor || s.ink,
        track: 0.42,
        haloRatio: 0.22,
        alpha: opts.subColor ? 1 : 0.9,
      });
    }
  }
  return out;
}

/**
 * 生成海报画布。opts：{ frame, target, style, title, subtitle, margin, frameLine,
 * boundaries, clip, onProgress,
 * titleFont, titleRatio, titleColor, subFont, subRatio, subColor }
 * 字号用「占成图长边的比例」，字色留 null 表示跟随配色的墨色。
 */
export async function renderPoster(map, opts) {
  const plan = planCapture(map, opts.frame, opts.target);
  const s = STYLES[opts.style] || STYLES.amber;
  const layer = document.createElement('canvas');
  layer.width = plan.width;
  layer.height = plan.height;
  const ctx = layer.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = s.paper;
  ctx.fillRect(0, 0, layer.width, layer.height);

  const failed = await eachTile(
    plan,
    {
      style: opts.style,
      artOptions: opts.artOptions,
      draw: (c, x, y) => ctx.drawImage(c, x, y),
    },
    { onProgress: opts.onProgress },
  );

  const out = document.createElement('canvas');
  out.width = plan.width;
  out.height = plan.height;
  const octx = out.getContext('2d');
  octx.drawImage(opts.clip?.length ? clipTo(map, layer, opts.clip, plan) : layer, 0, 0);
  if (opts.boundaries?.length) {
    drawBoundaries(map, octx, opts.boundaries, plan, {
      color: s.line,
      width: Math.max(1.2, plan.width / 1600),
      alpha: 0.85,
    });
  }
  return { canvas: layout(out, opts.style, opts), plan, failed };
}
