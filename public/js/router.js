const GTFS_TRIPS_CACHE_TTL_MS = 60 * 1000; // 60s cache

export const HYBRID_ROUTING_CONFIG = Object.freeze({
    STOP_SEARCH_RADIUS_M: 600,         // Augmenté de 500 à 600 pour inclure plus d'arrêts
    STOP_SEARCH_LIMIT: 15,             // Augmenté de 12 à 15
    MAX_ITINERARIES: 12,
    WALK_DIRECT_MAX_METERS: 100,
    ENABLE_TRANSFERS: true,
    TRANSFER_MAX_ITINERARIES: 6,       // Augmenté de 4 à 6
    TRANSFER_MIN_BUFFER_SECONDS: 180,
    TRANSFER_MAX_WAIT_SECONDS: 2400,   // Augmenté de 1800 (30min) à 2400 (40min)
    TRANSFER_MAX_FIRST_LEG_STOPS: 15,  // Augmenté de 8 à 15 pour atteindre les hubs de correspondance
    TRANSFER_CANDIDATE_TRIPS_LIMIT: 40, // Augmenté de 20 à 40
    TRANSFER_WALK_RADIUS_M: 250        // Augmenté de 200 à 250 pour mieux connecter les arrêts proches
});

const AVERAGE_WALK_SPEED_MPS = 1.35; // ~4.8 km/h

export function createRouterContext({ dataManager, apiManager, icons }) {
    const placeIdCache = new Map();
    const gtfsTripsCache = new Map();

    const getWalkingRoute = (startPoint, endPoint) => getWalkingRouteInternal({ dataManager, apiManager, placeIdCache }, startPoint, endPoint);
    const getCachedTripsBetweenStops = (startIds, endIds, reqDate, windowStartSec, windowEndSec) =>
        getCachedTripsBetweenStopsInternal({ dataManager, gtfsTripsCache }, startIds, endIds, reqDate, windowStartSec, windowEndSec);

    return {
        computeHybridItinerary: (fromCoordsRaw, toCoordsRaw, searchTime, labels = {}, forcedStops = {}) =>
            computeHybridItineraryInternal({
                dataManager,
                icons,
                config: HYBRID_ROUTING_CONFIG,
                getWalkingRoute,
                getCachedTripsBetweenStops,
                encodePolyline,
                computeWalkDurationSeconds
            }, fromCoordsRaw, toCoordsRaw, searchTime, labels, forcedStops)
    };
}

function computeWalkDurationSeconds(distanceMeters) {
    if (!distanceMeters || Number.isNaN(distanceMeters)) return 0;
    return Math.max(30, Math.round(distanceMeters / AVERAGE_WALK_SPEED_MPS));
}

export function encodePolyline(points) {
    const encodeSigned = (num) => {
        let sgnNum = Math.round(num * 1e5);
        sgnNum = sgnNum < 0 ? ~(sgnNum << 1) : sgnNum << 1;
        let out = '';
        while (sgnNum >= 0x20) {
            out += String.fromCharCode((0x20 | (sgnNum & 0x1f)) + 63);
            sgnNum >>= 5;
        }
        out += String.fromCharCode(sgnNum + 63);
        return out;
    };

    let lastLat = 0;
    let lastLng = 0;
    let result = '';
    for (const [lat, lng] of points) {
        const latE5 = Math.round(lat * 1e5);
        const lngE5 = Math.round(lng * 1e5);
        const dLat = latE5 - lastLat;
        const dLng = lngE5 - lastLng;
        result += encodeSigned(dLat);
        result += encodeSigned(dLng);
        lastLat = latE5;
        lastLng = lngE5;
    }
    return result;
}

export function decodePolyline(encoded) {
    if (!encoded) return [];
    const poly = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;
    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;
        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;
        poly.push([lat / 1e5, lng / 1e5]);
    }
    return poly;
}

async function getWalkingRouteInternal(context, startPoint, endPoint) {
    const { dataManager, apiManager } = context;
    if (!startPoint || !endPoint) return null;
    const distance = dataManager.calculateDistance(startPoint.lat, startPoint.lon, endPoint.lat, endPoint.lon);
    if (!distance || Number.isNaN(distance)) return null;

    if (distance <= HYBRID_ROUTING_CONFIG.WALK_DIRECT_MAX_METERS) {
        const encoded = encodePolyline([[startPoint.lat, startPoint.lon], [endPoint.lat, endPoint.lon]]);
        return {
            encodedPolyline: encoded,
            distanceMeters: Math.round(distance),
            durationSeconds: computeWalkDurationSeconds(distance),
            source: 'direct'
        };
    }

    if (apiManager?.fetchWalkingRoute) {
        try {
            const startPid = await getCachedPlaceIdInternal(context, startPoint.lat, startPoint.lon);
            const endPid = await getCachedPlaceIdInternal(context, endPoint.lat, endPoint.lon);
            if (startPid && endPid) {
                const walkData = await apiManager.fetchWalkingRoute(startPid, endPid);
                const route = walkData?.routes?.[0];
                const encoded = route?.polyline?.encodedPolyline || route?.polyline;
                if (encoded) {
                    const durationSec = parseInt(route?.duration?.replace('s', ''), 10);
                    return {
                        encodedPolyline: encoded,
                        distanceMeters: Math.round(route?.distanceMeters || distance),
                        durationSeconds: durationSec && !Number.isNaN(durationSec) ? durationSec : computeWalkDurationSeconds(distance),
                        source: 'api'
                    };
                }
            }
        } catch (err) {
            console.warn('Erreur getWalkingRoute, fallback segment direct:', err);
        }
    }

    const fallbackEncoded = encodePolyline([[startPoint.lat, startPoint.lon], [endPoint.lat, endPoint.lon]]);
    return {
        encodedPolyline: fallbackEncoded,
        distanceMeters: Math.round(distance),
        durationSeconds: computeWalkDurationSeconds(distance),
        source: 'fallback'
    };
}

async function getCachedPlaceIdInternal(context, lat, lon) {
    const { apiManager, placeIdCache } = context;
    const key = `${lat},${lon}`;
    if (placeIdCache.has(key)) return placeIdCache.get(key);
    if (!apiManager?.reverseGeocode) {
        return null;
    }
    try {
        const pid = await apiManager.reverseGeocode(lat, lon);
        if (pid) placeIdCache.set(key, pid);
        return pid;
    } catch (e) {
        console.warn('reverseGeocode failed for', key, e);
        return null;
    }
}

