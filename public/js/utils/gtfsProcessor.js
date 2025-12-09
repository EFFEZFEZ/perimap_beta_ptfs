const DEFAULT_DATASET = {
    routes: [],
    trips: [],
    stopTimes: [],
    stops: [],
    calendar: [],
    calendarDates: [],
    shapes: [],
    geoJson: null
};

export function cleanCsvValue(value) {
    if (typeof value !== 'string') {
        return value;
    }
    return value.replace(/^["']|["']$/g, '').trim();
}

export function cleanRecord(record = {}) {
    const cleaned = {};
    Object.keys(record).forEach((key) => {
        cleaned[key] = cleanCsvValue(record[key]);
    });
    return cleaned;
}

export function cleanDataset(dataset = {}) {
    const source = { ...DEFAULT_DATASET, ...dataset };
    return {
        routes: (source.routes || []).map(cleanRecord),
        trips: (source.trips || []).map(cleanRecord),
        stopTimes: (source.stopTimes || []).map(cleanRecord),
        stops: (source.stops || []).map(cleanRecord),
        calendar: (source.calendar || []).map(cleanRecord),
        calendarDates: (source.calendarDates || []).map(cleanRecord),
        shapes: (source.shapes || []).map(cleanRecord),
        geoJson: source.geoJson || null
    };
}

export function buildGtfsIndexes(dataset = {}) {
    const routesById = {};
    const routesByShortName = {};
    const stopsById = {};
    const stopsByName = {};
    const tripsByRoute = {};
    const tripsByTripId = {};
    const stopTimesByTrip = {};
    const stopTimesByStop = {};
    const shapesById = {};

    const routes = dataset.routes || [];
    const trips = dataset.trips || [];
    const stopTimes = dataset.stopTimes || [];
    const stops = dataset.stops || [];
    const shapes = dataset.shapes || [];

    routes.forEach((route) => {
        // ✅ CORRECTION 1: Extraction stricte des couleurs officielles GTFS
        // Ajouter le préfixe # si manquant pour les couleurs hex
        if (route.route_color && !route.route_color.startsWith('#')) {
            route.route_color = '#' + route.route_color;
        }
        if (route.route_text_color && !route.route_text_color.startsWith('#')) {
            route.route_text_color = '#' + route.route_text_color;
        }
        // Valeurs par défaut si vides
        if (!route.route_color || route.route_color === '#') {
            route.route_color = '#3388ff'; // Bleu par défaut
        }
        if (!route.route_text_color || route.route_text_color === '#') {
            route.route_text_color = '#ffffff'; // Blanc par défaut
        }
        
        routesById[route.route_id] = route;
        if (route.route_short_name) {
            routesByShortName[route.route_short_name] = route;
        }
    });

    stops.forEach((stop) => {
        stopsById[stop.stop_id] = stop;
        const normalizedName = normalizeStopName(stop.stop_name);
        if (!stopsByName[normalizedName]) {
            stopsByName[normalizedName] = [];
        }
        stopsByName[normalizedName].push(stop);
    });

    stopTimes.forEach((stopTime) => {
        if (!stopTimesByTrip[stopTime.trip_id]) {
            stopTimesByTrip[stopTime.trip_id] = [];
        }
        stopTimesByTrip[stopTime.trip_id].push(stopTime);
    });

    Object.keys(stopTimesByTrip).forEach((tripId) => {
        stopTimesByTrip[tripId].sort((a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10));
    });

    trips.forEach((trip) => {
        tripsByTripId[trip.trip_id] = trip;
        if (!tripsByRoute[trip.route_id]) {
            tripsByRoute[trip.route_id] = [];
        }
        tripsByRoute[trip.route_id].push(trip);
    });

    const { masterStops, groupedStopMap } = groupNearbyStops(stops);
    const processedStopTimesByStop = preprocessStopTimesByStop(stopTimes);

    shapes.forEach((shapePoint) => {
        if (!shapePoint || !shapePoint.shape_id) return;
        const shapeId = shapePoint.shape_id;
        if (!shapesById[shapeId]) {
            shapesById[shapeId] = [];
        }
        const seq = parseInt(shapePoint.shape_pt_sequence, 10) || 0;
        const lat = parseFloat(shapePoint.shape_pt_lat);
        const lon = parseFloat(shapePoint.shape_pt_lon);
        if (Number.isNaN(lat) || Number.isNaN(lon)) return;
        shapesById[shapeId].push({ seq, coord: [lon, lat] });
    });

    Object.keys(shapesById).forEach((shapeId) => {
        shapesById[shapeId]
            .sort((a, b) => a.seq - b.seq);
        shapesById[shapeId] = shapesById[shapeId].map(entry => entry.coord);
    });

    return {
        routesById,
        routesByShortName,
        stopsById,
        stopsByName,
        tripsByRoute,
        tripsByTripId,
        stopTimesByTrip,
        stopTimesByStop: processedStopTimesByStop,
        groupedStopMap,
        masterStops,
        shapesById
    };
}

function normalizeStopName(value) {
    if (!value) {
        return '';
    }
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

function groupNearbyStops(stops = []) {
    const masterStops = [];
    const groupedStopMap = {};
    const childStops = new Set();

    stops.forEach((stop) => {
        if (stop.parent_station && stop.parent_station.trim() !== '') {
            childStops.add(stop.stop_id);
        }
    });

    stops.forEach((stop) => {
        if (stop.location_type === '1') {
            masterStops.push(stop);
            if (!groupedStopMap[stop.stop_id]) {
                groupedStopMap[stop.stop_id] = [];
            }
            groupedStopMap[stop.stop_id].push(stop.stop_id);
        } else if (stop.parent_station && stop.parent_station.trim() !== '') {
            const parentId = stop.parent_station;
            if (!groupedStopMap[parentId]) {
                groupedStopMap[parentId] = [];
            }
            groupedStopMap[parentId].push(stop.stop_id);
        } else if (stop.location_type !== '1' && !childStops.has(stop.stop_id) && (!stop.parent_station || stop.parent_station.trim() === '')) {
            masterStops.push(stop);
            groupedStopMap[stop.stop_id] = [stop.stop_id];
        }
    });

    return { masterStops, groupedStopMap };
}

function preprocessStopTimesByStop(stopTimes = []) {
    const bucket = {};
    stopTimes.forEach((stopTime) => {
        if (!bucket[stopTime.stop_id]) {
            bucket[stopTime.stop_id] = [];
        }
        bucket[stopTime.stop_id].push(stopTime);
    });
    return bucket;
}

/**
 * ✅ PRODUCTION: Normalise une couleur hex GTFS
 * Ajoute le préfixe # si manquant, retourne la couleur par défaut si vide
 * @param {string} color - Couleur hex (avec ou sans #)
 * @param {string} defaultColor - Couleur par défaut
 * @returns {string} Couleur hex normalisée avec #
 */
export function normalizeGtfsColor(color, defaultColor = '#3388ff') {
    if (!color || typeof color !== 'string') {
        return defaultColor;
    }
    const trimmed = color.trim();
    if (!trimmed || trimmed === '#') {
        return defaultColor;
    }
    // Vérifie si c'est un hex valide (3 ou 6 caractères)
    const hexPattern = /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    if (!hexPattern.test(trimmed)) {
        return defaultColor;
    }
    return trimmed.startsWith('#') ? trimmed : '#' + trimmed;
}

/**
 * ✅ PRODUCTION: Extrait les couleurs normalisées d'une route
 * @param {Object} route - Objet route GTFS
 * @returns {Object} { routeColor, routeTextColor }
 */
export function getRouteColors(route) {
    if (!route) {
        return { routeColor: '#3388ff', routeTextColor: '#ffffff' };
    }
    return {
        routeColor: normalizeGtfsColor(route.route_color, '#3388ff'),
        routeTextColor: normalizeGtfsColor(route.route_text_color, '#ffffff')
    };
}
