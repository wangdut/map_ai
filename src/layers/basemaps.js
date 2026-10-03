const SUB = ['1', '2', '3', '4'];
const TILE_OPTS = { subdomains: SUB, maxZoom: 18, updateWhenIdle: true, keepBuffer: 4 };

export function createBasemaps(map) {
  const standard = L.tileLayer(
    'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    { ...TILE_OPTS, attribution: '标准底图 © 高德地图' },
  );

  const satellite = L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', {
    ...TILE_OPTS,
    attribution: '卫星影像 © 高德地图',
  });

  const esri = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: '卫星影像 © Esri, Maxar' },
  );

  const osm = L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap (de 镜像)',
  });

  const annotation = L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}', {
    ...TILE_OPTS,
    maxZoom: 18,
    attribution: '',
  });

  const bases = { standard, satellite, esri, osm };
  let currentName = 'standard';
  let annotationOn = true;

  function apply(name) {
    if (bases[name]) currentName = name;
    Object.values(bases).forEach((l) => map.hasLayer(l) && map.removeLayer(l));
    bases[currentName].addTo(map);
    map.removeLayer(annotation);
    if (annotationOn && (currentName === 'satellite' || currentName === 'esri')) annotation.addTo(map);
    return currentName;
  }

  apply('standard');

  return {
    switchTo: apply,
    setAnnotation(on) {
      annotationOn = on;
      apply(currentName);
    },
    get current() {
      return currentName;
    },
    hasLabels(name) {
      return name === 'standard' || name === 'osm';
    },
  };
}
