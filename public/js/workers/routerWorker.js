import { DataManager } from '../dataManager.js';
import { createRouterContext } from '../router.js';

let routerContext = null;
let workerDataManager = null;
let isReady = false;
let googleApiKey = null;

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
            const { fromCoords, toCoords, searchTime, labels } = payload || {};
            const itineraries = await routerContext.computeHybridItinerary(fromCoords, toCoords, searchTime, labels);
            self.postMessage({ type: 'result', requestId, payload: itineraries });
        } catch (error) {
            console.error('routerWorker compute error', error);
            self.postMessage({ type: 'result', requestId, error: error?.message || 'compute failed' });
        }
    }
});

async function handleInit(payload = {}) {
    const snapshot = payload.snapshot || {};
    googleApiKey = payload.googleApiKey || null;
    workerDataManager = new DataManager();
    workerDataManager.applyIndexes(snapshot.indexes || {});
    workerDataManager.routes = snapshot.dataset?.routes || [];
    workerDataManager.trips = snapshot.dataset?.trips || [];
    workerDataManager.stopTimes = snapshot.dataset?.stopTimes || [];
    workerDataManager.stops = snapshot.dataset?.stops || [];
    workerDataManager.calendar = snapshot.dataset?.calendar || [];
    workerDataManager.calendarDates = snapshot.dataset?.calendarDates || [];
    workerDataManager.geoJson = snapshot.dataset?.geoJson || null;
    workerDataManager.isLoaded = true;

    const apiBridge = createWorkerApiBridge(googleApiKey);
    routerContext = createRouterContext({
        dataManager: workerDataManager,
        apiManager: apiBridge,
        icons: payload.icons || {}
    });
}

function createWorkerApiBridge(apiKey) {
    if (!apiKey) {
        return null;
    }
    const ROUTES_API = 'https://routes.googleapis.com/directions/v2:computeRoutes';
    const GEOCODE_API = 'https://maps.googleapis.com/maps/api/geocode/json';

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
            const url = `${GEOCODE_API}?latlng=${lat},${lon}&key=${apiKey}`;
            const response = await fetch(url, { method: 'GET' });
            if (!response.ok) {
                throw new Error(`Geocode error: ${response.status}`);
            }
            const data = await response.json();
            const firstResult = data.results?.[0];
            return firstResult?.place_id || null;
        }
    };
}
