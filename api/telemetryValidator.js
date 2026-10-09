function coordinateNumber(v) {
  if (v == null || typeof v === "boolean" || String(v).trim() === "") return NaN;
  return Number(String(v).replace(",", "."));
}
// Validações de telemetria - camada sem impacto visual
function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const n = Number(String(value).replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function extractLatLng(p) {
  if (!p) return null;
  let lat, lng;
  if (Array.isArray(p)) {
    if (p.length < 2) return null;
    lat = coordinateNumber(p[0]);
    lng = coordinateNumber(p[1]);
  } else if (typeof p === 'object') {
    lat = coordinateNumber(p.lat ?? p.latitude);
    lng = coordinateNumber(p.lng ?? p.lon ?? p.longitude);
  } else {
    return null;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

function validCoordinate(point) {
  return extractLatLng(point) !== null;
}

function simplifyCoords(points, tolerance = 0.000025) {
  if (!points || points.length <= 2) return points;
  function sqDistToSeg(p, p1, p2) {
    let x = p1[0], y = p1[1], dx = p2[0] - x, dy = p2[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = p2[0]; y = p2[1]; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p[0] - x; dy = p[1] - y;
    return dx * dx + dy * dy;
  }
  const tolSq = tolerance * tolerance;
  function dp(pts) {
    if (pts.length <= 2) return pts;
    let maxD = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = sqDistToSeg(pts[i], pts[0], pts[pts.length - 1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolSq) {
      const left = dp(pts.slice(0, idx + 1));
      const right = dp(pts.slice(idx));
      return left.slice(0, -1).concat(right);
    }
    return [pts[0], pts[pts.length - 1]];
  }
  return dp(points);
}

function normalizeCoords(coords = []) {
  if (!Array.isArray(coords)) return [];
  const result = [];
  let lastKey = '';
  for (const p of coords) {
    const pt = extractLatLng(p);
    if (!pt) continue;
    const key = `${pt[0]},${pt[1]}`;
    if (key === lastKey) continue;
    lastKey = key;
    result.push(pt);
  }
  return result;
}

function validateFlight(item) {
  const coords = normalizeCoords(item.coords);
  return {
    ...item,
    coords,
    points: coords.length || Number(item.points || 0)
  };
}

module.exports = { validateFlight, normalizeCoords, extractLatLng, simplifyCoords };
