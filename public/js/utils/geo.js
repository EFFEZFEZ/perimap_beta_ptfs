/**
 * geo.js
 * Utilitaires de normalisation et résolution d'arrêts.
 */

const stopCoordinateCache = new Map();

export function normalizeStopNameForLookup(name) {
  if (!name) return '';
  return name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '').trim();
}

export function resolveStopCoordinates(stopName, dataManager) {
  if (!stopName || !dataManager || !dataManager.isLoaded) return null;
  const key = normalizeStopNameForLookup(stopName);
  if (!key) return null;
  if (stopCoordinateCache.has(key)) return stopCoordinateCache.get(key);

  let candidate = null;
  if (typeof dataManager.findStopsByName === 'function') {
    const matches = dataManager.findStopsByName(stopName, 1);
    if (matches && matches.length) candidate = matches[0];
  }
  if (!candidate && Array.isArray(dataManager.masterStops)) {
    for (const s of dataManager.masterStops) {
      if (normalizeStopNameForLookup(s.stop_name) === key) { candidate = s; break; }
    }
  }
  if (candidate) {
    const coords = { lat: parseFloat(candidate.stop_lat), lng: parseFloat(candidate.stop_lon) };
    stopCoordinateCache.set(key, coords);
    return coords;
  }
  return null;
}
