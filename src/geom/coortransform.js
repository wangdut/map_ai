const PI = Math.PI;
const A = 6378245;
const EE = 0.00669342162296594323;

const deltaLat = (x, y) => {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(8 * x * PI)) * 2) / 3;
  r += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return r;
};

const deltaLng = (x, y) => {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(8 * x * PI)) * 2) / 3;
  r += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  r += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  return r;
};

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

/** WGS84 [lat,lng] -> GCJ02 [lat,lng]（高德/腾讯底图坐标） */
export function wgs2gcj(lat, lng) {
  if (outOfChina(lng, lat)) return [lat, lng];
  let dLat = deltaLat(lng - 105, lat - 35);
  let dLng = deltaLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lat + dLat, lng + dLng];
}

/** GCJ02 [lat,lng] -> WGS84 [lat,lng]（一次反算，误差 <1m 量级） */
export function gcj2wgs(lat, lng) {
  if (outOfChina(lng, lat)) return [lat, lng];
  const [gLat, gLng] = wgs2gcj(lat, lng);
  return [lat * 2 - gLat, lng * 2 - gLng];
}

export function convertGeometry(geometry, fn) {
  const mapRing = (ring) => ring.map(([lng, lat]) => {
    const [nLat, nLng] = fn(lat, lng);
    return [nLng, nLat];
  });
  switch (geometry?.type) {
    case 'LineString':
      return { ...geometry, coordinates: mapRing(geometry.coordinates) };
    case 'Polygon':
      return { ...geometry, coordinates: geometry.coordinates.map(mapRing) };
    case 'MultiPolygon':
      return { ...geometry, coordinates: geometry.coordinates.map((p) => p.map(mapRing)) };
    default:
      return geometry;
  }
}
