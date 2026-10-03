import test from 'node:test';
import assert from 'node:assert/strict';
import { frameRatio, MARGIN_RATIO } from '../src/export/tileprint.js';

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
