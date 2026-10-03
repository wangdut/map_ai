import { store } from '../highlight/store.js';
import { ringArea, formatArea } from '../geom/geo.js';

const COLOR = '#ff8a00';

/** 手绘描边：沿卫星影像逐点点击，闭合后得到真实轮廓 + 面积 + 周长 */
export function createDrawTool(map, ui, hooks) {
  let active = false;
  let pts = [];
  let cursor = null;
  let shapes = [];

  if (!map.getPane('draw')) {
    map.createPane('draw');
    map.getPane('draw').style.zIndex = 470;
  }

  function geoRing(withCursor = false) {
    const raw = withCursor && cursor ? [...pts, cursor] : pts;
    return raw.map(([lat, lng]) => [lng, lat]);
  }

  function latLngRing(withCursor = false) {
    return withCursor && cursor ? [...pts, cursor] : pts.slice();
  }

  function clearShapes() {
    shapes.forEach((s) => map.removeLayer(s));
    shapes = [];
  }

  function add(shape) {
    shapes.push(shape.addTo(map));
  }

  function redraw() {
    clearShapes();
    const ring = geoRing(true);
    const disp = latLngRing(true);
    if (pts.length) {
      add(L.polyline(disp, { pane: 'draw', interactive: false, color: COLOR, weight: 2, dashArray: '5 4', opacity: 0.95 }));
      if (ring.length >= 4) {
        add(
          L.polygon(disp, {
            pane: 'draw',
            interactive: false,
            color: COLOR,
            weight: 1,
            fillColor: COLOR,
            fillOpacity: 0.25,
          }),
        );
      }
      pts.forEach(([lat, lng]) =>
        add(L.circleMarker([lat, lng], { pane: 'draw', interactive: false, radius: 4, color: COLOR, fillColor: COLOR, fillOpacity: 1, weight: 1 })),
      );
    }
    const area = ring.length >= 4 ? ringArea(ring) : 0;
    ui.setTip(
      pts.length
        ? `绘制中：${pts.length} 个顶点${area ? ` · 当前约 ${formatArea(area)}` : ''} · 右键或回车闭合 · Esc 取消`
        : '绘制区域：左键沿边界逐点点击（建议先切「卫星」图看得更清），右键/回车闭合',
    );
  }

  function onClick(e) {
    pts.push([e.latlng.lat, e.latlng.lng]);
    redraw();
  }

  function onMove(e) {
    if (!pts.length) return;
    cursor = [e.latlng.lat, e.latlng.lng];
    redraw();
  }

  function onContextmenu() {
    if (pts.length >= 3) finish();
    else ui.toast('至少 3 个点才能闭合成区域');
  }

  function finish() {
    if (pts.length < 3) return ui.toast('至少 3 个点');
    const ring = geoRing(false);
    ring.push(ring[0]);
    const geometry = { type: 'Polygon', coordinates: [ring] };
    const name = ui.askName('区域名称', `手绘区域 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
    if (name === null) return ui.toast('已放弃保存本次描边');
    const item = store.add({
      id: `draw:${Date.now()}`,
      name: name || '手绘区域',
      subtitle: '手绘描边',
      source: 'draw',
      geometry,
    });
    pts = [];
    cursor = null;
    redraw();
    ui.toast(`已保存：${item.name} · ${formatArea(item.area)}`);
    hooks.onCreated(item);
    return item;
  }

  function cancel() {
    pts = [];
    cursor = null;
    clearShapes();
  }

  function activate() {
    if (active) return;
    active = true;
    map.getContainer().style.cursor = 'crosshair';
    map.on('click', onClick);
    map.on('mousemove', onMove);
    map.on('contextmenu', onContextmenu);
    redraw();
  }

  function deactivate() {
    if (!active) return;
    active = false;
    map.getContainer().style.cursor = '';
    map.off('click', onClick);
    map.off('mousemove', onMove);
    map.off('contextmenu', onContextmenu);
    cancel();
    ui.setTip('');
  }

  return {
    activate,
    deactivate,
    get active() {
      return active;
    },
    undo() {
      pts.pop();
      redraw();
    },
    onEnter() {
      if (active && pts.length >= 3) finish();
    },
  };
}
