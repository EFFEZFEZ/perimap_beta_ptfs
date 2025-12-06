/**
 * utils/geo.js
 * Utilitaires géographiques
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 */

/**
 * Rayon de la Terre en mètres
 */
export const EARTH_RADIUS = 6371000;

/**
 * Calcule la distance Haversine entre deux points
 * 
 * @param {number} lat1 - Latitude du point 1
 * @param {number} lon1 - Longitude du point 1
 * @param {number} lat2 - Latitude du point 2
 * @param {number} lon2 - Longitude du point 2
 * @returns {number} Distance en mètres
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS * c;
}

/**
 * Calcule le cap (bearing) entre deux points
 * 
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Cap en degrés (0-360)
 */
export function bearing(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

/**
 * Calcule un point à une distance et un cap donnés
 * 
 * @param {number} lat - Latitude de départ
 * @param {number} lon - Longitude de départ
 * @param {number} distance - Distance en mètres
 * @param {number} bearingDeg - Cap en degrés
 * @returns {{lat: number, lon: number}}
 */
export function destinationPoint(lat, lon, distance, bearingDeg) {
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const θ = (bearingDeg * Math.PI) / 180;
  const δ = distance / EARTH_RADIUS;

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) +
    Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  );

  return {
    lat: (φ2 * 180) / Math.PI,
    lon: (λ2 * 180) / Math.PI,
  };
}

/**
 * Calcule le centre d'un ensemble de points (centroïde)
 * 
 * @param {Array<{lat: number, lon: number}>} points
 * @returns {{lat: number, lon: number}}
 */
export function centroid(points) {
  if (points.length === 0) return { lat: 0, lon: 0 };
  if (points.length === 1) return { lat: points[0].lat, lon: points[0].lon };

  // Pour un calcul précis sur une sphère
  let x = 0, y = 0, z = 0;

  for (const point of points) {
    const lat = (point.lat * Math.PI) / 180;
    const lon = (point.lon * Math.PI) / 180;
    
    x += Math.cos(lat) * Math.cos(lon);
    y += Math.cos(lat) * Math.sin(lon);
    z += Math.sin(lat);
  }

  const n = points.length;
  x /= n;
  y /= n;
  z /= n;

  const lon = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp);

  return {
    lat: (lat * 180) / Math.PI,
    lon: (lon * 180) / Math.PI,
  };
}

/**
 * Calcule la bounding box d'un ensemble de points
 * 
 * @param {Array<{lat: number, lon: number}>} points
 * @returns {{minLat: number, maxLat: number, minLon: number, maxLon: number}}
 */
export function boundingBox(points) {
  if (points.length === 0) {
    return { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };
  }

  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;

  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
  }

  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Vérifie si un point est dans une bounding box
 * 
 * @param {number} lat
 * @param {number} lon
 * @param {{minLat: number, maxLat: number, minLon: number, maxLon: number}} bbox
 * @returns {boolean}
 */
export function isInBoundingBox(lat, lon, bbox) {
  return (
    lat >= bbox.minLat &&
    lat <= bbox.maxLat &&
    lon >= bbox.minLon &&
    lon <= bbox.maxLon
  );
}

/**
 * Étend une bounding box d'un certain rayon
 * 
 * @param {{minLat: number, maxLat: number, minLon: number, maxLon: number}} bbox
 * @param {number} radiusMeters
 * @returns {{minLat: number, maxLat: number, minLon: number, maxLon: number}}
 */
export function expandBoundingBox(bbox, radiusMeters) {
  // Approximation: 1 degré de latitude ≈ 111km
  const latDelta = radiusMeters / 111000;
  // 1 degré de longitude varie selon la latitude
  const avgLat = (bbox.minLat + bbox.maxLat) / 2;
  const lonDelta = radiusMeters / (111000 * Math.cos((avgLat * Math.PI) / 180));

  return {
    minLat: bbox.minLat - latDelta,
    maxLat: bbox.maxLat + latDelta,
    minLon: bbox.minLon - lonDelta,
    maxLon: bbox.maxLon + lonDelta,
  };
}

/**
 * Calcule le temps de marche estimé
 * 
 * @param {number} distanceMeters
 * @param {number} walkSpeedMps - Vitesse de marche en m/s (défaut: 1.25 = ~4.5 km/h)
 * @returns {number} Temps en secondes
 */
export function estimateWalkTime(distanceMeters, walkSpeedMps = 1.25) {
  return Math.round(distanceMeters / walkSpeedMps);
}

/**
 * Simplifie une polyline en utilisant l'algorithme Douglas-Peucker
 * 
 * @param {Array<[number, number]>} points - [[lon, lat], ...]
 * @param {number} tolerance - Tolérance en degrés
 * @returns {Array<[number, number]>}
 */
export function simplifyPolyline(points, tolerance = 0.0001) {
  if (points.length <= 2) return points;

  const sqTolerance = tolerance * tolerance;

  function sqSegmentDistance(p, p1, p2) {
    let x = p1[0], y = p1[1];
    let dx = p2[0] - x, dy = p2[1] - y;

    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = p2[0];
        y = p2[1];
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }

    dx = p[0] - x;
    dy = p[1] - y;

    return dx * dx + dy * dy;
  }

  function simplifyDP(points, first, last, sqTolerance, simplified) {
    let maxSqDist = sqTolerance;
    let index;

    for (let i = first + 1; i < last; i++) {
      const sqDist = sqSegmentDistance(points[i], points[first], points[last]);
      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }

    if (maxSqDist > sqTolerance) {
      if (index - first > 1) simplifyDP(points, first, index, sqTolerance, simplified);
      simplified.push(points[index]);
      if (last - index > 1) simplifyDP(points, index, last, sqTolerance, simplified);
    }
  }

  const last = points.length - 1;
  const simplified = [points[0]];
  simplifyDP(points, 0, last, sqTolerance, simplified);
  simplified.push(points[last]);

  return simplified;
}

export default {
  EARTH_RADIUS,
  haversineDistance,
  bearing,
  destinationPoint,
  centroid,
  boundingBox,
  isInBoundingBox,
  expandBoundingBox,
  estimateWalkTime,
  simplifyPolyline,
};
