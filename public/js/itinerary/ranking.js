/**
 * ranking.js
 * Logique de déduplication, tri et filtrage pour les itinéraires.
 */

import { parseTimeStringToMinutes } from '../utils/formatters.js';

/**
 * Déduplique les itinéraires par structure de trajet (même séquence bus/arrêts).
 * En mode "partir", garde le premier départ.
 * En mode "arriver", garde le dernier départ qui arrive à temps.
 */
export function deduplicateItineraries(list, searchMode = 'partir') {
  if (!Array.isArray(list)) return [];
  
  const grouped = new Map();
  
  list.forEach(it => {
    const key = createRouteSignature(it);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(it);
  });
  
  const result = [];
  grouped.forEach((variants) => {
    if (variants.length === 1) {
      result.push(variants[0]);
      return;
    }
    
    // Trier les variantes par heure de départ
    variants.sort((a, b) => {
      const depA = parseTimeToMinutes(a.departureTime);
      const depB = parseTimeToMinutes(b.departureTime);
      return depA - depB;
    });
    
    if (searchMode === 'arriver') {
      // En mode arriver, on veut le départ le plus tardif possible
      result.push(variants[variants.length - 1]);
    } else {
      // En mode partir, on veut le premier départ
      result.push(variants[0]);
    }
  });
  
  return result;
}

/**
 * Crée une signature basée sur la STRUCTURE du trajet, pas les horaires.
 * Deux trajets avec les mêmes bus/arrêts mais horaires différents ont la même signature.
 */
function createRouteSignature(it) {
  if (!it) return 'null';
  
  const segments = (it.summarySegments || [])
    .map(s => s.name || s.routeShortName || 'X')
    .join('>');
  
  const steps = (it.steps || [])
    .filter(s => s.type === 'BUS')
    .map(s => {
      const route = s.routeShortName || s.route?.route_short_name || '';
      const from = normalizeStopName(s.departureStop);
      const to = normalizeStopName(s.arrivalStop);
      return `${route}:${from}-${to}`;
    })
    .join('|');
  
  return `${it.type}::${segments}::${steps}`;
}

function normalizeStopName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 20);
}

/**
 * Parse une chaîne de temps en minutes (wrapper pour compatibilité)
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return Infinity;
  const result = parseTimeStringToMinutes(timeStr);
  return result !== null ? result : Infinity;
}

/**
 * Filtre les itinéraires expirés (départ dans le passé).
 * Fonctionne pour les deux modes.
 * Si searchTime est fourni et la date est dans le futur, on ne filtre pas.
 */
