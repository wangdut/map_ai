import test from 'node:test';
import assert from 'node:assert/strict';
import { frameRatio, fitFrame, TAG_ROOM, planCapture, innerLongEdge, posterDims, MARGIN_RATIO } from '../src/export/tileprint.js';

/** 与 layout() 同一套留白公式：内框 + 两侧留白 = 成图 */
function outerRatio(innerW, innerH) {
  const m = Math.round((Math.max(innerW, innerH) * MARGIN_RATIO) / (1 - 2 * MARGIN_RATIO));
  return (innerW + m * 2) / (innerH + m * 2);
}

test('反推取景框比例后，成图正好等于所选比例', () => {
  const targets = [4 / 3, 16 / 9, 1, 3 / 4, 9 / 16, Math.SQRT2, 1 / Math.SQRT2];
  for (const R of targets) {
    const r = frameRatio(R, true);
    const innerH = Math.round(4000 / r);
    assert.ok(Math.abs(outerRatio(4000, innerH) - R) < 0.004, `${R} 实际 ${outerRatio(4000, innerH)}`);
  }
});

test('不留白边时取景框就是成图比例', () => {
  assert.equal(frameRatio(4 / 3, false), 4 / 3);
  assert.equal(frameRatio(9 / 16, false), 9 / 16);
});

const RATIOS = [4 / 3, 16 / 9, 1, 3 / 4, 9 / 16, Math.SQRT2, 1 / Math.SQRT2];
const VIEWS = [
  [1920, 1080],
  [1440, 900],
  [532, 622],
  [900, 1600],
  [1280, 1280],
];

test('取景框在任意容器尺寸与比例组合下都撑满可视地图且不溢出容器', () => {
  for (const [w, h] of VIEWS) {
    for (const R of RATIOS) {
      const r = frameRatio(R, true);
      const f = fitFrame(w, h, r);
      const label = `${w}x${h} @ ${R.toFixed(3)} → ${f.width}x${f.height} @${f.left},${f.top}`;
      assert.ok(f.left >= 0 && f.top >= TAG_ROOM, `跑出原点：${label}`);
      assert.ok(f.left + f.width <= w && f.top + f.height <= h, `溢出：${label}`);
      assert.ok(Math.abs(f.width / f.height - r) < 0.02, `比例走样：${label}`);
      // 最大内接：受限制的那一边必须顶到可用尺寸，不能整块缩成一小条
      assert.ok(f.width >= w * 0.88 || f.height >= (h - TAG_ROOM) * 0.88, `框太小：${label}`);
    }
  }
});

test('宽屏选 9:16 竖版时按高度撑满可视地图，不再缩成一小条', () => {
  const r = frameRatio(9 / 16, true);
  const f = fitFrame(1920, 1080, r);
  assert.ok(f.width < f.height, `竖版应该高大于宽：${f.width}x${f.height}`);
  assert.ok(f.height >= 1080 * 0.88, `高度该顶到可用高度：${f.height}`);
  assert.ok(f.top >= TAG_ROOM && f.top + f.height <= 1080, `框顶标签被裁或底部溢出：top=${f.top}`);
});

test('顶栏与状态栏浮在地图上时，取景框完全落在两者之间的可见带里', () => {
  const chrome = { top: 62 + TAG_ROOM, bottom: 30 };
  for (const R of RATIOS) {
    const f = fitFrame(1222, 730, frameRatio(R, true), chrome);
    assert.ok(f.top >= chrome.top, `压到顶栏：${R.toFixed(3)} → top=${f.top}`);
    assert.ok(f.top + f.height <= 730 - chrome.bottom, `压到状态栏：${R.toFixed(3)} → bottom=${f.top + f.height}`);
    assert.ok(f.height >= (730 - chrome.top - chrome.bottom) * 0.88 || f.width >= 1222 * 0.88, `框太小：${f.width}x${f.height}`);
  }
});

