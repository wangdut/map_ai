import test from 'node:test';
import assert from 'node:assert/strict';
import { granularityOptions, descendantsOf, GRAN_DEPTH, LADDER } from '../src/data/admin-tree.js';
import { shortName } from '../src/data/admin-index.js';

const values = (level) => granularityOptions(level).map((o) => `${o.value}${o.disabled ? '×' : ''}`);

test('省：能选到下级市与下两级区县，街道不在省的可选项里', () => {
  assert.deepEqual(values('province'), ['self', 'd1', 'd2']);
  assert.deepEqual(
    granularityOptions('province').map((o) => o.label),
    ['仅本级（省）', '下级市', '下两级区县'],
  );
});

test('市：下级区县可选，下级乡镇街道必须置灰（实测无轮廓）', () => {
  assert.deepEqual(values('city'), ['self', 'd1', 'street×']);
  const street = granularityOptions('city').find((o) => o.value === 'street');
  assert.ok(street.disabled);
  assert.match(street.hint, /街道级拿不到轮廓/);
});

test('区县：唯一下级就是乡镇街道，因此整级不可选', () => {
  assert.deepEqual(values('district'), ['self', 'street×']);
});

test('国家级往下两级仍是市，乡镇街道级没有任何下级', () => {
  assert.deepEqual(values('country'), ['self', 'd1', 'd2']);
  assert.deepEqual(
    granularityOptions('country').map((o) => o.label),
    ['仅本级（国家）', '下级省', '下两级市'],
  );
  assert.deepEqual(values('street'), ['self']);
});

test('还没选区域时给出通用说法，且不含置灰项', () => {
  assert.deepEqual(values(undefined), ['self', 'd1', 'd2']);
});

test('粒度值与向下层数一一对应', () => {
  assert.deepEqual(GRAN_DEPTH, { self: 0, d1: 1, d2: 2 });
  assert.equal(LADDER.at(-1), 'street');
});

/** 免 key 时走 DataV 逐层递归；这条覆盖递归本身（几何不能在中途丢掉） */
test('DataV 递归取子区：省→市、市→区县、省→下两级区县（无网络则跳过）', async (t) => {
  const GD = { adcode: '440000', name: '广东省', level: 'province' };
  const GZ = { adcode: '440100', name: '广州市', level: 'city' };
  let cities;
  try {
    cities = await descendantsOf(GD, 1);
  } catch (e) {
    return t.skip(`DataV 不可达：${e.message}`);
  }
  const shaped = (list) => list.every((k) => k.geometry?.coordinates?.length && k.adcode && k.name);
  assert.equal(cities.length, 21, `广东省应有 21 个地级市，实际 ${cities.length}`);
  assert.ok(shaped(cities), '每个市都要带几何');
  assert.ok(cities.every((k) => k.centroid && k.centroid[0] > 20 && k.centroid[0] < 26), '质心是 [纬,经]');

  const districts = await descendantsOf(GZ, 1);
  assert.equal(districts.length, 11, `广州市应有 11 个区县，实际 ${districts.length}`);
  assert.ok(shaped(districts));
  assert.ok(districts.every((k) => k.parentAdcode === '440100'));

  const twoLevels = await descendantsOf(GD, 2);
  assert.equal(twoLevels.length, 122, `广东省下两级区县合计 122，实际 ${twoLevels.length}`);
  assert.ok(shaped(twoLevels));
  assert.equal(twoLevels[0].targetLevel, 'district');
});

/** 海报标题与副标题路径都用短名，削过头会把「曹县」写成「曹」 */
test('行政后缀不能削到只剩一个字', () => {
  assert.equal(shortName('曹县'), '曹县');
  assert.equal(shortName('丰县'), '丰县');
  assert.equal(shortName('沛县'), '沛县');
});

test('常规行政后缀照旧削掉', () => {
  assert.equal(shortName('天河区'), '天河');
  assert.equal(shortName('广州市'), '广州');
  assert.equal(shortName('广东省'), '广东');
  assert.equal(shortName('广西壮族自治区'), '广西');
  assert.equal(shortName('内蒙古自治区'), '内蒙古');
  assert.equal(shortName('神农架林区'), '神农架');
});
