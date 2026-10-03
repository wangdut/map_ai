import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, pathLength, ringArea, polygonArea, geometryArea, pointInGeometry, circleGeometry, radiusFromArea, formatArea } from '../src/geom/geo.js';
import { wgs2gcj, gcj2wgs } from '../src/geom/coortransform.js';

const R = 6371008.8;

test('球面面积公式对经纬网格严格精确', () => {
  const d = Math.PI / 180;
  const ring = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const exact = R * R * d * Math.sin(d);
  assert.ok(Math.abs(ringArea(ring) - exact) / exact < 1e-6, `面积误差过大：${ringArea(ring)} vs ${exact}`);
});

test('haversine 与公开数据一致（北京—上海约 1067 km）', () => {
  const d = haversine([39.9042, 116.4074], [31.2304, 121.4737]);
  assert.ok(d > 1_040_000 && d < 1_100_000, `得到 ${d}`);
  assert.equal(haversine([23.1, 113.3], [23.1, 113.3]), 0);
});

test('折线长度按段累加', () => {
  const a = [23.13, 113.36];
  const b = [23.14, 113.36];
  const c = [23.14, 113.38];
  assert.ok(Math.abs(pathLength([a, b, c]) - (haversine(a, b) + haversine(b, c))) < 1e-6);
});

test('点在面内判定，支持带洞多边形', () => {
  const geometry = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      [
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
      ],
    ],
  };
  assert.equal(pointInGeometry([5, 5], geometry), false, '洞内不应算命中');
  assert.equal(pointInGeometry([2, 2], geometry), true);
  assert.equal(pointInGeometry([11, 5], geometry), false);
});

test('MultiPolygon 面积相加、内环相减', () => {
  const outer = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const hole = [
    [0.5, 0.5],
    [0.6, 0.5],
    [0.6, 0.6],
    [0.5, 0.6],
  ];
  const single = ringArea(outer);
  const withHole = polygonArea([outer, hole], false);
  assert.ok(single > 0 && withHole > 0);
  assert.ok(withHole < single && single - withHole < ringArea(hole) * 1.001);
});

test('等面积圆半径反推自洽', () => {
  const area = 8_200_000;
  const geo = circleGeometry([23.16, 113.38], radiusFromArea(area));
  const got = geometryArea(geo);
  assert.ok(Math.abs(got - area) / area < 0.01, `圆面积 ${got} 与目标 ${area} 偏差过大`);
});

test('WGS84 与 GCJ02 互转偏移合理且可逆', () => {
  const [lat, lng] = [23.16, 113.38];
  const [gLat, gLng] = wgs2gcj(lat, lng);
  const offset = haversine([lat, lng], [gLat, gLng]);
  assert.ok(offset > 100 && offset < 1200, `广州的偏移量异常：${offset} m`);
  const [backLat, backLng] = gcj2wgs(gLat, gLng);
  assert.ok(haversine([lat, lng], [backLat, backLng]) < 5, '往返转换误差应 < 5 m');
  assert.deepEqual(wgs2gcj(-33.86, 151.21), [-33.86, 151.21], '境外坐标应原样返回');
});

test('真实行政边界面积与公开数据吻合（免网络则跳过）', async (t) => {
  let gz;
  let gd;
  try {
    gz = await fetch('https://geo.datav.aliyun.com/areas_v3/bound/440100.json').then((r) => (r.ok ? r.json() : null));
    gd = await fetch('https://geo.datav.aliyun.com/areas_v3/bound/440000.json').then((r) => (r.ok ? r.json() : null));
  } catch {
    t.skip('无法访问 DataV 边界数据');
    return;
  }
  if (!gz || !gd) return t.skip('DataV 当前不可达');
  const areaOf = (fc) => geometryArea(fc.features[0].geometry) / 1e6;
  const gzArea = areaOf(gz);
  const gdArea = areaOf(gd);
  assert.ok(Math.abs(gzArea - 7434) / 7434 < 0.03, `广州市面积 ${gzArea} km² 偏离公开值 7434 km² 过多`);
  assert.ok(Math.abs(gdArea - 179800) / 179800 < 0.03, `广东省面积 ${gdArea} km² 偏离公开值 17.98 万 km² 过多`);
  assert.match(formatArea(gdArea * 1e6), /km²/);
});
