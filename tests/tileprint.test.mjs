import test from 'node:test';
import assert from 'node:assert/strict';
import { frameRatio, fitFrame, TAG_ROOM, MARGIN_RATIO } from '../src/export/tileprint.js';

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