function getCachedTripsBetweenStopsInternal(context, startIds, endIds, reqDate, windowStartSec, windowEndSec) {
    const { dataManager, gtfsTripsCache } = context;
    try {
        const key = JSON.stringify({ startIds: startIds.slice().sort(), endIds: endIds.slice().sort(), date: reqDate.toISOString().split('T')[0], windowStartSec, windowEndSec });
        const now = Date.now();
        const cached = gtfsTripsCache.get(key);
        if (cached && (now - cached.ts) < GTFS_TRIPS_CACHE_TTL_MS) {
            return cached.value;
        }
        const result = dataManager.getTripsBetweenStops(startIds, endIds, reqDate, windowStartSec, windowEndSec) || [];
        gtfsTripsCache.set(key, { ts: now, value: result });
        return result;
    } catch (err) {
        console.warn('getCachedTripsBetweenStops error', err);
        return dataManager.getTripsBetweenStops(startIds, endIds, reqDate, windowStartSec, windowEndSec) || [];
    }
}

async function computeHybridItineraryInternal(context, fromCoordsRaw, toCoordsRaw, searchTime, labels = {}, forcedStops = {}) {
    // Réinitialiser les flags de debug pour chaque nouvelle recherche
    globalThis._transferHubsLogged = false;
    globalThis._hubDebugLogged = false;
    globalThis._assembleDebugLogged = false;
    globalThis._transferResultsLogged = false;
    globalThis._routerGroupMapLogged = false;
    
    const dataManager = context.dataManager;
    const ICONS = context.icons;
    const HYBRID_ROUTING_CONFIG = context.config;
    const getWalkingRoute = context.getWalkingRoute;
    const getCachedTripsBetweenStops = context.getCachedTripsBetweenStops;
    const encodePolyline = context.encodePolyline;
    const computeWalkDurationSeconds = context.computeWalkDurationSeconds;
    
    // V49: Arrêts forcés pour pôles multimodaux (ex: Campus = Campus + Grenadière)
    const forcedOriginStops = forcedStops?.from || null;
    const forcedDestinationStops = forcedStops?.to || null;

    if (!dataManager || !dataManager.isLoaded) return [];

    const STOP_PLACEHOLDER_TOKENS = new Set(['undefined', 'null', '--', '—', 'n/a', 'na', 'inconnu', 'unknown']);
    const sanitizeStopText = (value) => {
        if (value === undefined || value === null) return null;
        if (typeof value === 'number') return String(value);
        const trimmed = String(value).trim();
        if (!trimmed) return null;
        const normalized = trimmed.toLowerCase();
        if (STOP_PLACEHOLDER_TOKENS.has(normalized)) return null;
        if (/^[-–—\s:._]+$/.test(trimmed)) return null;
        return trimmed;
    };

    const getStopDisplayName = (stop) => {
        if (!stop) return null;
        const direct = sanitizeStopText(stop.stop_name);
        if (direct) return direct;
        if (stop.parent_station) {
            const parent = dataManager.getStop(stop.parent_station);
            const parentName = sanitizeStopText(parent?.stop_name);
            if (parentName) return parentName;
        }
        const viaCode = sanitizeStopText(stop.stop_code);
        if (viaCode) return viaCode;
        return stop.stop_id || null;
    };

    const normalizeCoords = (coord) => {
        if (!coord) return null;
        const lat = parseFloat(coord.lat ?? coord.latitude);
        const lon = parseFloat(coord.lon ?? coord.lng ?? coord.longitude);
        if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
        return { lat, lon };
    };

    const origin = normalizeCoords(fromCoordsRaw);
    const destination = normalizeCoords(toCoordsRaw);

    const toPoint = (stop) => {
        if (!stop) return null;
        const lat = parseFloat(stop.stop_lat);
        const lon = parseFloat(stop.stop_lon);
        if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
        return { lat, lon };
    };

    const MAX_STOP_RADIUS_METERS = HYBRID_ROUTING_CONFIG.STOP_SEARCH_RADIUS_M || 1200;
    const MAX_STOP_CANDIDATES = HYBRID_ROUTING_CONFIG.STOP_SEARCH_LIMIT || 5;

    const normalizeText = (value) => (value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .trim();

    const findStopsByLabel = (label, limit = MAX_STOP_CANDIDATES * 2) => {
        if (!label) return [];
        const directMatches = (dataManager.findStopsByName && dataManager.findStopsByName(label, limit)) || [];
        if (directMatches.length) return directMatches.slice(0, limit);
        const normalizedLabel = normalizeText(label);
        if (!normalizedLabel) return [];
        const fallback = [];
        for (const stop of dataManager.stops) {
            if (fallback.length >= limit) break;
            const stopName = normalizeText(stop.stop_name);
            if (stopName && stopName.includes(normalizedLabel)) {
                fallback.push(stop);
            }
        }
        return fallback;
    };

    const collectStopsWithinRadius = (point, label, nameHint, forcedStopIds = null) => {
        const candidates = [];
        const seenIds = new Set();
        const addCandidate = (stop, distance, isForced = false) => {
            if (!stop || seenIds.has(stop.stop_id)) return;
            seenIds.add(stop.stop_id);
            candidates.push({ stop, distance: Number.isFinite(distance) ? distance : null, isForced });
        };

        // V49: Ajouter d'abord les arrêts forcés (pôles multimodaux) avec priorité maximale
        if (forcedStopIds && Array.isArray(forcedStopIds)) {
            for (const stopId of forcedStopIds) {
                const stop = dataManager.getStop(stopId);
                if (stop) {
                    const lat = parseFloat(stop.stop_lat);
                    const lon = parseFloat(stop.stop_lon);
                    const dist = point && !Number.isNaN(lat) && !Number.isNaN(lon) 
                        ? dataManager.calculateDistance(point.lat, point.lon, lat, lon)
                        : 0;
                    addCandidate(stop, dist, true);
                    console.log(`📍 Pôle multimodal: arrêt forcé ${stop.stop_name || stopId} ajouté`);
                }
            }
        }

        // Collecter TOUS les arrêts dans le rayon (pas de limite prématurée)
        if (point) {
            for (const stop of dataManager.stops) {
                const lat = parseFloat(stop.stop_lat);
                const lon = parseFloat(stop.stop_lon);
                if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
                const dist = dataManager.calculateDistance(point.lat, point.lon, lat, lon);
                if (Number.isNaN(dist) || dist > MAX_STOP_RADIUS_METERS) continue;
                addCandidate(stop, dist);
            }
        }

        const nameFallback = nameHint || label;
        if ((!point || candidates.length === 0) && nameFallback) {
            const namedStops = findStopsByLabel(nameFallback);
            namedStops.forEach((stop, index) => {
                const dist = point
                    ? dataManager.calculateDistance(point.lat, point.lon, parseFloat(stop.stop_lat), parseFloat(stop.stop_lon))
                    : (index * 50);
                addCandidate(stop, dist);
            });
        }

        if (!point && candidates.length === 0) {
            console.warn(`⚠️ Hybrid: aucun repère géographique pour ${label}, utilisation d'un fallback par lignes principales.`);
            dataManager.stops.slice(0, MAX_STOP_CANDIDATES).forEach(stop => addCandidate(stop, null));
        }

        if (!candidates.length) {
            console.warn(`⚠️ Hybrid: aucun arrêt trouvé pour ${label}.`);
            return [];
        }

        // Trier par: 1) Arrêts forcés (pôles multimodaux), 2) Quays, 3) distance
        candidates.sort((a, b) => {
            // V49: Prioriser les arrêts forcés (pôles multimodaux)
            if (a.isForced !== b.isForced) {
                return a.isForced ? -1 : 1;  // Forced stops first
            }
            // Prioriser les Quays (arrêts avec horaires) sur les StopPlaces (stations)
            const isQuayA = a.stop.location_type !== '1';
            const isQuayB = b.stop.location_type !== '1';
            if (isQuayA !== isQuayB) {
                return isQuayA ? -1 : 1;  // Quays first
            }
            const distA = (a.distance == null) ? Infinity : a.distance;
            const distB = (b.distance == null) ? Infinity : b.distance;
            if (distA === distB) {
                const nameA = getStopDisplayName(a.stop) || a.stop.stop_name || '';
                const nameB = getStopDisplayName(b.stop) || b.stop.stop_name || '';
                return nameA.localeCompare(nameB);
            }
            return distA - distB;
        });

        const limited = candidates.slice(0, MAX_STOP_CANDIDATES);
        const best = limited[0];
        if (best) {
            const distanceLabel = (best.distance != null) ? `${Math.round(best.distance)} m` : 'distance inconnue';
            const bestName = getStopDisplayName(best.stop) || best.stop.stop_name || best.stop.stop_id || 'arrêt inconnu';
            console.log(`🔎 Hybrid: ${limited.length} arrêt(s) candidats pour ${label}. Meilleur: ${bestName} (${distanceLabel}).`);
        }
        return limited;
    };

    const buildRequestedDate = () => {
        try {
            let baseDate;
            if (!searchTime?.date || searchTime.date === 'today' || searchTime.date === "Aujourd'hui") {
                baseDate = new Date();
            } else {
                baseDate = new Date(searchTime.date);
            }
            const hour = parseInt(searchTime?.hour, 10) || 0;
            const minute = parseInt(searchTime?.minute, 10) || 0;
            baseDate.setHours(hour, minute, 0, 0);
            return baseDate;
        } catch (err) {
            console.warn('⚠️ Hybrid: date invalide, utilisation de la date courante.', err);
            return new Date();
        }
    };

    // V49: Passer les arrêts forcés des pôles multimodaux
    const originCandidates = collectStopsWithinRadius(origin, 'l’origine', labels?.fromLabel || labels?.fromName, forcedOriginStops);
    const destCandidates = collectStopsWithinRadius(destination, 'la destination', labels?.toLabel || labels?.toName, forcedDestinationStops);
    if (!originCandidates.length || !destCandidates.length) return [];

    const reqDate = buildRequestedDate();

    const geometryToLatLngs = (geometry) => {
        if (!geometry) return null;
        const toLatLng = (pair) => [pair[1], pair[0]]; // [lat, lng]
        if (Array.isArray(geometry)) {
            if (!geometry.length) return null;
            if (typeof geometry[0][0] === 'number') {
                return geometry.map(toLatLng);
            }
            if (Array.isArray(geometry[0])) {
                return geometry.flat().map(toLatLng);
            }
        }
        if (geometry.type === 'LineString') {
            return geometry.coordinates.map(toLatLng);
        }
        if (geometry.type === 'MultiLineString') {
            return geometry.coordinates.flat().map(toLatLng);
        }
        return null;
    };

    const findIndexOnPolyline = (points, targetPoint) => {
        if (!points || !targetPoint) return null;
        let bestIdx = null;
        let bestDist = Infinity;
        for (let i = 0; i < points.length; i++) {
            const dist = dataManager.calculateDistance(targetPoint.lat, targetPoint.lon, points[i][0], points[i][1]);
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
            }
        }
        return bestIdx;
    };

    const slicePolylineBetween = (points, startPoint, endPoint) => {
        if (!points || points.length < 2 || !startPoint || !endPoint) return null;
        const startIdx = findIndexOnPolyline(points, startPoint);
        const endIdx = findIndexOnPolyline(points, endPoint);
        if (startIdx == null || endIdx == null) {
            return null;
        }
        if (startIdx === endIdx) {
            return [points[startIdx], points[endIdx]];
        }
        if (startIdx < endIdx) {
            return points.slice(startIdx, endIdx + 1);
        }
        const reversed = points.slice(endIdx, startIdx + 1).reverse();
        return reversed;
    };

    const buildBusLegStep = (segment, boardingStop, alightingStop) => {
        if (!segment || !boardingStop || !alightingStop) return null;
        const boardingPoint = toPoint(boardingStop);
        const alightingPoint = toPoint(alightingStop);
        if (!boardingPoint || !alightingPoint) return null;

        const boardingStopName = getStopDisplayName(boardingStop);
        const alightingStopName = getStopDisplayName(alightingStop);

        let geometry = dataManager.getRouteGeometry(segment.routeId);
        if (!geometry && segment.shapeId) {
            geometry = dataManager.getShapeGeoJSON(segment.shapeId, segment.routeId);
        }

        let latLngPolyline = geometryToLatLngs(geometry);
        let slicedPolyline = slicePolylineBetween(latLngPolyline, boardingPoint, alightingPoint);
        if (!slicedPolyline || slicedPolyline.length < 2) {
            slicedPolyline = [
                [boardingPoint.lat, boardingPoint.lon],
                [alightingPoint.lat, alightingPoint.lon]
            ];
        }
        let busPolylineLatLngs = slicedPolyline
            .map((pair) => [Number(pair[0]), Number(pair[1])])
            .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
        if (busPolylineLatLngs.length < 2) {
            busPolylineLatLngs = [
                [boardingPoint.lat, boardingPoint.lon],
                [alightingPoint.lat, alightingPoint.lon]
            ];
        }
        const busPolylineEncoded = encodePolyline(busPolylineLatLngs);

        const durationSeconds = Math.max(0, segment.arrivalSeconds - segment.departureSeconds);
        
        // V62: Inclure les coordonnées des arrêts intermédiaires
        const intermediateStops = (segment.stopTimes || [])
            .slice(1, -1)
            .map(st => {
                const stopObj = dataManager.getStop(st.stop_id);
                return {
                    name: getStopDisplayName(stopObj) || st.stop_id,
                    stop_id: st.stop_id,
                    lat: stopObj ? parseFloat(stopObj.stop_lat) : null,
                    lng: stopObj ? parseFloat(stopObj.stop_lon) : null
                };
            })
            .filter(s => s.name); // Filtrer les arrêts sans nom
        const route = segment.route || dataManager.getRoute(segment.routeId);
        const busStep = {
            type: 'BUS',
            icon: ICONS.BUS,
            instruction: `Prendre ${route?.route_short_name || segment.routeId}`,
            polyline: { encodedPolyline: busPolylineEncoded, latLngs: busPolylineLatLngs },
            routeColor: route?.route_color ? `#${route.route_color}` : '#3388ff',
            routeTextColor: route?.route_text_color ? `#${route.route_text_color}` : '#ffffff',
            routeShortName: route?.route_short_name || segment.routeId,
            departureStop: boardingStopName || 'Arrêt de départ',
            arrivalStop: alightingStopName || 'Arrêt d’arrivée',
            departureTime: dataManager.formatTime(segment.departureSeconds),
            arrivalTime: dataManager.formatTime(segment.arrivalSeconds),
            duration: dataManager.formatDuration(durationSeconds) || 'Horaires théoriques',
            intermediateStops,
            numStops: Math.max(0, (segment.stopTimes || []).length - 1),
            _durationSeconds: durationSeconds
        };

        return {
            step: busStep,
            summary: {
                type: 'BUS',
                name: route?.route_short_name || segment.routeId,
                color: route?.route_color ? `#${route.route_color}` : '#3388ff',
                textColor: route?.route_text_color ? `#${route.route_text_color}` : '#ffffff'
            }
        };
    };

    const assembleTransferItinerary = async ({
        firstSegment,
        secondSegment,
        boardingStop,
        transferStop,
        finalStop,
        origin,
        destination,
        originCandidates,
        destCandidates,
        windowStartSec,
        windowEndSec,
        startStopSet = new Set(),
        endStopSet = new Set()
    }) => {
        if (!firstSegment || !secondSegment || !boardingStop || !transferStop || !finalStop) {
            console.warn('assembleTransferItinerary: missing required params', {
                firstSegment: !!firstSegment,
                secondSegment: !!secondSegment,
                boardingStop: !!boardingStop,
                transferStop: !!transferStop,
                finalStop: !!finalStop
            });
            return null;
        }

        const boardingStopName = getStopDisplayName(boardingStop);
        const transferStopName = getStopDisplayName(transferStop);
        const finalStopName = getStopDisplayName(finalStop);

        const originMatch = originCandidates.find(c => c.stop.stop_id === boardingStop.stop_id);
        const destMatch = destCandidates.find(c => c.stop.stop_id === finalStop.stop_id);

        const itinerary = {
            type: 'BUS',
            steps: [],
            summarySegments: [],
            transfers: 1,
            tripId: `${firstSegment.tripId}+${secondSegment.tripId}`,
            route: secondSegment.route
        };

        const boardingPoint = toPoint(boardingStop);
        const finalPoint = toPoint(finalStop);
        if (!boardingPoint || !finalPoint) return null;

        const approachLabel = boardingStopName ? `Marcher jusqu’à ${boardingStopName}` : 'Marcher jusqu’à l’arrêt';
        const approachStep = await buildWalkStep(approachLabel, origin, boardingPoint);
        if (approachStep) {
            itinerary.steps.push(approachStep);
        }

        const firstLeg = buildBusLegStep(firstSegment, boardingStop, transferStop);
        if (!firstLeg) {
            console.warn('assembleTransferItinerary: firstLeg build failed');
            return null;
        }
        itinerary.steps.push(firstLeg.step);
        itinerary.summarySegments.push(firstLeg.summary);

        const waitSeconds = Math.max(0, secondSegment.departureSeconds - firstSegment.arrivalSeconds);

        const secondLeg = buildBusLegStep(secondSegment, transferStop, finalStop);
        if (!secondLeg) {
            console.warn('assembleTransferItinerary: secondLeg build failed');
            return null;
        }
        itinerary.steps.push(secondLeg.step);
        itinerary.summarySegments.push(secondLeg.summary);

        const egressStep = await buildWalkStep('Marcher jusqu’à destination', finalPoint, destination);
        if (egressStep) {
            itinerary.steps.push(egressStep);
        }

        itinerary.departureTime = dataManager.formatTime(firstSegment.departureSeconds);
        itinerary._departureSeconds = firstSegment.departureSeconds;
        itinerary.arrivalTime = dataManager.formatTime(secondSegment.arrivalSeconds);
        itinerary._arrivalSeconds = secondSegment.arrivalSeconds;

        const totalDurationSeconds =
            (approachStep?._durationSeconds || 0) +
            (firstLeg.step?._durationSeconds || 0) +
            waitSeconds +
            (secondLeg.step?._durationSeconds || 0) +
            (egressStep?._durationSeconds || 0);

        itinerary.duration = totalDurationSeconds > 0 ? dataManager.formatDuration(totalDurationSeconds) : 'Horaires théoriques';
        itinerary._hybridDiagnostics = {
            boardingStopId: boardingStop.stop_id,
            transferStopId: transferStop.stop_id,
            alightingStopId: finalStop.stop_id,
            firstTripId: firstSegment.tripId,
            secondTripId: secondSegment.tripId,
            transfers: 1,
            startDistanceMeters: (originMatch && originMatch.distance != null) ? Math.round(originMatch.distance) : null,
            endDistanceMeters: (destMatch && destMatch.distance != null) ? Math.round(destMatch.distance) : null,
            requestedWindow: { start: windowStartSec, end: windowEndSec },
            candidateStartStopIds: Array.from(startStopSet),
            candidateEndStopIds: Array.from(endStopSet)
        };

        itinerary._transferInfo = {
            waitMinutes: Math.round(waitSeconds / 60),
            transferStopName: transferStopName || transferStop.stop_name
        };

        return itinerary;
    };

    /**
     * NOUVELLE APPROCHE INTELLIGENTE pour les correspondances
     * 1. Trouver les routes qui desservent le départ
     * 2. Trouver les routes qui desservent l'arrivée
     * 3. Trouver les arrêts de correspondance (intersection ou proximité)
     * 4. Construire les itinéraires via ces hubs
     */
    const findTransferHubs = (startStopIds, endStopIds) => {
        const startRoutes = new Map(); // route_id -> Set of stop_ids APRÈS le départ
        const endRoutes = new Map();   // route_id -> Set of stop_ids AVANT l'arrivée
        
        const startSet = new Set(startStopIds);
        const endSet = new Set(endStopIds);
        
        for (const trip of dataManager.trips) {
            const stopTimes = dataManager.stopTimesByTrip[trip.trip_id];
            if (!stopTimes || stopTimes.length < 2) continue;
            
            // Trouver l'index du premier arrêt de départ sur ce trip
            let startIdx = -1;
            for (let i = 0; i < stopTimes.length; i++) {
                if (startSet.has(stopTimes[i].stop_id)) {
                    startIdx = i;
                    break;
                }
            }
            
            // Trouver l'index du premier arrêt d'arrivée sur ce trip
            let endIdx = -1;
            for (let i = 0; i < stopTimes.length; i++) {
                if (endSet.has(stopTimes[i].stop_id)) {
                    endIdx = i;
                    break;
                }
            }
            
            // Si ce trip passe par un arrêt de départ, collecter les arrêts APRÈS
            if (startIdx !== -1) {
                if (!startRoutes.has(trip.route_id)) {
                    startRoutes.set(trip.route_id, new Set());
                }
                // Collecter tous les arrêts APRÈS le départ (potentiels hubs de correspondance)
                for (let i = startIdx + 1; i < stopTimes.length; i++) {
                    startRoutes.get(trip.route_id).add(stopTimes[i].stop_id);
                }
            }
            
            // Si ce trip passe par un arrêt d'arrivée, collecter les arrêts AVANT
            if (endIdx !== -1 && endIdx > 0) {
                if (!endRoutes.has(trip.route_id)) {
                    endRoutes.set(trip.route_id, new Set());
                }
                // Collecter tous les arrêts AVANT l'arrivée (potentiels hubs de correspondance)
                for (let i = 0; i < endIdx; i++) {
                    endRoutes.get(trip.route_id).add(stopTimes[i].stop_id);
                }
            }
        }
        
        // Trouver les hubs de correspondance : arrêts communs ou proches
        const transferHubs = new Map(); // stop_id -> { startRoutes: [], endRoutes: [], score }
        
        // 1. Arrêts directement communs
        for (const [startRouteId, startStops] of startRoutes) {
            for (const [endRouteId, endStops] of endRoutes) {
                if (startRouteId === endRouteId) continue; // Même ligne = pas de correspondance
                
                // Trouver les arrêts communs
                for (const stopId of startStops) {
                    if (endStops.has(stopId)) {
                        if (!transferHubs.has(stopId)) {
                            transferHubs.set(stopId, { startRoutes: new Set(), endRoutes: new Set(), isExact: true });
                        }
                        transferHubs.get(stopId).startRoutes.add(startRouteId);
                        transferHubs.get(stopId).endRoutes.add(endRouteId);
                    }
                }
            }
        }
        
        // 2. Si pas de hub direct, chercher des arrêts proches (< 300m)
        if (transferHubs.size === 0) {
            const PROXIMITY_RADIUS = 300; // mètres
            
            for (const [startRouteId, startStops] of startRoutes) {
                for (const [endRouteId, endStops] of endRoutes) {
                    if (startRouteId === endRouteId) continue;
                    
                    for (const startStopId of startStops) {
                        const startStop = dataManager.getStop(startStopId);
                        if (!startStop) continue;
                        const startLat = parseFloat(startStop.stop_lat);
                        const startLon = parseFloat(startStop.stop_lon);
                        if (!Number.isFinite(startLat)) continue;
                        
                        for (const endStopId of endStops) {
                            const endStop = dataManager.getStop(endStopId);
                            if (!endStop) continue;
                            const endLat = parseFloat(endStop.stop_lat);
                            const endLon = parseFloat(endStop.stop_lon);
                            if (!Number.isFinite(endLat)) continue;
                            
                            const dist = dataManager.calculateDistance(startLat, startLon, endLat, endLon);
                            if (dist <= PROXIMITY_RADIUS) {
                                // Utiliser l'arrêt de la ligne de départ comme hub
                                const hubKey = `${startStopId}|${endStopId}`;
                                if (!transferHubs.has(hubKey)) {
                                    transferHubs.set(hubKey, { 
                                        alightStop: startStopId, 
                                        boardStop: endStopId,
                                        startRoutes: new Set(), 
                                        endRoutes: new Set(), 
                                        isExact: false,
                                        walkDistance: Math.round(dist)
                                    });
                                }
                                transferHubs.get(hubKey).startRoutes.add(startRouteId);
                                transferHubs.get(hubKey).endRoutes.add(endRouteId);
                            }
                        }
                    }
                }
            }
        }
        
        return { startRoutes, endRoutes, transferHubs };
    };

    const buildTransferItineraries = async ({
        origin,
        destination,
        originCandidates,
        destCandidates,
        startStopSet,
        endStopSet,
        expandedEndIds,
        reqDate,
        windowStartSec,
        windowEndSec
    }) => {
        if (!HYBRID_ROUTING_CONFIG.ENABLE_TRANSFERS) return [];
        const transferResults = [];
        const serviceSet = dataManager.getServiceIds(reqDate);
        if (!serviceSet || serviceSet.size === 0) return transferResults;

        const isServiceActive = (trip) => Array.from(serviceSet).some(activeServiceId => dataManager.serviceIdsMatch(trip.service_id, activeServiceId));

        const startStopIds = Array.from(startStopSet);
        const endStopIds = Array.from(endStopSet);
        
        // NOUVELLE APPROCHE : Trouver les hubs de correspondance intelligemment
        const { startRoutes, endRoutes, transferHubs } = findTransferHubs(startStopIds, endStopIds);
        
        // Log diagnostic
        if (!globalThis._transferHubsLogged) {
            globalThis._transferHubsLogged = true;
            console.log('🎯 Analyse des correspondances:', {
                routesDepuisDepart: startRoutes.size,
                routesVersArrivee: endRoutes.size,
                hubsTrouves: transferHubs.size
            });
            
            if (transferHubs.size > 0) {
                const hubSamples = Array.from(transferHubs.entries()).slice(0, 3).map(([key, hub]) => {
                    const stopName = hub.isExact 
                        ? dataManager.getStop(key)?.stop_name 
                        : `${dataManager.getStop(hub.alightStop)?.stop_name} → ${dataManager.getStop(hub.boardStop)?.stop_name}`;
                    return {
                        hub: stopName,
                        walk: hub.walkDistance || 0,
                        fromRoutes: hub.startRoutes.size,
                        toRoutes: hub.endRoutes.size
                    };
                });
                console.log('🚏 Hubs de correspondance:', hubSamples);
            } else {
                console.log('❌ Aucun hub de correspondance trouvé entre les lignes');
            }
        }
        
        // Si aucun hub trouvé, pas de correspondance possible
        if (transferHubs.size === 0) {
            return transferResults;
        }
        
        // Construire les itinéraires via les hubs trouvés
        // On collecte TOUS les candidats puis on trie par heure de départ
        const processedTripPairs = new Set();
        const allCandidates = []; // Collecter tous les itinéraires candidats
        let hubsProcessed = 0;
        let firstLegTripsTotal = 0;
        let secondLegSearches = 0;
        let matchesFound = 0;
        
        for (const [hubKey, hub] of transferHubs) {
            // Ne plus break prématurément - on collecte tout d'abord
            hubsProcessed++;
            
            const alightStopId = hub.isExact ? hubKey : hub.alightStop;
            const boardStopId = hub.isExact ? hubKey : hub.boardStop;
            
            // Trouver les trips qui vont du départ au hub
            const firstLegTrips = [];
            for (const routeId of hub.startRoutes) {
                const routeTrips = dataManager.tripsByRoute[routeId] || [];
                for (const trip of routeTrips) {
                    if (!isServiceActive(trip)) continue;
                    const stopTimes = dataManager.stopTimesByTrip[trip.trip_id];
                    if (!stopTimes) continue;
                    
                    // Trouver l'index de montée (départ) et de descente (hub)
                    let boardingIdx = -1, alightIdx = -1;
                    for (let i = 0; i < stopTimes.length; i++) {
                        if (boardingIdx === -1 && startStopSet.has(stopTimes[i].stop_id)) {
                            boardingIdx = i;
                        }
                        if (stopTimes[i].stop_id === alightStopId) {
                            alightIdx = i;
                        }
                    }
                    
                    if (boardingIdx !== -1 && alightIdx !== -1 && boardingIdx < alightIdx) {
                        const depSec = dataManager.timeToSeconds(stopTimes[boardingIdx].departure_time);
                        const arrSec = dataManager.timeToSeconds(stopTimes[alightIdx].arrival_time);
                        if (depSec >= windowStartSec && depSec <= windowEndSec) {
                            firstLegTrips.push({
                                trip,
                                stopTimes,
                                boardingIdx,
                                alightIdx,
                                depSec,
                                arrSec
                            });
                        }
                    }
                }
            }
            
            firstLegTripsTotal += firstLegTrips.length;
            
            // Trier par heure de départ pour avoir les plus proches de l'heure demandée en premier
            firstLegTrips.sort((a, b) => a.depSec - b.depSec);
            
            // Log pour le premier hub
            if (hubsProcessed === 1 && !globalThis._hubDebugLogged) {
                globalThis._hubDebugLogged = true;
                const hubName = hub.isExact 
                    ? dataManager.getStop(hubKey)?.stop_name 
                    : `${dataManager.getStop(hub.alightStop)?.stop_name} → ${dataManager.getStop(hub.boardStop)?.stop_name}`;
                console.log(`🔎 Hub #1 "${hubName}":`, {
                    alightStopId,
                    boardStopId,
                    startRoutes: Array.from(hub.startRoutes).map(r => r.split(':').pop()),
                    endRoutes: Array.from(hub.endRoutes).map(r => r.split(':').pop()),
                    firstLegTrips: firstLegTrips.length,
                    startStopSetSize: startStopSet.size,
                    endStopSetSize: endStopSet.size
                });
            }
            
            // Trouver les trips qui vont du hub à l'arrivée
            // On prend les 10 premiers (triés par heure de départ) pour avoir plus d'options
            for (const firstLeg of firstLegTrips.slice(0, 10)) {
                // Plus de break prématuré - on collecte tous les candidats
                
                const minSecondLegDep = firstLeg.arrSec + HYBRID_ROUTING_CONFIG.TRANSFER_MIN_BUFFER_SECONDS;
                const maxSecondLegDep = firstLeg.arrSec + HYBRID_ROUTING_CONFIG.TRANSFER_MAX_WAIT_SECONDS;
                
                for (const routeId of hub.endRoutes) {
                    const routeTrips = dataManager.tripsByRoute[routeId] || [];
                    for (const trip of routeTrips) {
                        if (trip.trip_id === firstLeg.trip.trip_id) continue; // Pas le même trip
                        if (!isServiceActive(trip)) continue;
                        
                        const pairKey = `${firstLeg.trip.trip_id}->${trip.trip_id}`;
                        if (processedTripPairs.has(pairKey)) continue;
                        
                        const stopTimes = dataManager.stopTimesByTrip[trip.trip_id];
                        if (!stopTimes) continue;
                        
                        // Trouver l'index de montée (hub) et de descente (arrivée)
                        let boardingIdx = -1, alightIdx = -1;
                        for (let i = 0; i < stopTimes.length; i++) {
                            if (boardingIdx === -1 && stopTimes[i].stop_id === boardStopId) {
                                boardingIdx = i;
                            }
                            if (endStopSet.has(stopTimes[i].stop_id)) {
                                alightIdx = i;
                            }
                        }
                        
                        if (boardingIdx !== -1 && alightIdx !== -1 && boardingIdx < alightIdx) {
                            const depSec = dataManager.timeToSeconds(stopTimes[boardingIdx].departure_time);
                            const arrSec = dataManager.timeToSeconds(stopTimes[alightIdx].arrival_time);
                            
                            if (depSec >= minSecondLegDep && depSec <= maxSecondLegDep) {
                                processedTripPairs.add(pairKey);
                                
                                // Assembler l'itinéraire
                                const firstBoardingStop = dataManager.getStop(firstLeg.stopTimes[firstLeg.boardingIdx].stop_id);
                                const transferAlightStop = dataManager.getStop(alightStopId);
                                const transferBoardStop = dataManager.getStop(boardStopId);
                                const finalStop = dataManager.getStop(stopTimes[alightIdx].stop_id);
                                
                                const firstSegment = {
                                    tripId: firstLeg.trip.trip_id,
                                    routeId: firstLeg.trip.route_id,
                                    route: dataManager.getRoute(firstLeg.trip.route_id),
                                    shapeId: firstLeg.trip.shape_id || null,
                                    boardingStopId: firstLeg.stopTimes[firstLeg.boardingIdx].stop_id,
                                    alightingStopId: alightStopId,
                                    departureSeconds: firstLeg.depSec,
                                    arrivalSeconds: firstLeg.arrSec,
                                    stopTimes: firstLeg.stopTimes.slice(firstLeg.boardingIdx, firstLeg.alightIdx + 1)
                                };
                                
                                const secondSegment = {
                                    tripId: trip.trip_id,
                                    routeId: trip.route_id,
                                    route: dataManager.getRoute(trip.route_id),
                                    shapeId: trip.shape_id || null,
                                    boardingStopId: boardStopId,
                                    alightingStopId: stopTimes[alightIdx].stop_id,
                                    departureSeconds: depSec,
                                    arrivalSeconds: arrSec,
                                    stopTimes: stopTimes.slice(boardingIdx, alightIdx + 1)
                                };
                                
                                const itinerary = await assembleTransferItinerary({
                                    firstSegment,
                                    secondSegment,
                                    boardingStop: firstBoardingStop,
                                    transferStop: transferAlightStop,
                                    finalStop,
                                    origin,
                                    destination,
                                    originCandidates,
                                    destCandidates,
                                    windowStartSec,
                                    windowEndSec,
                                    startStopSet,
                                    endStopSet
                                });
                                
                                // Debug: pourquoi l'itinéraire est null ?
                                if (!itinerary && !globalThis._assembleDebugLogged) {
                                    globalThis._assembleDebugLogged = true;
                                    console.log('⚠️ assembleTransferItinerary returned null:', {
                                        firstBoardingStop: firstBoardingStop?.stop_name,
                                        transferAlightStop: transferAlightStop?.stop_name,
                                        finalStop: finalStop?.stop_name,
                                        firstSegment: !!firstSegment,
                                        secondSegment: !!secondSegment
                                    });
                                }
                                
                                if (itinerary) {
                                    // Ajouter info sur la marche entre arrêts si différents
                                    if (!hub.isExact && hub.walkDistance) {
                                        itinerary._transferInfo.walkBetweenStops = hub.walkDistance;
                                        itinerary._transferInfo.transferBoardStopName = transferBoardStop?.stop_name;
                                    }
                                    allCandidates.push(itinerary);
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Trier tous les candidats selon le mode de recherche
        const isArriveMode = searchTime?.type === 'arriver';
        if (isArriveMode) {
            // Mode ARRIVER: trier par heure d'arrivée DÉCROISSANTE (arrivée la plus proche de l'heure demandée en premier)
            // Les arrivées les plus tardives (mais <= heure demandée) sont les meilleures
            allCandidates.sort((a, b) => {
                const arrA = a._arrivalSeconds || dataManager.timeToSeconds(a.arrivalTime) || 0;
                const arrB = b._arrivalSeconds || dataManager.timeToSeconds(b.arrivalTime) || 0;
                return arrB - arrA; // Décroissant
            });
        } else {
            // Mode PARTIR: trier par heure de départ CROISSANTE (premier départ en premier)
            allCandidates.sort((a, b) => (a._departureSeconds || 0) - (b._departureSeconds || 0));
        }
        transferResults.push(...allCandidates.slice(0, HYBRID_ROUTING_CONFIG.TRANSFER_MAX_ITINERARIES));
        
        // Log de synthèse
        if (!globalThis._transferResultsLogged) {
            globalThis._transferResultsLogged = true;
            console.log('🔄 Résultat correspondances:', {
                hubsAnalyses: hubsProcessed,
                firstLegTripsTotal,
                candidatsTotal: allCandidates.length,
                itinerairesGardés: transferResults.length
            });
            if (firstLegTripsTotal === 0) {
                console.log('⚠️ Aucun trip first leg trouvé - vérifier startStopSet vs alightStopId');
            }
            if (transferResults.length > 0) {
                console.log('✅ Itinéraires de correspondance:', transferResults.map(it => ({
                    departure: it.departureTime,
                    arrival: it.arrivalTime,
                    stepsCount: it.steps?.length,
                    _depSec: it._departureSeconds
                })));
            }
        }

        return transferResults;
    };

    const buildWalkStep = async (instruction, startPoint, endPoint) => {
        if (!startPoint || !endPoint) return null;
        try {
            const routeData = await getWalkingRoute(startPoint, endPoint);
            if (!routeData || !routeData.distanceMeters || routeData.distanceMeters < 1) {
                return null;
            }

            const durationSeconds = routeData.durationSeconds ?? computeWalkDurationSeconds(routeData.distanceMeters);
            return {
                type: 'WALK',
                icon: ICONS.WALK,
                instruction,
                polylines: routeData.encodedPolyline ? [{ encodedPolyline: routeData.encodedPolyline }] : [],
                subSteps: [],
                totalDistanceMeters: Math.round(routeData.distanceMeters),
                departureTime: '~',
                arrivalTime: '~',
                duration: durationSeconds ? `${Math.max(1, Math.round(durationSeconds / 60))} min` : '—',
                _durationSeconds: durationSeconds,
                _source: routeData.source || 'direct'
            };
        } catch (err) {
            console.warn('Erreur buildWalkStep (hybrid):', err);
            return null;
        }
    };

    const reqSeconds = (reqDate.getHours() * 3600) + (reqDate.getMinutes() * 60);
    const SEARCH_WINDOW = 4 * 3600; // FIX BUG 8: 2h -> 4h
    let windowStartSec = reqSeconds;
    let windowEndSec = reqSeconds + SEARCH_WINDOW; // FIX BUG 4: Remove 24h cap
    if (searchTime?.type === 'arriver') {
        windowEndSec = reqSeconds;
        windowStartSec = Math.max(0, reqSeconds - SEARCH_WINDOW);
    }
    if (windowEndSec <= windowStartSec) {
        windowEndSec = windowStartSec + SEARCH_WINDOW;
    }
    
    // Debug: afficher la fenêtre de recherche
    const formatSec = (s) => `${Math.floor(s/3600).toString().padStart(2,'0')}:${Math.floor((s%3600)/60).toString().padStart(2,'0')}`;
    console.log(`⏰ Fenêtre de recherche (${searchTime?.type || 'partir'}):`, {
        demandé: formatSec(reqSeconds),
        fenêtre: `${formatSec(windowStartSec)} - ${formatSec(windowEndSec)}`,
        durée: `${SEARCH_WINDOW/3600}h`
    });

    const resolveClusterIds = (stop) => {
        const ids = new Set();
        if (!stop) return ids;
        const parent = stop.parent_station && stop.parent_station.trim() ? stop.parent_station.trim() : null;
        if (parent && dataManager.groupedStopMap[parent]) {
            dataManager.groupedStopMap[parent].forEach(id => ids.add(id));
        }
        if (dataManager.groupedStopMap[stop.stop_id]) {
            dataManager.groupedStopMap[stop.stop_id].forEach(id => ids.add(id));
        }
        ids.add(stop.stop_id);
        return ids;
    };

    // Diagnostic one-time: check if groupedStopMap has Quays
    const sampleKey = Object.keys(dataManager.groupedStopMap || {})[0];
    if (sampleKey && !globalThis._routerGroupMapLogged) {
        globalThis._routerGroupMapLogged = true;
        console.log('🗺️ groupedStopMap sample:', sampleKey, '->', dataManager.groupedStopMap[sampleKey]);
    }

    const startStopSet = new Set();
    originCandidates.forEach(candidate => {
        resolveClusterIds(candidate.stop).forEach(id => startStopSet.add(id));
    });

    const endStopSet = new Set();
    destCandidates.forEach(candidate => {
        resolveClusterIds(candidate.stop).forEach(id => endStopSet.add(id));
    });

    const expandedStartIds = Array.from(startStopSet);
    const expandedEndIds = Array.from(endStopSet);

    // Log détaillé une seule fois pour diagnostiquer
    console.log(`🔍 Router: Recherche directe`, {
        startIds: expandedStartIds.slice(0, 5),
        endIds: expandedEndIds.slice(0, 5),
        fenetre: `${Math.floor(windowStartSec/3600)}h${Math.floor((windowStartSec%3600)/60)} - ${Math.floor(windowEndSec/3600)}h${Math.floor((windowEndSec%3600)/60)}`
    });

    const trips = getCachedTripsBetweenStops(
        expandedStartIds,
        expandedEndIds,
        reqDate,
        windowStartSec,
        windowEndSec
    );
    
    if (trips?.length > 0) {
        console.log(`✅ Router: ${trips.length} trip(s) direct(s) trouvé(s)`);
    }
    
    const itineraries = [];

    let selectedTrips = trips || [];
    if (searchTime?.type === 'arriver') {
        selectedTrips = selectedTrips.filter(t => t.arrivalSeconds <= reqSeconds);
        selectedTrips.sort((a, b) => b.arrivalSeconds - a.arrivalSeconds);
    } else {
        selectedTrips.sort((a, b) => a.departureSeconds - b.departureSeconds);
    }

    if (selectedTrips.length) {
        const selected = selectedTrips.slice(0, HYBRID_ROUTING_CONFIG.MAX_ITINERARIES);
        for (const tripCandidate of selected) {
            try {
                const boardingStop = dataManager.getStop(tripCandidate.boardingStopId) || originCandidates[0]?.stop;
                const alightingStop = dataManager.getStop(tripCandidate.alightingStopId) || destCandidates[0]?.stop;
                const boardingPoint = toPoint(boardingStop);
                const alightingPoint = toPoint(alightingStop);
                if (!boardingPoint || !alightingPoint) continue;
                const boardingStopName = getStopDisplayName(boardingStop);
                const alightingStopName = getStopDisplayName(alightingStop);

                const itinerary = {
                    type: 'BUS',
                    tripId: tripCandidate.tripId,
                    route: tripCandidate.route,
                    steps: [],
                    summarySegments: []
                };

                const approachLabel = boardingStopName ? `Marcher jusqu’à ${boardingStopName}` : 'Marcher jusqu’à l’arrêt';
                const approachStep = await buildWalkStep(approachLabel, origin, boardingPoint);
                if (approachStep) {
                    itinerary.steps.push(approachStep);
                }

                const busLeg = buildBusLegStep(tripCandidate, boardingStop, alightingStop);
                if (!busLeg) continue;
                itinerary.steps.push(busLeg.step);

                const egressInstruction = alightingStopName
                    ? `Marcher depuis ${alightingStopName}`
                    : 'Marcher jusqu’à destination';
                const egressStep = await buildWalkStep(egressInstruction, alightingPoint, destination);
                if (egressStep) {
                    itinerary.steps.push(egressStep);
                }

                itinerary.summarySegments.push(busLeg.summary);

                itinerary.departureTime = dataManager.formatTime(tripCandidate.departureSeconds);
                itinerary._departureSeconds = tripCandidate.departureSeconds;
                itinerary.arrivalTime = dataManager.formatTime(tripCandidate.arrivalSeconds);
                itinerary._arrivalSeconds = tripCandidate.arrivalSeconds;

                const totalDurationSeconds =
                    (approachStep?._durationSeconds || 0) +
                    (busLeg.step?._durationSeconds || 0) +
                    (egressStep?._durationSeconds || 0);
                itinerary.duration = totalDurationSeconds > 0 ? dataManager.formatDuration(totalDurationSeconds) : 'Horaires théoriques';
                const matchingOrigin = originCandidates.find(c => c.stop.stop_id === boardingStop?.stop_id);
                const matchingDest = destCandidates.find(c => c.stop.stop_id === alightingStop?.stop_id);
                itinerary._hybridDiagnostics = {
                    boardingStopId: boardingStop?.stop_id,
                    alightingStopId: alightingStop?.stop_id,
                    startDistanceMeters: (matchingOrigin && matchingOrigin.distance != null) ? Math.round(matchingOrigin.distance) : null,
                    endDistanceMeters: (matchingDest && matchingDest.distance != null) ? Math.round(matchingDest.distance) : null,
                    requestedWindow: { start: windowStartSec, end: windowEndSec },
                    candidateStartStopIds: expandedStartIds,
                    candidateEndStopIds: expandedEndIds
                };

                itineraries.push(itinerary);
            } catch (e) {
                console.warn('Erreur lors de la construction d\'un itinéraire hybride:', e);
            }
        }
    }

    if ((!trips || !trips.length) && HYBRID_ROUTING_CONFIG.ENABLE_TRANSFERS) {
        console.warn('⚠️ Hybrid: aucun trip direct trouvé, tentative avec correspondances.');
        const transferItins = await buildTransferItineraries({
            origin,
            destination,
            originCandidates,
            destCandidates,
            startStopSet,
            endStopSet,
            expandedEndIds,
            reqDate,
            windowStartSec,
            windowEndSec
        });
        itineraries.push(...transferItins);
    }

    // Tri final selon le mode de recherche
    const isArriveMode = searchTime?.type === 'arriver';
    itineraries.sort((a, b) => {
        if (isArriveMode) {
            // Mode ARRIVER: trier par arrivée DÉCROISSANTE (arrivée la plus proche de l'heure demandée en premier)
            const arrA = a._arrivalSeconds !== undefined ? a._arrivalSeconds : (dataManager.timeToSeconds ? dataManager.timeToSeconds(a.arrivalTime) : 0);
            const arrB = b._arrivalSeconds !== undefined ? b._arrivalSeconds : (dataManager.timeToSeconds ? dataManager.timeToSeconds(b.arrivalTime) : 0);
            return arrB - arrA; // Décroissant
        } else {
            // Mode PARTIR: trier par départ CROISSANT (premier départ en premier)
            const depA = a._departureSeconds !== undefined ? a._departureSeconds : (dataManager.timeToSeconds ? dataManager.timeToSeconds(a.departureTime) : 0);
            const depB = b._departureSeconds !== undefined ? b._departureSeconds : (dataManager.timeToSeconds ? dataManager.timeToSeconds(b.departureTime) : 0);
            return depA - depB;
        }
    });
    
    console.log(`📊 Itinéraires triés (${isArriveMode ? 'ARRIVER' : 'PARTIR'}):`, itineraries.slice(0, 3).map(it => ({
        dep: it.departureTime,
        arr: it.arrivalTime,
        type: it.type
    })));

    if (!itineraries.length) {
        console.warn('⚠️ Hybrid: aucun itinéraire GTFS (direct ou correspondance) trouvé.');
        console.log('🔍 DEBUG - expandedStartIds:', expandedStartIds);
        console.log('🔍 DEBUG - expandedEndIds:', expandedEndIds);
        console.log('🔍 DEBUG - groupedStopMap keys sample:', Object.keys(dataManager.groupedStopMap || {}).slice(0, 10));
        console.table({
            startCandidates: originCandidates.map(c => ({ id: c.stop.stop_id, name: getStopDisplayName(c.stop) || c.stop.stop_name, dist: c.distance != null ? Math.round(c.distance) : null })),
            endCandidates: destCandidates.map(c => ({ id: c.stop.stop_id, name: getStopDisplayName(c.stop) || c.stop.stop_name, dist: c.distance != null ? Math.round(c.distance) : null })),
            windowStartSec,
            windowEndSec
        });
    }

    return itineraries;
}