/** 墨卡托投影桩：planCapture 只用到 project 与 containerPointToLatLng，够驱动整条档位换算 */
const TILE = 256;
/** Leaflet 的 project 既收 LatLng 对象也收 [lat, lng] 数组，桩函数一样两种都认 */
const latlng = (p) => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : p);
const project = (p, z) => {
  const { lat, lng } = latlng(p);
  const world = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * world, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world };
};
const unproject = ({ x, y }, z) => {
  const world = TILE * 2 ** z;
  const n = Math.PI - 2 * Math.PI * (y / world);
  return {
    lat: (180 / Math.PI) * Math.atan(Math.sinh(n)),
    lng: (x / world) * 360 - 180,
  };
};
const stubMap = (center, zoom) => {
  const origin = project(center, zoom);
  return {
    project: (ll, z) => project(ll, z),
    containerPointToLatLng: ([px, py]) => unproject({ x: origin.x + px, y: origin.y + py }, zoom),
  };
};

const TIERS = [1600, 3000, 4500, 6000];

test('留白边时内框长边按 1-2×留白比例 缩回去', () => {
  assert.equal(innerLongEdge(3000, false), 3000);
  assert.equal(innerLongEdge(3000, true), Math.round(3000 * (1 - 2 * MARGIN_RATIO)));
  assert.equal(innerLongEdge(99999, true), Math.round(8000 * (1 - 2 * MARGIN_RATIO)), '超出 8000 的档位按 8000 封顶');
});

test('清晰度四档各自出图：长边正好是档位像素，且互不相同', () => {
  const map = stubMap([23.13, 113.26], 12);
  const frame = { left: 100, top: 60, width: 763, height: 572 };
  const rows = TIERS.map((t) => {
    const inner = innerLongEdge(t, true);
    const plan = planCapture(map, frame, inner);
    return { t, z: plan.z, tiles: plan.count, dims: posterDims(plan, inner, true) };
  });
  const zs = new Set(rows.map((r) => r.z));
  const sizes = new Set(rows.map((r) => `${r.dims.width}x${r.dims.height}`));
  assert.equal(sizes.size, 4, `四档尺寸应互不相同，实际 ${[...sizes].join(' / ')}`);
  assert.equal(zs.size, 3, `z 应随档位递增，实际 ${[...zs].join(',')}`);
  for (const r of rows) {
    assert.ok(!r.dims.capped, `${r.t} 档不该触顶（${r.tiles} 块瓦片）`);
    assert.ok(Math.abs(Math.max(r.dims.width, r.dims.height) - r.t) <= 2, `${r.t} 档实得 ${r.dims.width}x${r.dims.height}`);
    assert.ok(r.tiles <= 600, `${r.t} 档瓦片 ${r.tiles} 超上限`);
    assert.ok(r.z >= 1 && r.z <= 18);
  }
  // 档位越高抓得越细：z 不减、瓦片不减少
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].z >= rows[i - 1].z, 'z 随档位单调不减');
    assert.ok(rows[i].tiles >= rows[i - 1].tiles, '抓取量随档位单调不减');
  }
});

test('取景范围大到超出抓取上限时，按原生像素出图而不是放大冒充', () => {
  const map = stubMap([23.13, 113.26], 12);
  const frame = { left: 0, top: 0, width: 4000, height: 3000 };
  const inner = innerLongEdge(6000, true);
  const plan = planCapture(map, frame, inner);
  const dims = posterDims(plan, inner, true);
  assert.ok(dims.capped, '这组参数应该触顶');
  assert.equal(dims.scale, 1, '原生像素不够时不许放大');
  assert.ok(Math.max(dims.width, dims.height) < 6000, `不该冒充 6000，实得 ${dims.width}x${dims.height}`);
  assert.ok(plan.width * plan.height <= 45_000_000 && plan.count <= 600, '原生抓取必须落在上限内');
});
