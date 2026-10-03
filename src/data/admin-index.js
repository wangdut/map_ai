let items = null;
const byCode = new Map();

export const LEVEL_LABEL = {
  country: '国家',
  province: '省级',
  city: '地级市',
  district: '区县级',
};

export async function loadAdminIndex() {
  if (items) return items;
  const res = await fetch('data/admin-index.json');
  if (!res.ok) throw new Error('行政区划索引缺失，请先运行 node scripts/build-admin-index.mjs');
  const json = await res.json();
  items = json.items;
  items.forEach((i) => byCode.set(i.c, i));
  return items;
}

export function findAdmin(code) {
  return byCode.get(String(code)) || null;
}

const norm = (s) => (s || '').replace(/\s+/g, '').toLowerCase();
const SUFFIX = /(省|市|区|县|旗|盟|林区|地区|自治州|自治区|特别行政区)$/u;
const ETHNIC =
  /(壮|回|维吾尔|苗|藏|蒙|侗|瑶|白|朝鲜|哈尼|哈萨克|傣|黎|傈僳|佤|畲|高山|拉祜|水|东乡|纳西|景颇|柯尔克孜|土|达斡尔|仫佬|羌|布依|撒拉|毛南|仡佬|锡伯|阿昌|普米|塔吉克|怒|乌孜别克|俄罗斯|鄂温克|德昂|保安|裕固|京|塔塔尔|独龙|鄂伦春|赫哲|门巴|珞巴|基诺)族/g;

/** 去掉民族名与行政后缀的短名："天河区"->"天河"，"广西壮族自治区"->"广西" */
export function shortName(name) {
  let s = name || '';
  for (let i = 0; i < 3; i++) {
    const t = s.replace(ETHNIC, '').replace(SUFFIX, '');
    if (!t || t === s) break;
    s = t;
  }
  return s;
}

function score(item, q) {
  const n = norm(item.n);
  const sh = norm(shortName(item.n));
  const p = norm(item.path);
  if (n === q) return 120;
  if (sh === q) return 110;
  if (n.startsWith(q)) return 90 - (n.length - q.length);
  if (sh.startsWith(q)) return 85 - (sh.length - q.length);
  if (p.endsWith(q) || p === q) return 80;
  if (p.includes(q) && q.length >= 2) return 65;
  if (n.includes(q)) return 55;
  if (q.length >= 2 && n.length >= 2 && q.includes(n)) return 45;
  return 0;
}

const LEVEL_BONUS = { country: 6, province: 4, city: 2, district: 0 };

export function searchAdmin(query, limit = 8) {
  if (!items) return [];
  const q = norm(query);
  if (!q) return [];
  return items
    .map((i) => ({ item: i, raw: score(i, q) }))
    .filter((x) => x.raw > 0)
    .map((x) => ({ ...x, s: x.raw + (LEVEL_BONUS[x.item.l] || 0) }))
    .sort((a, b) => b.s - a.s || a.item.n.length - b.item.n.length)
    .slice(0, limit)
    .map(({ item, s }) => ({
      kind: 'admin',
      score: s,
      adcode: item.c,
      name: item.n,
      level: item.l,
      levelLabel: LEVEL_LABEL[item.l] || item.l,
      path: item.path,
    }));
}
