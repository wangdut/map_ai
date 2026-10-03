import { bboxOfGeoJSON } from '../geom/geo.js';

/**
 * 高亮图层渲染。形状放入独立的非交互 pane：
 * 半透明矢量面天然随缩放贴合，且左键点击会穿透到高亮层落到地图上（不影响在区域内选点）。
 */
export function createRenderer(map, store) {
  const SHAPE_PANE = 'highlights';
  const LABEL_PANE = 'hl-labels';
  map.createPane(SHAPE_PANE);
  map.createPane(LABEL_PANE);
  map.getPane(SHAPE_PANE).style.zIndex = 350;
  map.getPane(LABEL_PANE).style.zIndex = 640;

  const layers = new Map();

  function styleOf(item, focused) {
    return {
      color: item.color,
      weight: focused ? 3.5 : 2,
      opacity: 0.95,
      fillColor: item.color,
      fillOpacity: focused ? 0.45 : 0.28,
    };
  }

  function drawOne(item) {
    const focused = store.focusId === item.id;
    const shape = L.geoJSON({ type: 'Feature', properties: {}, geometry: item.geometry }, {
      pane: SHAPE_PANE,
      interactive: false,
      smoothFactor: 0.5,
      style: styleOf(item, focused),
    }).addTo(map);

    let label = null;
    if (item.centroid && map.getZoom() >= 3) {
      label = L.tooltip({
        pane: LABEL_PANE,
        permanent: true,
        direction: 'center',
        className: 'hl-label',
        opacity: 1,
      })
        .setLatLng(item.centroid)
        .setContent(item.name)
        .addTo(map);
    }
    layers.set(item.id, { shape, label });
  }

  function removeOne(id) {
    const entry = layers.get(id);
    if (!entry) return;
    map.removeLayer(entry.shape);
    if (entry.label) map.removeLayer(entry.label);
    layers.delete(id);
  }

  function sync() {
    const ids = new Set(store.items.map((i) => i.id));
    [...layers.keys()].forEach((id) => !ids.has(id) && removeOne(id));
    store.items.forEach((item) => {
      removeOne(item.id);
      drawOne(item);
    });
  }

  store.subscribe(sync);

  const toLatLngBox = ([[minLng, minLat], [maxLng, maxLat]]) => [
    [minLat, minLng],
    [maxLat, maxLng],
  ];

  return {
    sync,
    boundsOf(id) {
      const item = store.get(id);
      const box = item && bboxOfGeoJSON(item.geometry);
      return box ? L.latLngBounds(toLatLngBox(box)) : null;
    },
    fitItem(id) {
      const bounds = this.boundsOf(id);
      if (bounds) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    },
    fitAll() {
      const all = store.items.reduce((acc, i) => {
        const box = bboxOfGeoJSON(i.geometry);
        if (!box) return acc;
        if (!acc) return box;
        return [[Math.min(acc[0][0], box[0][0]), Math.min(acc[0][1], box[0][1])], [Math.max(acc[1][0], box[1][0]), Math.max(acc[1][1], box[1][1])]];
      }, null);
      if (all) map.fitBounds(L.latLngBounds(toLatLngBox(all)), { padding: [40, 40], maxZoom: 15 });
    },
  };
}