export function filterExpiredDepartures(itineraries, searchTime = null) {
  if (!Array.isArray(itineraries)) return [];
  
  // Si la recherche est pour une date future, ne pas filtrer
  if (searchTime && searchTime.date) {
    const searchDate = new Date(searchTime.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    searchDate.setHours(0, 0, 0, 0);
    if (searchDate > today) {
      // Recherche pour demain ou plus tard, pas de filtrage
      return itineraries;
    }
  }
  
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  
  return itineraries.filter(it => {
    const depTime = it?.departureTime;
    if (!depTime || depTime === '~' || depTime === '--:--') return true;
    
    const depMinutes = parseTimeToMinutes(depTime);
    if (depMinutes === Infinity) return true;
    
    // Garder si départ >= maintenant
    return depMinutes >= nowMinutes;
  });
}

/**
 * En mode "arriver", filtre les trajets qui arrivent APRÈS l'heure demandée.
 */
export function filterLateArrivals(itineraries, targetHour, targetMinute) {
  if (!Array.isArray(itineraries)) return [];
  
  const targetMinutes = targetHour * 60 + targetMinute;
  
  return itineraries.filter(it => {
    const arrTime = it?.arrivalTime;
    if (!arrTime || arrTime === '~' || arrTime === '--:--') return true;
    
    const arrMinutes = parseTimeToMinutes(arrTime);
    if (arrMinutes === Infinity) return true;
    
    // Garder si arrivée <= heure cible
    return arrMinutes <= targetMinutes;
  });
}

/**
 * Trie et classe les itinéraires pour le mode "arriver".
 * Priorité: arrivée la plus proche de l'heure demandée (mais <= heure demandée), moins de correspondances, moins de marche.
 */
export function rankArrivalItineraries(itineraries, searchTime) {
  if (!searchTime || searchTime.type !== 'arriver') return itineraries;
  if (!Array.isArray(itineraries) || !itineraries.length) return itineraries;
  
  const targetHour = parseInt(searchTime.hour) || 0;
  const targetMinute = parseInt(searchTime.minute) || 0;
  const targetMinutes = targetHour * 60 + targetMinute;
  
  console.log(`🎯 rankArrivalItineraries: cible ${String(targetHour).padStart(2,'0')}:${String(targetMinute).padStart(2,'0')} (${targetMinutes}min), ${itineraries.length} itinéraires à trier`);
  
  // Debug: afficher tous les itinéraires avant tri
  console.log('📋 Avant tri (heures d\'arrivée):', itineraries.map(it => it.arrivalTime).join(', '));
  
  const scored = itineraries.map(it => {
    const steps = Array.isArray(it.steps) ? it.steps : [];
    const busSteps = steps.filter(s => s.type === 'BUS');
    const walkSteps = steps.filter(s => s.type === 'WALK' || s._isWalk);
    const transfers = Math.max(0, busSteps.length - 1);
    
    const walkingDurationMin = walkSteps.reduce((acc, s) => {
      const m = (s.duration || '').match(/(\d+)/);
      return acc + (m ? parseInt(m[1], 10) : 0);
    }, 0);
    
    const arrMinutes = parseTimeToMinutes(it.arrivalTime);
    // Distance à l'heure cible (on veut arriver le plus proche possible AVANT ou égal)
    // arrivalDiff = 0 si arrivée = heure cible (parfait)
    // arrivalDiff > 0 si arrivée avant l'heure cible (ok, plus petit = mieux car plus proche de la cible)
    // arrivalDiff = Infinity si arrivée après l'heure cible (mauvais - trop tard!)
    const arrivalDiff = targetMinutes - arrMinutes;
    
    return {
      it,
      arrMinutes,
      arrTime: it.arrivalTime, // Pour debug
      arrivalDiff: arrivalDiff >= 0 ? arrivalDiff : Infinity, // Pénaliser les arrivées tardives
      transfers,
      walkingDurationMin,
      durationRaw: it.durationRaw || 0
    };
  });

  // Trier: meilleure arrivée (plus proche de l'heure cible sans dépasser), moins de correspondances
  scored.sort((a, b) => {
    // D'abord par proximité d'arrivée à l'heure cible (0 = parfait, petit = proche de la cible)
    if (a.arrivalDiff !== b.arrivalDiff) return a.arrivalDiff - b.arrivalDiff;
    // Puis par nombre de correspondances
    if (a.transfers !== b.transfers) return a.transfers - b.transfers;
    // Puis par temps de marche
    if (a.walkingDurationMin !== b.walkingDurationMin) return a.walkingDurationMin - b.walkingDurationMin;
    // Enfin par durée totale
    return a.durationRaw - b.durationRaw;
  });

  console.log('📋 Après tri ARRIVER (arrivée la plus proche de la cible en premier):', scored.slice(0, 8).map(s => ({
    arr: s.arrTime,
    arrMin: s.arrMinutes,
    diff: s.arrivalDiff === Infinity ? '∞ (trop tard!)' : s.arrivalDiff + 'min avant cible',
    dep: s.it.departureTime,
    transfers: s.transfers
  })));

  return scored.map(x => x.it);
}

/**
 * Trie les itinéraires pour le mode "partir".
 * Priorité: premier départ (>= heure demandée), moins de correspondances, durée totale plus courte.
 */
export function rankDepartureItineraries(itineraries) {
  if (!Array.isArray(itineraries) || !itineraries.length) return itineraries;
  
  console.log(`🎯 rankDepartureItineraries: ${itineraries.length} itinéraires à trier`);
  
  // Debug: afficher tous les itinéraires avant tri
  console.log('📋 Avant tri (heures de départ):', itineraries.map(it => it.departureTime).join(', '));
  
  const scored = itineraries.map(it => {
    const steps = Array.isArray(it.steps) ? it.steps : [];
    const busSteps = steps.filter(s => s.type === 'BUS');
    const transfers = Math.max(0, busSteps.length - 1);
    const depMinutes = parseTimeToMinutes(it.departureTime);
    
    // Durée totale en minutes
    let durationMin = 0;
    const durationMatch = (it.duration || '').match(/(\d+)/);
    if (durationMatch) durationMin = parseInt(durationMatch[1], 10);
    
    return {
      it,
      depMinutes,
      depTime: it.departureTime, // Pour debug
      transfers,
      durationMin
    };
  });

  // Trier: plus tôt d'abord
  scored.sort((a, b) => {
    // D'abord par heure de départ (plus tôt = meilleur)
    if (a.depMinutes !== b.depMinutes) return a.depMinutes - b.depMinutes;
    // Puis par nombre de correspondances
    if (a.transfers !== b.transfers) return a.transfers - b.transfers;
    // Enfin par durée totale
    return a.durationMin - b.durationMin;
  });

  console.log('📋 Après tri PARTIR (du plus tôt au plus tard):', scored.slice(0, 8).map(s => ({
    dep: s.depTime,
    depMin: s.depMinutes,
    arr: s.it.arrivalTime,
    transfers: s.transfers
  })));

  return scored.map(x => x.it);
}
