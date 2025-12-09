// Copyright © 2025 Périmap - Tous droits réservés
/**
 * services/otpService.js
 * Service centralisé pour la communication avec OpenTripPlanner
 * 
 * RESPONSABILITÉS:
 * - Connexion robuste à l'API OTP
 * - Enrichissement des données avec les couleurs GTFS
 * - Gestion des erreurs explicites (pas de fallback inventé)
 * - Formatage standardisé des réponses
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('otp-service');

// Configuration OTP
const OTP_BASE_URL = process.env.OTP_BASE_URL || 'http://otp:8080/otp/routers/default';
const OTP_TIMEOUT_MS = parseInt(process.env.OTP_TIMEOUT_MS || '15000', 10);
const OTP_MAX_ITINERARIES = parseInt(process.env.OTP_MAX_ITINERARIES || '5', 10);

// Cache des couleurs GTFS (route_id -> { color, textColor })
let gtfsRouteColors = new Map();

/**
 * Initialise le service OTP avec les données GTFS
 * @param {Map} routeColorsMap - Map route_id -> { color, textColor }
 */
export function initOtpService(routeColorsMap) {
    if (routeColorsMap instanceof Map) {
        gtfsRouteColors = routeColorsMap;
        logger.info(`✅ OTP Service initialisé avec ${gtfsRouteColors.size} couleurs de lignes`);
    } else {
        logger.warn('⚠️ OTP Service initialisé sans données de couleurs');
    }
}

/**
 * Vérifie la connectivité avec OTP
 * @returns {Promise<{ ok: boolean, version?: string, error?: string }>}
 */
