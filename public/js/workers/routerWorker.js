import { DataManager } from '../dataManager.js';
import { createRouterContext } from '../router.js';

let routerContext = null;
let workerDataManager = null;
let isReady = false;
let googleApiKey = null;
let geocodeProxyUrl = '/api/geocode';

/**
 * ✅ PRODUCTION: Algorithme CSA (Connection Scan Algorithm) simplifié
 * Recherche les horaires RÉELS dans stop_times.txt au lieu d'estimer
 * 
 * @param {string} departStopId - ID de l'arrêt de départ
 * @param {string} arriveStopId - ID de l'arrêt d'arrivée
 * @param {number} departureSec - Heure de départ en secondes depuis minuit
 * @param {Date} date - Date de recherche
 * @returns {Array} Connexions trouvées triées par heure de départ
 */
function connectionScanAlgorithm(departStopId, arriveStopId, departureSec, date) {
    if (!workerDataManager || !workerDataManager.isLoaded) {
        console.warn('[CSA] DataManager non chargé');
        return [];
    }
    
    const serviceIds = workerDataManager.getServiceIds(date);
    if (!serviceIds || serviceIds.size === 0) {
        console.warn('[CSA] Aucun service actif pour cette date');
        return [];
    }
    
    const connections = [];
    const departStopIds = new Set([departStopId]);
    const arriveStopIds = new Set([arriveStopId]);
    
    // Étendre avec les arrêts du cluster (StopPlace -> Quays)
    const expandCluster = (idSet) => {
        const extra = [];
        idSet.forEach(id => {
            const grouped = workerDataManager.groupedStopMap?.[id];
            if (Array.isArray(grouped)) {
                grouped.forEach(gid => extra.push(gid));
            }
        });
        extra.forEach(x => idSet.add(x));
    };
    expandCluster(departStopIds);
    expandCluster(arriveStopIds);
    
    // Scanner tous les trips actifs
    for (const trip of workerDataManager.trips) {
        // Vérifier si le service est actif
        const isServiceActive = Array.from(serviceIds).some(activeServiceId => 
            workerDataManager.serviceIdsMatch(trip.service_id, activeServiceId)
        );
        if (!isServiceActive) continue;
        
        const stopTimes = workerDataManager.stopTimesByTrip?.[trip.trip_id];
        if (!stopTimes || stopTimes.length < 2) continue;
        
        // Chercher l'arrêt de départ
        let boardingIdx = -1;
        for (let i = 0; i < stopTimes.length; i++) {
            if (departStopIds.has(stopTimes[i].stop_id)) {
                const depSec = workerDataManager.timeToSeconds(stopTimes[i].departure_time);
                // Ne considérer que les départs APRÈS l'heure demandée
                if (depSec >= departureSec) {
                    boardingIdx = i;
                    break;
                }
            }
        }
        if (boardingIdx === -1) continue;
        
        // Chercher l'arrêt d'arrivée APRÈS le départ
        let alightIdx = -1;
        for (let i = boardingIdx + 1; i < stopTimes.length; i++) {
            if (arriveStopIds.has(stopTimes[i].stop_id)) {
                alightIdx = i;
                break;
            }
        }
        if (alightIdx === -1) continue;
        
        // ✅ HORAIRES RÉELS depuis stop_times.txt
        const boardingST = stopTimes[boardingIdx];
        const alightST = stopTimes[alightIdx];
        const realDepartureSec = workerDataManager.timeToSeconds(boardingST.departure_time);
        const realArrivalSec = workerDataManager.timeToSeconds(alightST.arrival_time);
        
        connections.push({
            tripId: trip.trip_id,
            routeId: trip.route_id,
            shapeId: trip.shape_id,
            boardingStopId: boardingST.stop_id,
            alightingStopId: alightST.stop_id,
            // ✅ HORAIRES RÉELS (pas calculés!)
            departureSeconds: realDepartureSec,
            arrivalSeconds: realArrivalSec,
            departureTime: boardingST.departure_time,
            arrivalTime: alightST.arrival_time,
            stopTimes: stopTimes.slice(boardingIdx, alightIdx + 1),
            route: workerDataManager.getRoute(trip.route_id)
        });
    }
    
    // Trier par heure de départ
    connections.sort((a, b) => a.departureSeconds - b.departureSeconds);
    
    console.log(`[CSA] ${connections.length} connexions trouvées de ${departStopId} vers ${arriveStopId}`);
    return connections;
}

