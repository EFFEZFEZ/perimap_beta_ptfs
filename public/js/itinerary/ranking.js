/**
 * ranking.js
 * Logique de déduplication, tri et pagination spécifique au mode "arriver".
 */

export function deduplicateItineraries(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter(it => {
    const key = createSignature(it);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createSignature(it) {
  if (!it) return 'null';
  return [it.type, it.departureTime, it.arrivalTime, it.duration, (it.summarySegments||[]).length, (it.steps||[]).length, it.tripId || it.trip?.trip_id || ''].join('|');
}

export function rankArrivalItineraries(itineraries, searchTime) {
  if (!searchTime || searchTime.type !== 'arriver') return itineraries;
  let baseDate;
  if (!searchTime.date || searchTime.date === 'today' || searchTime.date === "Aujourd'hui") baseDate = new Date();
  else baseDate = new Date(searchTime.date);
  baseDate.setHours(parseInt(searchTime.hour)||0, parseInt(searchTime.minute)||0, 0, 0);

  const parseArrivalMs = (arrivalStr) => {
    if (!arrivalStr || typeof arrivalStr !== 'string') return Infinity;
    const m = arrivalStr.match(/(\d{1,2}):(\d{2})/);
    if (!m) return Infinity;
    const hh = parseInt(m[1], 10); const mm = parseInt(m[2], 10);
    const d = new Date(baseDate); d.setHours(hh, mm, 0, 0); return d.getTime();
  };

  const scored = itineraries.map(it => {
    const steps = Array.isArray(it.steps) ? it.steps : [];
    const busSteps = steps.filter(s => s.type === 'BUS');
    const walkSteps = steps.filter(s => s.type === 'WALK' || s._isWalk);
    const transfers = Math.max(0, busSteps.length - 1);
    const walkingDurationMin = walkSteps.reduce((acc, s) => {
      const m = (s.duration||'').match(/(\d+)/); return acc + (m ? parseInt(m[1],10) : 0);
    }, 0);
    return {
      it,
      arrivalMs: parseArrivalMs(it.arrivalTime),
      transfers,
      walkingDurationMin,
      durationRaw: it.durationRaw || 0
    };
  });

  scored.sort((a, b) => {
    if (a.arrivalMs !== b.arrivalMs) return a.arrivalMs - b.arrivalMs;
    if (a.transfers !== b.transfers) return a.transfers - b.transfers;
    if (a.walkingDurationMin !== b.walkingDurationMin) return a.walkingDurationMin - b.walkingDurationMin;
    return a.durationRaw - b.durationRaw;
  });

  return scored.map(x => x.it);
}
