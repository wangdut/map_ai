import { haversine, pathLength, formatDistance } from '../geom/geo.js';

const COLOR = '#16a3a6';

/** 逐点直线测距（不依赖任何 API，随时可用） */
export function createMeasureTool(map, ui) {
  let active = false;
  let pts = [];
  let shapes = [];

  if (!map.getPane('measure')) {
    map.createPane('measure');
    map.getPane('measure').style.zIndex = 480;
  }

  function clearShapes() {
    shapes.forEach((s) => map.removeLayer(s));
    shapes = [];
  }

  function add(shape) {
    shapes.push(shape.addTo(map));
  }

  function refresh() {
    clearShapes();
    if (!pts.length) return;
    if (pts.length >= 2) {
      add(L.polyline(pts, { pane: 'measure', interactive: false, color: COLOR, weight: 3, opacity: 0.9 }));
      for (let i = 1; i < pts.length; i++) {
        const mid = [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2];
        add(
          L.tooltip({ pane: 'measure', permanent: true, direction: 'center', className: 'hl-label', opacity: 1 })
            .setLatLng(mid)
            .setContent(formatDistance(haversine(pts[i - 1], pts[i]))),
        );
      }
    }
    pts.forEach((p, i) =>
      add(
        L.circleMarker(p, {
          pane: 'measure',
          interactive: false,
          radius: i === 0 ? 5 : 4,
          color: COLOR,
          fillColor: '#fff',
          fillOpacity: 0.9,
          weight: 2,
        }),
      ),
    );
    const total = pathLength(pts);
    ui.setTip(
      pts.length >= 2
        ? `测距：${pts.length} 个点 · ${pts.length - 1} 段 · 合计 ${formatDistance(total)}（地面直线距离）· 继续点击加点，Esc 清除`
        : '测距：已取 1 点，继续点击地图添加下一点',
    );
  }

  function onClick(e) {
    pts.push([e.latlng.lat, e.latlng.lng]);
    refresh();
  }

  function onContextmenu() {
    if (pts.length < 2) return ui.toast('至少 2 个点才能测距');
    ui.toast(`共 ${pts.length} 点，合计 ${formatDistance(pathLength(pts))}`);
  }

  function reset() {
    pts = [];
    clearShapes();
  }

  function activate() {
    if (active) return;
    active = true;
    map.getContainer().style.cursor = 'crosshair';
    map.on('click', onClick);
    map.on('contextmenu', onContextmenu);
    ui.setTip('测距：左键逐点点击地图（自动显示每段与合计直线距离），Esc 退出');
  }

  function deactivate() {
    if (!active) return;
    active = false;
    map.getContainer().style.cursor = '';
    map.off('click', onClick);
    map.off('contextmenu', onContextmenu);
    reset();
    ui.setTip('');
  }

  return {
    activate,
    deactivate,
    reset,
    addPoint(latlng) {
      pts.push([latlng[0], latlng[1]]);
      refresh();
    },
    get active() {
      return active;
    },
    undo() {
      pts.pop();
      refresh();
    },
  };
}
