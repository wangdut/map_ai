import test from 'node:test';
import assert from 'node:assert/strict';
import { frameRatio, fitFrame, MARGIN_RATIO } from '../src/export/tileprint.js';

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

test('取景框在任意容器尺寸与比例组合下都不溢出容器', () => {
  for (const [w, h] of VIEWS) {
    for (const R of RATIOS) {
      const r = frameRatio(R, true);
      const f = fitFrame(w, h, r);
      const maxW = Math.round(w * 0.62);
      const maxH = Math.round(h * 0.62);
      const label = `${w}x${h} @ ${R.toFixed(3)} → ${f.width}x${f.height}`;
      assert.ok(f.width <= maxW + 1 && f.height <= maxH + 1, `溢出：${label}`);
      assert.ok(f.left >= 0 && f.top >= 0, `跑出原点：${label}`);
      assert.ok(Math.abs(f.width / f.height - r) < 0.02, `比例走样：${label}`);
    }
  }
});

test('宽屏选 9:16 竖版时按高度收框，不再按宽度撑到屏幕外', () => {
  const r = frameRatio(9 / 16, true);
  const f = fitFrame(1920, 1080, r);
  assert.ok(f.width < f.height, `竖版应该高大于宽：${f.width}x${f.height}`);
  assert.ok(f.width < Math.round(1920 * 0.62), '竖版不该占满可用宽度');
  assert.ok(Math.abs(f.height - Math.round(1080 * 0.62)) <= 1, `高度应该顶到可用高度：${f.height}`);
});
