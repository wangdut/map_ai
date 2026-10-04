import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, artify, STYLES } from '../src/export/artstyle.js';

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const WANT = { bg: 0, water: 1, green: 2, arterial: 3, secondary: 4, minor: 5, drop: 6 };

test('实测瓦色能正确归类', () => {
  const cases = [
    ['#fcf9f2', 'bg'], // 瓦片底色
    ['#fdfdfd', 'bg'], // 道路白描边 → 抹平
    ['#a4cdff', 'water'],
    ['#73b2f4', 'water'],
    ['#d8e7ee', 'water'],
    ['#c9e59e', 'green'],
    ['#ffa45c', 'arterial'],
    ['#f68121', 'arterial'],
    ['#f1d05f', 'secondary'],
    ['#f8d392', 'secondary'],
    ['#e3ded4', 'minor'],
    ['#dfdacf', 'minor'],
    ['#eeebe6', 'minor'],
    ['#4e4f52', 'drop'], // 地名文字
    ['#4c4d50', 'drop'],
  ];
  for (const [hex, want] of cases) {
    assert.equal(classify(...hexRgb(hex)), WANT[want], `${hex} 应为 ${want}`);
  }
});

/** 造一块 64×64 的假瓦片：一条横贯的主干道 + 一条通顶的水系 + 一小块假文字 + 几个深色字 */
function fakeTile() {
  const w = 64;
  const h = 64;
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, hex) => {
    const [r, g, b] = hexRgb(hex);
    const o = (y * w + x) * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, '#fcf9f2');
  for (let x = 0; x < w; x++) for (let t = 0; t < 3; t++) put(x, 30 + t, '#ffa45c'); // 贴左右边
  for (let y = 0; y < h; y++) for (let t = 0; t < 3; t++) put(50 + t, y, '#a4cdff'); // 贴上下边
  for (let x = 8; x < 13; x++) for (let y = 8; y < 12; y++) put(x, y, '#ffa45c'); // 5×4=20 px 假图标
  for (let x = 20; x < 24; x++) put(x, 45, '#4e4f52'); // 深色文字
  return { w, h, data };
}

test('长条路网与水系保留，小块图标与深色文字抹成底色', () => {
  const t = fakeTile();
  artify(t.data, t.w, t.h, 'amber');
  const paper = hexRgb(STYLES.amber.paper);
  const arterial = hexRgb(STYLES.amber.arterial);
  const water = hexRgb(STYLES.amber.water);
  const px = (x, y) => {
    const o = (y * t.w + x) * 4;
    return [t.data[o], t.data[o + 1], t.data[o + 2]];
  };
  assert.deepEqual(px(32, 31), arterial, '贯穿全幅的主干道应保留');
  assert.deepEqual(px(51, 20), water, '通顶通底的水系应保留');
  assert.deepEqual(px(10, 9), paper, '20 px 的小色块（图标/文字）应被抹掉');
  assert.deepEqual(px(22, 44), paper, '深色文字上方应变成底色');
  assert.deepEqual(px(22, 46), paper, '深色文字下方应变成底色');
});

test('路牌徽标被抹掉，细长路段与大块绿地保留', () => {
  const w = 96;
  const h = 96;
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, hex) => {
    const [r, g, b] = hexRgb(hex);
    const o = (y * w + x) * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, '#fcf9f2');
  for (let x = 10; x < 34; x++) for (let y = 10; y < 22; y++) put(x, y, '#a4cdff'); // 24×12 徽标
  for (let x = 0; x < 30; x++) for (let y = 40; y < 44; y++) put(x, y, '#ffa45c'); // 30×4 直路段
  for (let x = 20; x < 80; x++) for (let y = 60; y < 92; y++) put(x, y, '#c9e59e'); // 大块绿地
  artify(data, w, h, 'amber');
  const px = (x, y) => {
    const o = (y * w + x) * 4;
    return [data[o], data[o + 1], data[o + 2]];
  };
  assert.deepEqual(px(20, 15), hexRgb(STYLES.amber.paper), '实心方形徽标应被抹掉');
  assert.deepEqual(px(10, 42), hexRgb(STYLES.amber.arterial), '细长路段虽短但长宽比大，应保留');
  assert.deepEqual(px(50, 76), hexRgb(STYLES.amber.green), '大块绿地应保留');
});

test('绿地上的地名抹掉后被周围颜色回填，不留字形空洞', () => {
  const w = 64;
  const h = 64;
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, hex) => {
    const [r, g, b] = hexRgb(hex);
    const o = (y * w + x) * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, '#fcf9f2');
  for (let x = 10; x < 52; x++) for (let y = 10; y < 52; y++) put(x, y, '#c9e59e'); // 绿地
  for (let y = 20; y < 42; y++) {
    put(25, y, '#4e4f52'); // 2 px 宽的假字
    put(26, y, '#4e4f52');
  }
  artify(data, w, h, 'amber');
  const green = hexRgb(STYLES.amber.green);
  const px = (x, y) => {
    const o = (y * w + x) * 4;
    return [data[o], data[o + 1], data[o + 2]];
  };
  assert.deepEqual(px(25, 30), green, '笔画外侧应回填成绿地');
  assert.deepEqual(px(26, 30), green, '笔画内侧也应回填成绿地');
  assert.deepEqual(px(15, 15), green, '绿地本体不受影响');
});

