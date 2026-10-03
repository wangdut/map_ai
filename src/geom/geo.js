const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

/** 两点大圆距离，入参 [lat, lng]，返回米 */
export function haversine(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 折线长度，入参 [[lat,lng], ...] */
export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
  return total;
}

/**
 * 球面多边形面积（精确梯形分解式），ring 为 GeoJSON 顺序 [[lng, lat], ...]，不要求闭合。
 */
export function ringArea(ring) {
  let sum = 0;
  const n = ring.length;
  if (n < 3) return 0;
  for (let i = 0; i < n; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % n];
    sum += (rad(lng2) - rad(lng1)) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((sum * R * R) / 2);
}

/** Polygon / MultiPolygon 坐标 -> 面积 m²（外环相加，内环相减） */
export function polygonArea(coords, isMulti = false) {
  const polys = isMulti ? coords : [coords];
  let total = 0;
  for (const poly of polys) {
    poly.forEach((ring, idx) => {
      const a = ringArea(ring);
      total += idx === 0 ? a : -a;
    });
  }
  return Math.max(0, total);
}

export function geometryArea(geometry) {
  if (!geometry) return 0;
  switch (geometry.type) {
    case 'Polygon':
      return polygonArea(geometry.coordinates, false);
    case 'MultiPolygon':
      return polygonArea(geometry.coordinates, true);
    default:
      return 0;
  }
}

/** GeoJSON geometry -> 周长 m */
export function geometryPerimeter(geometry) {
  const rings =
    geometry?.type === 'Polygon'
      ? [geometry.coordinates[0]]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates.map((p) => p[0])
        : [];
  return rings.reduce((t, r) => t + pathLength(r.map(([lng, lat]) => [lat, lng])), 0);
}

/** 射线法：point=[lat,lng]，ring=[[lng,lat],...] */
export function pointInRing(point, ring) {
  const y = point[1];
  const x = point[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  const test = (poly) => pointInRing(point, poly[0]) && !poly.slice(1).some((hole) => pointInRing(point, hole));
  if (geometry.type === 'Polygon') return test(geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(test);
  return false;
}

/** 面积加权平面近似重心，返回 [lat, lng] */
export function polygonCentroid(geometry) {
  const polys = geometry?.type === 'MultiPolygon' ? geometry.coordinates : geometry?.type === 'Polygon' ? [geometry.coordinates] : [];
  let best = null;
  let bestArea = -1;
  for (const poly of polys) {
    const ring = poly[0];
    let x = 0;
    let y = 0;
    let a = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % n];
      const cross = x1 * y2 - x2 * y1;
      a += cross;
      x += (x1 + x2) * cross;
      y += (y1 + y2) * cross;
    }
    a /= 2;
    const area = Math.abs(a);
    if (area > bestArea) {
      bestArea = area;
      best = a === 0 ? ring[0] : [x / (6 * a), y / (6 * a)];
    }
  }
  return best ? [best[1], best[0]] : null;
}

/** GeoJSON -> [[minLng,minLat],[maxLng,maxLat]] */
export function bboxOfGeoJSON(json) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      if (typeof node[0] === 'number' && typeof node[1] === 'number') {
        minX = Math.min(minX, node[0]);
        maxX = Math.max(maxX, node[0]);
        minY = Math.min(minY, node[1]);
        maxY = Math.max(maxY, node[1]);
      } else node.forEach(walk);
    } else if (node.type === 'FeatureCollection') {
      (node.features || []).forEach(walk);
    } else if (node.type === 'Feature') {
      walk(node.geometry);
    } else if (node.coordinates) {
      walk(node.coordinates);
    }
  };
  walk(json);
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
}

/** 等面积圆：由面积反推半径后生成近似圆多边形（GeoJSON 坐标序） */
export function circleGeometry(center, radiusMeters, steps = 72) {
  const [lat, lng] = center;
  const coords = [];
  const latRad = rad(lat);
  for (let i = 0; i < steps; i++) {
    const angle = ((2 * Math.PI) / steps) * i;
    const dLat = (radiusMeters * Math.cos(angle)) / R;
    const dLng = (radiusMeters * Math.sin(angle)) / (R * Math.cos(latRad) || 1);
    coords.push([lng + (dLng * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
  }
  coords.push(coords[0]);
  return { type: 'Polygon', coordinates: [coords] };
}

export function radiusFromArea(m2) {
  return Math.sqrt(m2 / Math.PI);
}

export function formatArea(m2) {
  if (!m2) return '未知面积';
  const km2 = m2 / 1e6;
  if (km2 >= 1) return `${km2.toFixed(km2 >= 100 ? 0 : 2)} km² · ${(m2 / 666.6667).toFixed(0)} 亩`;
  return `${(m2 / 1e4).toFixed(2)} 公顷 · ${(m2 / 666.6667).toFixed(1)} 亩`;
}

export function formatDistance(m) {
  if (!m && m !== 0) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km` : `${m.toFixed(0)} m`;
}

export function formatDuration(sec) {
  if (!sec) return '';
  const min = Math.round(sec / 60);
  return min >= 60 ? `${Math.floor(min / 60)} 小时 ${min % 60} 分` : `${min} 分钟`;
}
