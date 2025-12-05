/**
 * ranking.js
 * Logique de déduplication, tri et filtrage pour les itinéraires.
 */

import { parseTimeStringToMinutes } from '../utils/formatters.js';

// V120: Configuration minimum d'itinéraires bus
const MIN_BUS_ITINERARIES = 5;

/**
 * Déduplique les itinéraires par structure de trajet (même séquence bus/arrêts).
 * En mode "partir", garde le premier départ pour chaque structure.
 * En mode "arriver", garde les 3 meilleurs horaires par structure (plus de choix).
 * V115: Amélioration - en mode arriver, on garde plusieurs variantes horaires
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
  grouped.forEach((variants, key) => {
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
      // V115: En mode arriver, on garde les 3 derniers départs (les plus proches de l'heure demandée)
      // Cela donne plus de choix à l'utilisateur
      const MAX_VARIANTS_ARRIVER = 3;
      const startIdx = Math.max(0, variants.length - MAX_VARIANTS_ARRIVER);
      result.push(...variants.slice(startIdx));
    } else {
      // En mode partir, on veut le premier départ seulement
      result.push(variants[0]);
    }
  });
  
  console.log(`🔄 Déduplication (${searchMode}): ${list.length} → ${result.length} itinéraires`);
  
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
 * V70: Amélioration - ne filtre que si la recherche est pour aujourd'hui ET l'heure est passée
 */