self.addEventListener('message', async (event) => {
    const { type, payload, requestId } = event.data || {};
    if (type === 'init') {
        try {
            await handleInit(payload);
            isReady = true;
            self.postMessage({ type: 'ready' });
        } catch (error) {
            console.error('routerWorker init failed', error);
            self.postMessage({ type: 'init-error', error: error?.message || 'init failed' });
        }
        return;
    }

    if (type === 'computeItinerary') {
        if (!isReady || !routerContext) {
            self.postMessage({ type: 'result', requestId, error: 'Router worker not ready' });
            return;
        }
        try {
            // V49: Accepter les arrêts forcés des pôles multimodaux
            const { fromCoords, toCoords, searchTime, labels, forcedStops } = payload || {};
            const itineraries = await routerContext.computeHybridItinerary(fromCoords, toCoords, searchTime, labels, forcedStops || {});
            self.postMessage({ type: 'result', requestId, payload: itineraries });
        } catch (error) {
            console.error('routerWorker compute error', error);
            self.postMessage({ type: 'result', requestId, error: error?.message || 'compute failed' });
        }
    }
    
    // ✅ PRODUCTION: Nouveau type de message pour CSA direct
    if (type === 'findRealSchedule') {
        if (!isReady || !workerDataManager) {
            self.postMessage({ type: 'scheduleResult', requestId, error: 'Worker not ready' });
            return;
        }
        try {
            const { departStopId, arriveStopId, departureSec, date } = payload || {};
            const dateObj = date ? new Date(date) : new Date();
            const connections = connectionScanAlgorithm(departStopId, arriveStopId, departureSec, dateObj);
            self.postMessage({ type: 'scheduleResult', requestId, payload: connections });
        } catch (error) {
            console.error('routerWorker findRealSchedule error', error);
            self.postMessage({ type: 'scheduleResult', requestId, error: error?.message || 'CSA failed' });
        }
    }
});

async function handleInit(payload = {}) {
    const snapshot = payload.snapshot || {};
    googleApiKey = payload.googleApiKey || null;
    geocodeProxyUrl = payload.geocodeProxyUrl || geocodeProxyUrl;
    workerDataManager = new DataManager();
    workerDataManager.applyIndexes(snapshot.indexes || {});
    workerDataManager.routes = snapshot.dataset?.routes || [];
    workerDataManager.trips = snapshot.dataset?.trips || [];
    workerDataManager.stopTimes = snapshot.dataset?.stopTimes || [];
    workerDataManager.stops = snapshot.dataset?.stops || [];
    workerDataManager.calendar = snapshot.dataset?.calendar || [];
    workerDataManager.calendarDates = snapshot.dataset?.calendarDates || [];
    workerDataManager.geoJson = snapshot.dataset?.geoJson || null;
    workerDataManager.shapes = snapshot.dataset?.shapes || [];
    workerDataManager.buildRouteGeometryIndex();
    workerDataManager.isLoaded = true;
    
    // V192: Debug calendar pour vérifier les jours de service
    console.log('📅 [Worker] Calendar chargé:', workerDataManager.calendar?.length || 0, 'entrées');
    if (workerDataManager.calendar?.length > 0) {
        const sample = workerDataManager.calendar[0];
        console.log('📅 [Worker] Exemple calendar:', {
            service_id: sample.service_id,
            saturday: sample.saturday,
            sunday: sample.sunday,
            start_date: sample.start_date,
            end_date: sample.end_date
        });
    }
    
    // DEBUG: Vérifier stopTimesByStop
    const stopTimesByStopKeys = Object.keys(workerDataManager.stopTimesByStop || {});
    console.log('🔧 [Worker] stopTimesByStop reçu:', stopTimesByStopKeys.length, 'stops');
    if (stopTimesByStopKeys.length > 0) {
        console.log('🔧 [Worker] Sample stopTimesByStop IDs:', stopTimesByStopKeys.slice(0, 5));
    }

    const apiBridge = createWorkerApiBridge(googleApiKey, { geocodeProxyUrl });
    routerContext = createRouterContext({
        dataManager: workerDataManager,
        apiManager: apiBridge,
        icons: payload.icons || {}
    });
}

function createWorkerApiBridge(apiKey, options = {}) {
    if (!apiKey) {
        return null;
    }
    const ROUTES_API = 'https://routes.googleapis.com/directions/v2:computeRoutes';
    const geocodeEndpoint = options.geocodeProxyUrl || '/api/geocode';

    const headers = {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline'
    };

    return {
        async fetchWalkingRoute(fromPlaceId, toPlaceId) {
            const body = {
                origin: { placeId: fromPlaceId },
                destination: { placeId: toPlaceId },
                travelMode: 'WALK',
                languageCode: 'fr',
                units: 'METRIC'
            };
            const response = await fetch(ROUTES_API, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            });
            if (!response.ok) {
                throw new Error(`Routes API error: ${response.status}`);
            }
            return response.json();
        },
        async reverseGeocode(lat, lon) {
            const url = `${geocodeEndpoint}?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lon)}`;
            const response = await fetch(url, { method: 'GET' });
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Geocode proxy error: ${response.status} ${text}`);
            }
            const data = await response.json();
            const firstResult = data.results?.[0];
            return firstResult?.place_id || null;
        }
    };
}