test('地名连同一圈白色描边都被绿地颜色长回来', () => {
  const w = 64;
  const h = 64;
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, hex) => {
    const [r, g, b] = hexRgb(hex);
    const o = (y * w + x) * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, '#fcf9f2');
  for (let x = 8; x <= 56; x++) for (let y = 8; y <= 56; y++) put(x, y, '#c9e59e');
  for (let x = 23; x <= 41; x++) for (let y = 27; y <= 37; y++) put(x, y, '#fdfdfd'); // 描边
  for (let x = 24; x <= 40; x++) for (let y = 28; y <= 36; y++) put(x, y, '#4e4f52'); // 字形
  artify(data, w, h, 'amber');
  const green = hexRgb(STYLES.amber.green);
  const px = (x, y) => {
    const o = (y * w + x) * 4;
    return [data[o], data[o + 1], data[o + 2]];
  };
  assert.deepEqual(px(23, 32), green, '描边圈应被绿地覆盖');
  assert.deepEqual(px(32, 32), green, '字形中心应被绿地覆盖');
});

test('绿地上的地名豁口即使和外面底色连通也能长回来', () => {
  const w = 64;
  const h = 64;
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, hex) => {
    const [r, g, b] = hexRgb(hex);
    const o = (y * w + x) * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, '#fcf9f2');
  for (let x = 6; x <= 58; x++) for (let y = 6; y <= 58; y++) put(x, y, '#c9e59e');
  for (let x = 20; x <= 60; x++) for (let y = 30; y <= 32; y++) put(x, y, '#fdfdfd'); // 描边缝通到绿地外
  artify(data, w, h, 'amber');
  const green = hexRgb(STYLES.amber.green);
  const paper = hexRgb(STYLES.amber.paper);
  const px = (x, y) => {
    const o = (y * w + x) * 4;
    return [data[o], data[o + 1], data[o + 2]];
  };
  assert.deepEqual(px(30, 31), green, '缝心应被绿地合拢');
  assert.deepEqual(px(30, 30), green, '缝的上沿应被绿地合拢');
  assert.deepEqual(px(30, 32), green, '缝的下沿应被绿地合拢');
  assert.deepEqual(px(2, 31), paper, '绿地外的开阔底色不该被吃掉');
  assert.deepEqual(px(62, 31), paper, '连通到外面的底色本体保持底色');
});

test('绿地里的图标靠一条细缝连着外面底色时，缝先合上、图标再长回绿地', () => {
  const w = 64;
  const h = 64;
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, hex) => {
    const [r, g, b] = hexRgb(hex);
    const o = (y * w + x) * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, '#fcf9f2');
  for (let x = 6; x <= 58; x++) for (let y = 6; y <= 58; y++) put(x, y, '#c9e59e');
  for (let x = 30; x <= 43; x++) for (let y = 24; y <= 37; y++) put(x, y, '#fdfdfd'); // 14×14 图标
  for (let x = 44; x <= 60; x++) for (let y = 30; y <= 31; y++) put(x, y, '#fdfdfd'); // 2 px 豁口通到绿地外
  artify(data, w, h, 'amber');
  const green = hexRgb(STYLES.amber.green);
  const paper = hexRgb(STYLES.amber.paper);
  const px = (x, y) => {
    const o = (y * w + x) * 4;
    return [data[o], data[o + 1], data[o + 2]];
  };
  assert.deepEqual(px(50, 30), green, '豁口那条细缝应先合上');
  assert.deepEqual(px(36, 30), green, '豁口一断，图标应整块长回绿地');
  assert.deepEqual(px(32, 26), green, '图标边角也应长回绿地');
  assert.deepEqual(px(62, 30), paper, '绿地外的底色保持底色');
  assert.deepEqual(px(2, 2), paper, '图幅角落的开阔底色不受影响');
});

test('贴边的碎块仍会保留，避免跨瓦片的路网被截断', () => {
  const w = 64;
  const h = 64;
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, hex) => {
    const [r, g, b] = hexRgb(hex);
    const o = (y * w + x) * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, '#fcf9f2');
  for (let y = 0; y < 4; y++) put(0, y, '#ffa45c'); // 只贴左边、面积 4 的路段
  artify(data, w, h, 'amber', { minArea: 50, edgeMinArea: 2 });
  const o = (1 * w + 0) * 4;
  assert.deepEqual([data[o], data[o + 1], data[o + 2]], hexRgb(STYLES.amber.arterial));
});

test('每一块像素都被写满且不透明', () => {
  const t = fakeTile();
  artify(t.data, t.w, t.h, 'night');
  for (let i = 3; i < t.data.length; i += 4) assert.equal(t.data[i], 255);
});

test('每套配色字段齐全且互不撞色，任何一套都能完整重着色', () => {
  const fields = ['paper', 'water', 'green', 'arterial', 'secondary', 'minor', 'line', 'ink', 'marker'];
  const keys = Object.keys(STYLES);
  assert.ok(keys.length >= 7, `配色至少 7 套，实际 ${keys.length}`);
  for (const k of keys) {
    const s = STYLES[k];
    for (const f of fields) assert.match(s[f], /^#[0-9a-f]{6}$/i, `${k}.${f} 不是合法 hex`);
    const inks = ['water', 'green', 'arterial', 'secondary', 'minor'].map((f) => s[f]);
    assert.equal(new Set(inks).size, inks.length, `${k}：五类墨色里有撞色的，图面会分不清`);
    assert.notEqual(s.paper, s.arterial, `${k}：主干道与底色同色，路网会消失`);
    assert.notEqual(s.marker, s.paper, `${k}：标记与底色同色，看不见`);
    assert.notEqual(s.marker, s.arterial, `${k}：标记与主干道同色，会被当成路网`);
    assert.notEqual(s.marker, s.water, `${k}：标记与水系同色，落在江面上就没了`);
    const t = fakeTile();
    artify(t.data, t.w, t.h, k);
    for (let i = 0; i < t.data.length; i++) assert.ok(Number.isInteger(t.data[i]), `${k} 重着色后出现非整数值`);
  }
});