export async function checkOtpHealth() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(`${OTP_BASE_URL}`, {
            method: 'GET',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const data = await response.json().catch(() => ({}));
            return { ok: true, version: data.routerVersion || 'unknown' };
        }
        return { ok: false, error: `HTTP ${response.status}` };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

/**
 * Normalise une couleur hex (ajoute # si manquant)
 * @param {string} color - Couleur hex
 * @param {string} defaultColor - Couleur par défaut
 * @returns {string}
 */
function normalizeColor(color, defaultColor = '#3388ff') {
    if (!color || typeof color !== 'string') return defaultColor;
    const trimmed = color.trim();
    if (!trimmed || trimmed === '#') return defaultColor;
    if (/^#?[A-Fa-f0-9]{6}$/.test(trimmed)) {
        return trimmed.startsWith('#') ? trimmed : '#' + trimmed;
    }
    return defaultColor;
}

/**
 * Récupère les couleurs d'une ligne depuis le cache GTFS
 * @param {string} routeId - ID de la route
 * @returns {{ color: string, textColor: string }}
 */
function getRouteColors(routeId) {
    if (!routeId || !gtfsRouteColors.has(routeId)) {
        return { color: '#3388ff', textColor: '#ffffff' };
    }
    const cached = gtfsRouteColors.get(routeId);
    return {
        color: normalizeColor(cached.color, '#3388ff'),
        textColor: normalizeColor(cached.textColor, '#ffffff')
    };
}

/**
 * Formate une date pour l'API OTP
 * @param {Date} dateObj 
 * @returns {{ dateStr: string, timeStr: string }}
 */
function formatForOtp(dateObj) {
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = dateObj.getFullYear();
    const mm = pad(dateObj.getMonth() + 1);
    const dd = pad(dateObj.getDate());
    const hh = pad(dateObj.getHours());
    const mi = pad(dateObj.getMinutes());
    return { dateStr: `${yyyy}-${mm}-${dd}`, timeStr: `${hh}:${mi}` };
}

/**
 * Convertit le mode client en mode OTP
 * @param {string} mode - 'TRANSIT', 'WALK', 'BICYCLE'
 * @returns {string}
 */
function buildOtpMode(mode) {
    if (mode === 'WALK') return 'WALK';
    if (mode === 'BICYCLE') return 'BICYCLE';
    return 'TRANSIT,WALK';
}

/**
 * Enrichit un leg avec les couleurs GTFS
 * @param {Object} leg - Leg OTP brut
 * @returns {Object} Leg enrichi
 */
function enrichLegWithColors(leg) {
    const isTransit = ['BUS', 'TRAM', 'SUBWAY', 'RAIL', 'FERRY'].includes(leg.mode) || leg.transitLeg;
    
    let routeColor = null;
    let routeTextColor = null;
    
    if (isTransit && leg.routeId) {
        // Priorité 1: Couleurs du cache GTFS (routes.txt)
        const gtfsColors = getRouteColors(leg.routeId);
        routeColor = gtfsColors.color;
        routeTextColor = gtfsColors.textColor;
        
        // Priorité 2: Couleurs OTP si GTFS n'a pas la couleur
        if (routeColor === '#3388ff' && leg.routeColor) {
            routeColor = normalizeColor(leg.routeColor);
        }
        if (routeTextColor === '#ffffff' && leg.routeTextColor) {
            routeTextColor = normalizeColor(leg.routeTextColor, '#ffffff');
        }
    }
    
    return {
        mode: leg.mode,
        duration: Math.round(leg.duration || 0),
        distanceMeters: Math.round(leg.distance || 0),
        
        // ✅ CRITIQUE: La polyline OTP est la SEULE source de vérité pour le tracé
        polyline: leg.legGeometry?.points || null,
        legGeometry: leg.legGeometry || null,
        
        // Horaires (timestamps millisecondes)
        startTime: leg.startTime || null,
        endTime: leg.endTime || null,
        
        // Points de départ/arrivée
        from: {
            name: leg.from?.name || null,
            lat: leg.from?.lat,
            lon: leg.from?.lon,
            stopId: leg.from?.stopId || null,
            stopCode: leg.from?.stopCode || null
        },
        to: {
            name: leg.to?.name || null,
            lat: leg.to?.lat,
            lon: leg.to?.lon,
            stopId: leg.to?.stopId || null,
            stopCode: leg.to?.stopCode || null
        },
        
        // Infos transit enrichies avec couleurs GTFS
        ...(isTransit && {
            routeColor,
            routeTextColor,
            routeShortName: leg.routeShortName || null,
            routeLongName: leg.routeLongName || null,
            routeId: leg.routeId || null,
            tripId: leg.tripId || null,
            headsign: leg.headsign || null,
            agencyName: leg.agencyName || null,
            // Arrêts intermédiaires (si disponibles)
            intermediateStops: (leg.intermediateStops || []).map(stop => ({
                name: stop.name,
                lat: stop.lat,
                lon: stop.lon,
                stopId: stop.stopId,
                arrival: stop.arrival,
                departure: stop.departure
            }))
        })
    };
}

/**
 * Convertit un itinéraire OTP en format client
 * @param {Object} itinerary - Itinéraire OTP brut
 * @returns {Object} Itinéraire formaté et enrichi
 */
function mapItineraryToClient(itinerary) {
    const legs = Array.isArray(itinerary.legs) ? itinerary.legs : [];
    const mappedLegs = legs.map(enrichLegWithColors);
    
    const totalDistance = mappedLegs.reduce((acc, l) => acc + (l.distanceMeters || 0), 0);
    const totalDuration = Math.round(itinerary.duration || 0);
    
    // Déterminer le type principal de l'itinéraire
    const hasTransit = mappedLegs.some(l => ['BUS', 'TRAM', 'SUBWAY', 'RAIL'].includes(l.mode));
    const hasBike = mappedLegs.some(l => l.mode === 'BICYCLE');
    let type = 'WALK';
    if (hasTransit) type = 'TRANSIT';
    else if (hasBike) type = 'BIKE';
    
    return {
        type,
        duration: totalDuration,
        distanceMeters: Math.round(totalDistance),
        startTime: itinerary.startTime || null,
        endTime: itinerary.endTime || null,
        walkTime: itinerary.walkTime || 0,
        transitTime: itinerary.transitTime || 0,
        waitingTime: itinerary.waitingTime || 0,
        transfers: itinerary.transfers || 0,
        legs: mappedLegs,
        fare: itinerary.fare?.fare?.regular?.cents
            ? { 
                currency: itinerary.fare.fare.regular.currency || 'EUR', 
                amountCents: itinerary.fare.fare.regular.cents 
            }
            : null
    };
}

/**
 * Classe d'erreur personnalisée pour OTP
 */
export class OtpError extends Error {
    constructor(message, code, details = null) {
        super(message);
        this.name = 'OtpError';
        this.code = code;
        this.details = details;
    }
}

/**
 * Codes d'erreur OTP
 */
export const OTP_ERROR_CODES = {
    NO_ROUTE: 'NO_ROUTE',
    DATE_OUT_OF_RANGE: 'DATE_OUT_OF_RANGE',
    LOCATION_NOT_FOUND: 'LOCATION_NOT_FOUND',
    CONNECTION_ERROR: 'CONNECTION_ERROR',
    TIMEOUT: 'TIMEOUT',
    INVALID_REQUEST: 'INVALID_REQUEST',
    UNKNOWN: 'UNKNOWN'
};

/**
 * Analyse l'erreur OTP et retourne un code d'erreur approprié
 * @param {Object} otpError - Erreur OTP
 * @returns {{ code: string, message: string }}
 */
function parseOtpError(otpError) {
    const msg = otpError?.message || otpError?.msg || '';
    const id = otpError?.id || 0;
    
    // Erreurs connues d'OTP
    if (id === 404 || msg.includes('PATH_NOT_FOUND')) {
        return { code: OTP_ERROR_CODES.NO_ROUTE, message: 'Aucun itinéraire trouvé entre ces deux points' };
    }
    if (msg.includes('DATE_OUT_OF_RANGE') || msg.includes('date too far')) {
        return { code: OTP_ERROR_CODES.DATE_OUT_OF_RANGE, message: 'La date demandée est hors de la plage des horaires disponibles' };
    }
    if (msg.includes('LOCATION_NOT_ACCESSIBLE') || msg.includes('not accessible')) {
        return { code: OTP_ERROR_CODES.LOCATION_NOT_FOUND, message: 'Un des points de départ ou d\'arrivée n\'est pas accessible' };
    }
    if (msg.includes('NO_TRANSIT_TIMES')) {
        return { code: OTP_ERROR_CODES.NO_ROUTE, message: 'Aucun transport en commun disponible à cet horaire' };
    }
    
    return { code: OTP_ERROR_CODES.UNKNOWN, message: msg || 'Erreur inconnue du planificateur' };
}

/**
 * Planifie un itinéraire via OTP
 * 
 * @param {Object} params - Paramètres de la requête
 * @param {Object} params.origin - { lat, lon }
 * @param {Object} params.destination - { lat, lon }
 * @param {Date|string} [params.time] - Date/heure de voyage
 * @param {string} [params.timeType='departure'] - 'departure' ou 'arrival'
 * @param {string} [params.mode='TRANSIT'] - Mode de transport
 * @param {number} [params.maxWalkDistance=1000] - Distance max de marche (m)
 * @param {number} [params.maxTransfers=3] - Nombre max de correspondances
 * @param {Object} [params.options] - Options supplémentaires
 * @returns {Promise<{ routes: Array, metadata: Object }>}
 * @throws {OtpError} En cas d'erreur OTP
 */
export async function planItinerary(params) {
    const {
        origin,
        destination,
        time,
        timeType = 'departure',
        mode = 'TRANSIT',
        maxWalkDistance = 1000,
        maxTransfers = 3,
        options = {}
    } = params;
    
    // Validation des coordonnées
    if (!origin?.lat || !origin?.lon || !destination?.lat || !destination?.lon) {
        throw new OtpError(
            'Coordonnées invalides',
            OTP_ERROR_CODES.INVALID_REQUEST,
            { origin, destination }
        );
    }
    
    // Formater la date
    const travelDate = time ? new Date(time) : new Date();
    if (Number.isNaN(travelDate.getTime())) {
        throw new OtpError(
            'Date invalide',
            OTP_ERROR_CODES.INVALID_REQUEST,
            { time }
        );
    }
    
    const { dateStr, timeStr } = formatForOtp(travelDate);
    const arriveBy = timeType === 'arrival';
    const otpMode = buildOtpMode(mode);
    
    // Construire les paramètres OTP
    const searchParams = new URLSearchParams({
        fromPlace: `${origin.lat},${origin.lon}`,
        toPlace: `${destination.lat},${destination.lon}`,
        mode: otpMode,
        date: dateStr,
        time: timeStr,
        arriveBy: arriveBy ? 'true' : 'false',
        maxWalkDistance: String(Math.max(0, maxWalkDistance)),
        numItineraries: String(OTP_MAX_ITINERARIES),
        maxTransfers: String(Math.max(0, maxTransfers)),
        wheelchair: options.wheelchairAccessible ? 'true' : 'false',
        optimize: options.preferLessWalking ? 'WALKING' : 'QUICK',
        locale: 'fr'
    });
    
    const otpUrl = `${OTP_BASE_URL}/plan?${searchParams.toString()}`;
    logger.debug(`OTP Request: ${otpUrl}`);
    
    // Appel OTP avec timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OTP_TIMEOUT_MS);
    
    try {
        const response = await fetch(otpUrl, {
            method: 'GET',
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });
        clearTimeout(timeoutId);
        
        const responseText = await response.text();
        let otpJson;
        
        try {
            otpJson = JSON.parse(responseText);
        } catch (parseError) {
            logger.error('OTP response parse error:', responseText.slice(0, 500));
            throw new OtpError(
                'Réponse invalide du planificateur',
                OTP_ERROR_CODES.UNKNOWN,
                { responseText: responseText.slice(0, 200) }
            );
        }
        
        // Vérifier les erreurs OTP
        if (otpJson.error) {
            const { code, message } = parseOtpError(otpJson.error);
            logger.warn(`OTP Error [${code}]: ${message}`);
            throw new OtpError(message, code, otpJson.error);
        }
        
        // Vérifier la présence d'itinéraires
        if (!otpJson.plan?.itineraries || !Array.isArray(otpJson.plan.itineraries)) {
            throw new OtpError(
                'Aucun itinéraire trouvé',
                OTP_ERROR_CODES.NO_ROUTE,
                { plan: otpJson.plan }
            );
        }
        
        const itineraries = otpJson.plan.itineraries;
        
        if (itineraries.length === 0) {
            throw new OtpError(
                'Aucun itinéraire disponible pour ce trajet',
                OTP_ERROR_CODES.NO_ROUTE
            );
        }
        
        // Mapper et enrichir les itinéraires
        const routes = itineraries.map(mapItineraryToClient);
        
        logger.info(`✅ OTP: ${routes.length} itinéraire(s) trouvé(s)`);
        
        return {
            routes,
            metadata: {
                requestTime: new Date().toISOString(),
                origin: { lat: origin.lat, lon: origin.lon },
                destination: { lat: destination.lat, lon: destination.lon },
                mode,
                timeType,
                travelDate: travelDate.toISOString()
            }
        };
        
    } catch (error) {
        clearTimeout(timeoutId);
        
        // Erreur OTP déjà formatée
        if (error instanceof OtpError) {
            throw error;
        }
        
        // Timeout
        if (error.name === 'AbortError') {
            logger.error('OTP Timeout');
            throw new OtpError(
                'Le planificateur met trop de temps à répondre',
                OTP_ERROR_CODES.TIMEOUT
            );
        }
        
        // Erreur de connexion
        logger.error('OTP Connection error:', error.message);
        throw new OtpError(
            'Impossible de contacter le planificateur',
            OTP_ERROR_CODES.CONNECTION_ERROR,
            { originalError: error.message }
        );
    }
}

export default {
    initOtpService,
    checkOtpHealth,
    planItinerary,
    OtpError,
    OTP_ERROR_CODES
};
