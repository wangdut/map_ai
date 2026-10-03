import { geometryArea, geometryPerimeter, polygonCentroid, pointInGeometry } from '../geom/geo.js';

export const PALETTE = [
  '#0091ff',
  '#00b96b',
  '#ff9d00',
  '#8e44ff',
  '#00bfcf',
  '#ff4d6d',
  '#a05a00',
  '#5b6b7d',
];

const STORAGE_KEY = 'map_ai.highlights.v1';
let seq = 0;

function pickColor(items) {
  const used = items.map((i) => i.color);
  const free = PALETTE.find((c) => !used.includes(c));
  if (free) return free;
  // 预设色用完后按黄金角生成新色相，保证再多区域也彼此可辨
  for (let k = 0; k < 64; k++) {
    const hue = Math.round(((used.length + k) * 137.508) % 360);
    const c = `hsl(${hue} 82% 46%)`;
    if (!used.includes(c)) return c;
  }
  return `hsl(${Math.round(Math.random() * 359)} 82% 46%)`;
}

export const store = {
  items: [],
  focusId: null,
  listeners: new Set(),
  batch: 0,

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  emit(event = 'change') {
    if (this.batch) return;
    this.listeners.forEach((fn) => fn(this.items, event, this.focusId));
  },

  add(partial) {
    const geometry = partial.geometry;
    if (!geometry || !geometry.coordinates) throw new Error('缺少区域几何数据');
    const id = partial.id || `h${Date.now().toString(36)}${++seq}`;
    const existing = this.items.find((i) => i.id === id);
    const item = {
      id,
      name: partial.name || '未命名区域',
      subtitle: partial.subtitle || '',
      source: partial.source || 'admin',
      meta: partial.meta || {},
      geometry,
      area: partial.area ?? geometryArea(geometry),
      perimeter: partial.perimeter ?? geometryPerimeter(geometry),
      centroid: partial.centroid || polygonCentroid(geometry),
      color: partial.color || existing?.color || pickColor(this.items),
    };
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx >= 0) this.items.splice(idx, 1, item);
    else this.items.push(item);
    this.emit('add');
    return item;
  },

  /** 批量写入期间压掉通知，结束后只 emit 一次：几百块区域逐条重绘会卡住主线程 */
  transaction(fn, event = 'change') {
    this.batch++;
    try {
      return fn();
    } finally {
      this.batch--;
      if (!this.batch) this.emit(event);
    }
  },

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.focusId === id) this.focusId = null;
    this.emit('remove');
    return this.items.length !== before;
  },

  clear() {
    this.items = [];
    this.focusId = null;
    this.emit('clear');
  },

  keepOnly(id) {
    this.items = this.items.filter((i) => i.id === id);
    this.emit('clear');
  },

  get(id) {
    return this.items.find((i) => i.id === id) || null;
  },

  /** 右键命中检测：后加入的在最上层。入参是应用内统一的 [lat, lng]，GeoJSON 环是 [lng, lat] */
  hitTest([lat, lng]) {
    const point = [lng, lat];
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (pointInGeometry(point, this.items[i].geometry)) return this.items[i];
    }
    return null;
  },

  setFocus(id) {
    if (this.focusId === id) return;
    this.focusId = id;
    this.emit('focus');
  },

  persist() {
    try {
      const json = JSON.stringify(this.items);
      // 批量高亮几十上百块时几何总量能到几 MB，超配额直接跳过而不是反复抛错
      if (json.length > 4_000_000) return;
      localStorage.setItem(STORAGE_KEY, json);
    } catch {
      /* 几何过大时忽略存储失败 */
    }
  },

  restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      this.items = Array.isArray(parsed) ? parsed.filter((i) => i?.geometry?.coordinates) : [];
      const maxSeq = this.items.reduce((m, i) => Math.max(m, Number(String(i.id).replace(/\D/g, '')) || 0), 0);
      seq = Math.max(seq, maxSeq);
      this.emit('restore');
      return this.items;
    } catch {
      return [];
    }
  },

  clearPersisted() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  },
};