export function filterExpiredDepartures(itineraries, searchTime = null) {
  if (!Array.isArray(itineraries)) return [];
  
  // Si pas de searchTime, pas de filtrage
  if (!searchTime) {
    return itineraries;
  }
  
  // V195: Normaliser la date de recherche
  let searchDate;
  const searchDateRaw = searchTime.date;
  
  if (!searchDateRaw || searchDateRaw === 'today' || searchDateRaw === "Aujourd'hui") {
    searchDate = new Date();
  } else if (searchDateRaw instanceof Date) {
    searchDate = searchDateRaw;
  } else {
    searchDate = new Date(searchDateRaw);
  }
  
  // Si date invalide, ne pas filtrer
  if (isNaN(searchDate.getTime())) {
    console.warn('⚠️ filterExpiredDepartures: date invalide, pas de filtrage');
    return itineraries;
  }
  
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const searchDateStr = `${searchDate.getFullYear()}-${String(searchDate.getMonth() + 1).padStart(2, '0')}-${String(searchDate.getDate()).padStart(2, '0')}`;
  
  // V195: Si la recherche est pour une date FUTURE, ne pas filtrer les trajets passés
  if (searchDateStr !== todayStr) {
    console.log(`📅 V195: Recherche pour ${searchDateStr} (≠ aujourd'hui ${todayStr}) → pas de filtrage horaire`);
    return itineraries;
  }
  
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  
  // V70: Si l'heure de recherche est dans le futur, utiliser cette heure comme référence
  if (searchTime.hour !== undefined) {
    const searchHour = parseInt(searchTime.hour) || 0;
    const searchMinute = parseInt(searchTime.minute) || 0;
    const searchMinutes = searchHour * 60 + searchMinute;
    
    // Si l'heure de recherche est dans le futur, ne pas filtrer
    if (searchMinutes > nowMinutes) {
      console.log(`🕐 V195: Recherche à ${searchHour}:${String(searchMinute).padStart(2,'0')} (futur) → pas de filtrage`);
      return itineraries;
    }
  }
  
  console.log(`🕐 Filtrage des trajets passés (maintenant: ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')})`);
  
  const filtered = itineraries.filter(it => {
    // V142: Ne jamais filtrer vélo/marche - ils n'ont pas d'horaire fixe
    const type = it?.type;
    if (type === 'BIKE' || type === 'WALK' || it?._isBike || it?._isWalk) {
      return true;
    }
    
    const depTime = it?.departureTime;
    if (!depTime || depTime === '~' || depTime === '--:--') return true;
    
    const depMinutes = parseTimeToMinutes(depTime);
    if (depMinutes === Infinity) return true;
    
    // V185: Détection des trajets du lendemain
    // Si l'heure de départ est très inférieure à maintenant (plus de 6h de différence),
    // c'est probablement un trajet du lendemain matin -> on le filtre
    const timeDiff = nowMinutes - depMinutes;
    if (timeDiff > 360) { // Plus de 6h d'écart (ex: 23:00 vs 06:00)
      console.log(`🚫 Trajet ${depTime} filtré (probablement lendemain, diff: ${timeDiff}min)`);
      return false;
    }
    
    // Garder si départ >= maintenant (avec 2 min de marge)
    return depMinutes >= (nowMinutes - 2);
  });
  
  const removed = itineraries.length - filtered.length;
  if (removed > 0) {
    console.log(`🚫 ${removed} trajet(s) passé(s) filtré(s)`);
  }
  
  return filtered;
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
 * V142: Tri par type (BUS d'abord) puis par heure d'arrivée DÉCROISSANTE
 * L'utilisateur veut arriver à 16h -> les trajets BUS les plus proches de 16h en premier
 */
export function rankArrivalItineraries(itineraries, searchTime) {
  if (!searchTime || searchTime.type !== 'arriver') return itineraries;
  if (!Array.isArray(itineraries) || !itineraries.length) return itineraries;
  
  const targetHour = parseInt(searchTime.hour) || 0;
  const targetMinute = parseInt(searchTime.minute) || 0;
  const targetMinutes = targetHour * 60 + targetMinute;
  
  console.log(`🎯 rankArrivalItineraries: cible ${String(targetHour).padStart(2,'0')}:${String(targetMinute).padStart(2,'0')} (${targetMinutes}min), ${itineraries.length} itinéraires`);
  
  // V142: Séparer par type pour garder BUS en premier
  const busItins = itineraries.filter(it => it.type !== 'BIKE' && it.type !== 'WALK' && !it._isBike && !it._isWalk);
  const bikeItins = itineraries.filter(it => it.type === 'BIKE' || it._isBike);
  const walkItins = itineraries.filter(it => it.type === 'WALK' || it._isWalk);
  
  // Trier les bus par arrivée DÉCROISSANTE (plus proche de l'heure cible en premier)
  busItins.sort((a, b) => {
    const arrA = parseTimeToMinutes(a.arrivalTime);
    const arrB = parseTimeToMinutes(b.arrivalTime);
    
    // Filtrer les arrivées après l'heure demandée (trop tard)
    const aValid = arrA <= targetMinutes;
    const bValid = arrB <= targetMinutes;
    if (aValid !== bValid) return aValid ? -1 : 1;
    
    // Trier par arrivée DÉCROISSANTE (15h55 > 15h45 > 15h30)
    return arrB - arrA;
  });

  // Recomposer: BUS triés, puis BIKE, puis WALK
  const sorted = [...busItins, ...bikeItins, ...walkItins];

  console.log('📋 Tri ARRIVER (BUS d\'abord, arrivée décroissante):', sorted.slice(0, 5).map(it => `${it.type}:${it.arrivalTime}`).join(', '));

  return sorted;
}

/**
 * Trie les itinéraires pour le mode "partir".
 * Priorité: premier départ (>= heure demandée), moins de correspondances, durée totale plus courte.
 */
/**
 * V64: Limite les trajets vélo et piéton à un seul de chaque.
 * Ces modes n'ont pas d'horaires (on peut partir quand on veut),
 * donc avoir plusieurs résultats est inutile.
 * V120: Garantit au minimum MIN_BUS_ITINERARIES trajets bus si disponibles
 */
export function limitBikeWalkItineraries(itineraries, minBusRequired = MIN_BUS_ITINERARIES) {
  if (!Array.isArray(itineraries)) return [];
  
  const busItineraries = [];
  let firstBike = null;
  let firstWalk = null;
  
  for (const it of itineraries) {
    const type = it?.type || 'BUS';
    
    if (type === 'BIKE' || it?._isBike) {
      if (!firstBike) {
        firstBike = it;
      }
      // Ignorer les doublons vélo
    } else if (type === 'WALK' || it?._isWalk) {
      if (!firstWalk) {
        firstWalk = it;
      }
      // Ignorer les doublons piéton
    } else {
      // Bus/Transit : garder tous
      busItineraries.push(it);
    }
  }
  
  // V120: Log si on a moins de bus que le minimum souhaité
  if (busItineraries.length < minBusRequired && busItineraries.length > 0) {
    console.log(`⚠️ V120: Seulement ${busItineraries.length} trajet(s) bus trouvé(s) (minimum souhaité: ${minBusRequired})`);
  }
  
  // Reconstruire la liste : BUS d'abord, puis vélo, puis piéton
  const result = [...busItineraries];
  if (firstBike) result.push(firstBike);
  if (firstWalk) result.push(firstWalk);
  
  const removed = itineraries.length - result.length;
  if (removed > 0) {
    console.log(`🚴 V64: ${removed} trajet(s) vélo/piéton en double supprimé(s)`);
  }
  
  console.log(`📊 V120: ${busItineraries.length} bus, ${firstBike ? 1 : 0} vélo, ${firstWalk ? 1 : 0} marche`);
  
  return result;
}

/**
 * V120: Compte le nombre d'itinéraires bus dans une liste
 */
export function countBusItineraries(itineraries) {
  if (!Array.isArray(itineraries)) return 0;
  return itineraries.filter(it => {
    const type = it?.type || 'BUS';
    return type !== 'BIKE' && type !== 'WALK' && !it?._isBike && !it?._isWalk;
  }).length;
}

/**
 * V120: Retourne le minimum d'itinéraires bus configuré
 */
export function getMinBusItineraries() {
  return MIN_BUS_ITINERARIES;
}

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
