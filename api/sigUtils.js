// Utilitarios SIG - identificacao segura de talhoes
const crypto = require('crypto');

function normalizeNumber(v) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// Todos os arrays internos são [latitude, longitude]; GeoJSON é convertido na entrada.
const { normalizeCoords: normalizePoints } = require('./telemetryValidator');
function normalizeCoords(coords) { return normalizePoints(coords); }

function geometryHash(coords, area, farm, talhao) {
  const normalized = normalizeCoords(coords);
  const payload = JSON.stringify({
    farm: String(farm || '').trim().toLowerCase(),
    talhao: String(talhao || '').trim().toLowerCase(),
    area: normalizeNumber(area).toFixed(4),
    geometry: normalized
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function validatePolygon(coords) {
  const c = normalizeCoords(coords);
  if (c.length < 3 || new Set(c.map(p => p.join(','))).size < 3) return false;
  let area = 0;
  for (let i=0,j=c.length-1;i<c.length;j=i++) area += c[j][1]*c[i][0]-c[i][1]*c[j][0];
  return Math.abs(area) > 1e-12;
}

module.exports = { normalizeCoords, geometryHash, validatePolygon };
