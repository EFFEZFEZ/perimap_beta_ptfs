/**
 * polyline.js - Utilitaires pour les polylines
 * 
 * Ce module gère l'encodage, le décodage et l'extraction des polylines
 * utilisées pour tracer les itinéraires sur la carte.
 */

import { isMissingTextValue } from './formatters.js';

// === Encodage/Décodage de polylines ===

/**
 * Décode une polyline encodée en tableau de coordonnées [lat, lng]
 * @param {string} encoded - Polyline encodée
 * @returns {Array} - Tableau de [lat, lng]
 */
export function decodePolyline(encoded) {
    if (!encoded || typeof encoded !== 'string') return [];
    
    const points = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    
    while (index < encoded.length) {
        let shift = 0;
        let result = 0;
        let byte;
        
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        
        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;
        
        shift = 0;
        result = 0;
        
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        
        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;
        
        points.push([lat / 1e5, lng / 1e5]);
    }
    
    return points;
}

/**
 * Encode un tableau de coordonnées [lat, lng] en polyline
 * @param {Array} coordinates - Tableau de [lat, lng]
 * @returns {string} - Polyline encodée
 */
export function encodePolyline(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length === 0) return '';
    
    let encoded = '';
    let prevLat = 0;
    let prevLng = 0;
    
    for (const point of coordinates) {
        const lat = Math.round(point[0] * 1e5);
        const lng = Math.round(point[1] * 1e5);
        
        encoded += encodeNumber(lat - prevLat);
        encoded += encodeNumber(lng - prevLng);
        
        prevLat = lat;
        prevLng = lng;
    }
    
    return encoded;
}

/**
 * Encode un nombre pour la polyline
 * @param {number} num - Nombre à encoder
 * @returns {string} - Caractères encodés
 */
function encodeNumber(num) {
    let value = num < 0 ? ~(num << 1) : (num << 1);
    let encoded = '';
    
    while (value >= 0x20) {
        encoded += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
        value >>= 5;
    }
    
    encoded += String.fromCharCode(value + 63);
    return encoded;
}

// === Extraction de polylines ===

/**
 * Récupère la valeur encodée d'une polyline
 * @param {*} polyline - Objet polyline ou chaîne
 * @returns {string|null}
 */
export function getEncodedPolylineValue(polyline) {
    if (!polyline) return null;
    if (typeof polyline === 'string') return polyline;
    return polyline.encodedPolyline || polyline.points || null;
}

/**
 * Récupère les coordonnées lat/lng d'une polyline
 * @param {*} polyline - Objet polyline, tableau ou chaîne encodée
 * @returns {Array|null} - Tableau de [lat, lng] ou null
 */
export function getPolylineLatLngs(polyline) {
    if (!polyline) return null;
    
    const normalizePairs = (pairs) => {
        if (!Array.isArray(pairs)) return null;
        const normalized = pairs
            .map((pair) => {
                if (!Array.isArray(pair) || pair.length < 2) return null;
                const lat = Number(pair[0]);
                const lon = Number(pair[1]);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
                return [lat, lon];
            })
            .filter(Boolean);
        return normalized.length ? normalized : null;
    };
    
    // Cas: tableau direct de paires
    if (Array.isArray(polyline)) {
        const direct = normalizePairs(polyline);
        if (direct) return direct;
    }
    
    // Cas: objet avec latLngs
    if (Array.isArray(polyline.latLngs)) {
        const direct = normalizePairs(polyline.latLngs);
        if (direct) return direct;
    }
    
    // Cas: objet avec points
    if (Array.isArray(polyline.points)) {
        const maybeRaw = normalizePairs(polyline.points);
        if (maybeRaw) return maybeRaw;
    }
    
    // Cas: objet avec coordinates (format GeoJSON [lng, lat])
    if (Array.isArray(polyline.coordinates)) {
        const converted = normalizePairs(polyline.coordinates.map(([lng, lat]) => [lat, lng]));
        if (converted) return converted;
    }
    
    // Cas: chaîne encodée
    const encoded = getEncodedPolylineValue(polyline);
    if (encoded) {
        try {
            return decodePolyline(encoded);
        } catch (err) {
            console.warn('getPolylineLatLngs: decode failed', err);
        }
    }
    
    return null;
}

// === Vérification d'étapes ===

/**
 * Vérifie si une étape est une étape d'attente
 * @param {Object} step - Étape à vérifier
 * @returns {boolean}
 */
export function isWaitStep(step) {
    if (!step) return false;
    if (step.type === 'WAIT') return true;
    const instruction = (step.instruction || '').toLowerCase();
    const looksLikeWait = instruction.includes('correspondance') || 
                          instruction.includes('attente') || 
                          instruction.includes('transfert');
    const missingRoute = isMissingTextValue(step.routeShortName);
    const missingStops = isMissingTextValue(step.departureStop) && isMissingTextValue(step.arrivalStop);
    return looksLikeWait && (missingRoute || missingStops);
}

/**
 * Extrait les polylines d'une étape
 * @param {Object} step - Étape d'itinéraire
 * @returns {Array} - Tableau de polylines
 */
export function extractStepPolylines(step) {
    if (!step || isWaitStep(step)) return [];
    
    const collected = [];
    const pushIfValid = (poly) => {
        if (poly) collected.push(poly);
    };
    
    if (step.type === 'BUS') {
        pushIfValid(step?.polyline);
    } else if (Array.isArray(step.polylines) && step.polylines.length) {
        step.polylines.forEach(pushIfValid);
    } else {
        pushIfValid(step?.polyline);
    }
    
    return collected;
}

// === Style Leaflet ===

/**
 * Retourne le style Leaflet pour une étape d'itinéraire
 * @param {Object} step - Étape d'itinéraire
 * @returns {Object} - Options de style Leaflet
 */
export function getLeafletStyleForStep(step) {
    if (step.type === 'BIKE') {
        return {
            color: 'var(--secondary)',
            weight: 5,
            opacity: 0.8
        };
    }
    
    if (step.type === 'WALK') {
        return {
            color: 'var(--primary)',
            weight: 5,
            opacity: 0.8,
            dashArray: '10, 10'
        };
    }
    
    if (step.type === 'BUS') {
        return {
            color: step.routeColor || 'var(--primary)',
            weight: 5,
            opacity: 0.8
        };
    }
    
    // Fallback pour les types Google
    if (step.travelMode === 'BICYCLE') return getLeafletStyleForStep({ type: 'BIKE' });
    if (step.travelMode === 'WALK') return getLeafletStyleForStep({ type: 'WALK' });
    if (step.travelMode === 'TRANSIT') return getLeafletStyleForStep({ type: 'BUS', routeColor: step.routeColor });
    
    // Style par défaut
    return {
        color: 'var(--primary)',
        weight: 5,
        opacity: 0.8
    };
}

export default {
    decodePolyline,
    encodePolyline,
    getEncodedPolylineValue,
    getPolylineLatLngs,
    isWaitStep,
    extractStepPolylines,
    getLeafletStyleForStep
};
