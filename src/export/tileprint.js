import { artify, STYLES } from './artstyle.js';
import { haversine } from '../geom/geo.js';

const TILE = 256;
const MAX_AMAP_ZOOM = 18;
const MAX_CANVAS_PX = 45_000_000;
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

/** 清晰度档位说的是「成图（含留白）长边像素」，这里换算成内框长边 */
export function innerLongEdge(targetLongEdge, withMargin) {
  return Math.round(clamp(targetLongEdge, 600, 8000) * (withMargin ? 1 - 2 * MARGIN_RATIO : 1));
}

/**
 * 原生抓取之后真正交付的成图尺寸。
 * z 只能取整数，抓到的原生像素往往是档位的 1~2 倍，所以按档位精确降采样——降采样不丢信息，
 * 反过来若原生像素不够（被瓦片数或画布面积压下了 z）就绝不放大冒充高清，原样交付并标出 capped。
 */
export function posterDims(plan, innerPx, withMargin) {
  const native = Math.max(plan.width, plan.height);
  const scale = Math.min(1, innerPx / native);
  const w = Math.round(plan.width * scale);
  const h = Math.round(plan.height * scale);
  const m = withMargin ? Math.round((Math.max(w, h) * MARGIN_RATIO) / (1 - 2 * MARGIN_RATIO)) : 0;
  return { width: w + m * 2, height: h + m * 2, scale, capped: native < innerPx };
}

/**
 * 地理点 → 成图上的像素（已按降采样比例缩过）。
 * inside 为 false 表示这点落在取景框外，画出来会跑到留白里，界面上要提前拦掉。
 */
export function markerPoint(map, latlng, plan, scale) {
  const p = map.project(latlng, plan.z);
  const x = (p.x - plan.minX) * scale;
  const y = (p.y - plan.minY) * scale;
  return { x, y, inside: x >= 0 && y >= 0 && x <= plan.width * scale && y <= plan.height * scale };
}

/**
 * 反推抓取参数：内框长边像素 → 需要的整数缩放级 → 瓦片网格。
 * 瓦片数或画布面积超限时降一级重算；原生像素只会多不会少，缺的部分由 posterDims 判定，不靠插值补。
 */
export function planCapture(map, frame, innerPx, opts = {}) {
  const { maxTiles = 600 } = opts;
  const { nw, se } = frameCorners(map, frame);
  const lngSpan = Math.abs(se.lng - nw.lng) || 1e-6;
  // 墨卡托在局部是等比的，所以原生像素的长短边和取景框的长短边落在同一根轴上
  const wantW = Math.max(1, innerPx * (frame.width / Math.max(frame.width, frame.height)));
  const measure = (z) => {
    const a = map.project(nw, z);
    const b = map.project(se, z);
    return { a, b, w: b.x - a.x, h: b.y - a.y };
  };
  let z = clamp(Math.ceil(Math.log2((wantW * 360) / (lngSpan * TILE))), 1, MAX_AMAP_ZOOM);
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

/** 沿城市轮廓裁切：用 destination-in 原地把轮廓之外的像素挖成透明，露出底下的留白，不再多开一张同尺寸画布 */
function clipTo(map, canvas, geometries, plan) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = '#000';
  ctx.beginPath();
  for (const g of geometries) traceGeometry(map, ctx, g, plan);
  ctx.fill('evenodd');
  ctx.restore();
  return canvas;
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

/** 位置标记符号：都以「那个点」为几何中心，针形例外——它的尖对准点，符合地图针的读法 */
export const MARKERS = {
  star: { label: '五角星' },
  dot: { label: '圆点' },
  ring: { label: '靶心' },
  diamond: { label: '菱形' },
  pin: { label: '定位针' },
};

/** 符号直径默认占成图长边的比例：6000 px 的巨幅上也只有 132 px，不喧宾夺主 */
export const MARKER_SIZE_RATIO = 0.022;

function markerPath(ctx, shape, x, y, r) {
  ctx.beginPath();
  if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r * 0.44 : r;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else if (shape === 'diamond') {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.72, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r * 0.72, y);
    ctx.closePath();
  } else if (shape === 'pin') {
    /* 针尖落在点上，圆头朝上——地图针的读法就是尖指着位置，不是中心指着位置 */
    const cr = r * 0.66;
    const cy = y - r * 1.32;
    const a = Math.asin(Math.min(1, cr / (y - cy)));
    ctx.moveTo(x, y);
    ctx.arc(x, cy, cr, Math.PI - a, a);
    ctx.closePath();
    return { hx: x, hy: cy, hr: cr };
  } else {
    ctx.arc(x, y, r * (shape === 'dot' ? 0.8 : 0.92), 0, Math.PI * 2);
  }
  return null;
}

/** 沿轮廓垫一圈纸色再落色：底图再密也读得出这个点，且不用整块底板 */
function drawMarker(ctx, shape, x, y, r, color, paper) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = paper;
  ctx.lineWidth = Math.max(1.5, r * 0.55);
  const head = markerPath(ctx, shape, x, y, r);
  ctx.stroke();
  if (shape === 'ring') {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, r * 0.34);
    markerPath(ctx, shape, x, y, r);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = color;
    markerPath(ctx, shape, x, y, r);
    ctx.fill();
    if (head) {
      ctx.fillStyle = paper;
      ctx.beginPath();
      ctx.arc(head.hx, head.hy, head.hr * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
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

  if (opts.marker) {
    const m = opts.marker;
    drawMarker(
      ctx,
      m.shape,
      m.x + margin,
      m.y + margin,
      // sizeRatio 说的是直径，markerPath 里的 r 是外沿半径
      Math.max(3, (longEdge * (m.sizeRatio || MARKER_SIZE_RATIO)) / 2),
      m.color || s.marker,
      s.paper,
    );
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

/** 降采样到档位声明的尺寸：多抓的那一截正好当超采样用，边缘更干净；不足则原样交付，不放大 */
function resample(canvas, scale) {
  if (scale >= 1) return canvas;
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

/**
 * 生成海报画布。opts：{ frame, target, style, title, subtitle, margin, frameLine,
 * boundaries, clip, marker, onProgress,
 * titleFont, titleRatio, titleColor, subFont, subRatio, subColor }
 * marker 是 { latlng, shape, sizeRatio, color }，落在取景框外时不画，返回值里 markerOut 为 true。
 * target 是成图（含留白）长边像素；字号用「占成图长边的比例」，字色留 null 表示跟随配色的墨色。
 */
export async function renderPoster(map, opts) {
  const inner = innerLongEdge(opts.target, opts.margin);
  const plan = planCapture(map, opts.frame, inner);
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

  const mapCanvas = opts.clip?.length ? clipTo(map, layer, opts.clip, plan) : layer;
  if (opts.boundaries?.length) {
    drawBoundaries(map, mapCanvas.getContext('2d'), opts.boundaries, plan, {
      color: s.line,
      width: Math.max(1.2, plan.width / 1600),
      alpha: 0.85,
    });
  }
  const dims = posterDims(plan, inner, opts.margin);
  const scaled = resample(mapCanvas, dims.scale);
  if (scaled !== mapCanvas) {
    mapCanvas.width = 0;
    mapCanvas.height = 0;
  }
  let marker = null;
  let markerOut = false;
  if (opts.marker?.latlng) {
    const p = markerPoint(map, opts.marker.latlng, plan, dims.scale);
    markerOut = !p.inside;
    marker = p.inside ? { ...opts.marker, x: p.x, y: p.y } : null;
  }
  return { canvas: layout(scaled, opts.style, { ...opts, marker }), plan, dims, failed, marker, markerOut };
}
