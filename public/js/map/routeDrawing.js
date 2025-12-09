/**
 * routeDrawing.js - Utilitaires de dessin de routes sur la carte
 * 
 * @module map/routeDrawing
 * @version V221
 * 
 * Ce module gère le dessin des itinéraires sur la carte Leaflet :
 * - Styles de polylines (couleur, épaisseur, hachures)
 * - Extraction et décodage des polylines
 * - Ajout des marqueurs d'arrêts
 */

import { decodePolyline } from '../router.js';
import { isMissingTextValue } from '../utils/formatters.js';
import { resolveStopCoordinates } from '../utils/geo.js';

// === CONSTANTES ===

/**
 * Priorité des rôles d'arrêts pour l'affichage des marqueurs
 * @type {Object<string, number>}
 */
export const STOP_ROLE_PRIORITY = {
    boarding: 4,
    alighting: 4,
    transfer: 3,
    intermediate: 1
};

// === DÉTECTION DE STEPS ===

/**
 * Vérifie si une étape est un step d'attente/correspondance
 * @param {Object} step - L'étape à vérifier
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

// === POLYLINES ===

/**
 * Extrait la valeur encodée d'une polyline
 * @param {Object|string} polyline - Polyline ou chaîne encodée
 * @returns {string|null}
 */
export function getEncodedPolylineValue(polyline) {
    if (!polyline) return null;
    if (typeof polyline === 'string') return polyline;
    return polyline.encodedPolyline || polyline.points || null;
}

/**
 * Extrait les coordonnées latLng d'une polyline
 * Supporte plusieurs formats (array, encodedPolyline, coordinates)
 * 
 * @param {Object|Array|string} polyline - La polyline
 * @returns {Array<Array<number>>|null} Array de [lat, lng]
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

    // Cas 1: Array direct de paires
    if (Array.isArray(polyline)) {
        const direct = normalizePairs(polyline);
        if (direct) return direct;
    }

    // Cas 2: Objet avec latLngs
    if (Array.isArray(polyline.latLngs)) {
        const direct = normalizePairs(polyline.latLngs);
        if (direct) return direct;
    }

    // Cas 3: Objet avec points (peut être encodé ou array)
    if (Array.isArray(polyline.points)) {
        const maybeRaw = normalizePairs(polyline.points);
        if (maybeRaw) return maybeRaw;
    }

    // Cas 4: Objet avec coordinates (format GeoJSON)
    if (Array.isArray(polyline.coordinates)) {
        const converted = normalizePairs(polyline.coordinates.map(([lng, lat]) => [lat, lng]));
        if (converted) return converted;
    }

    // Cas 5: Chaîne encodée
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

/**
 * Extrait toutes les polylines d'un step
 * @param {Object} step - L'étape
 * @returns {Array} Array de polylines
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

// === STYLES LEAFLET ===

/**
 * Détermine le style Leaflet pour une étape d'itinéraire
 * @param {Object} step - L'étape
 * @returns {Object} Style Leaflet (color, weight, opacity, dashArray)
 */
export function getLeafletStyleForStep(step) {
    // Vérifie le type simple (vélo/marche)
    if (step.type === 'BIKE') {
        return {
            color: 'var(--secondary)',
            weight: 5,
            opacity: 0.8
        };
    }
    if (step.type === 'WALK') {
        // ✅ CORRECTION 4: Distinction visuelle vol d'oiseau vs tracé routier
        // Pointillés UNIQUEMENT pour les segments sans routing API (vol d'oiseau)
        // Vérifier plusieurs sources possibles du flag isDirectLine
        const isDirectLine = 
            step.polyline?.isDirectLine || 
            step.polylines?.[0]?.isDirectLine ||
            step._walkRouteSource === 'direct' || 
            step._walkRouteSource === 'fallback' ||
            step._source === 'direct' ||
            step._source === 'fallback';
        
        return {
            color: 'var(--primary)',
            weight: 5,
            opacity: 0.8,
            // Pointillés pour vol d'oiseau, ligne continue si API routing
            dashArray: isDirectLine ? '10, 10' : undefined
        };
    }
    // ✅ PRODUCTION: Utilise les couleurs GTFS réelles pour les bus
    if (step.type === 'BUS') {
        // Priorité: routeColor du step > couleur par défaut
        // La couleur vient de routes.txt (route_color) via gtfsProcessor
        let busColor = step.routeColor;
        
        // Normaliser la couleur hex (ajouter # si manquant)
        if (busColor && typeof busColor === 'string') {
            busColor = busColor.trim();
            if (busColor && !busColor.startsWith('#') && /^[A-Fa-f0-9]{6}$/.test(busColor)) {
                busColor = '#' + busColor;
            }
        }
        
        // Fallback si couleur invalide
        if (!busColor || busColor === '#' || busColor.length < 4) {
            busColor = '#3388ff'; // Bleu par défaut GTFS
        }
        
        return {
            color: busColor,
            weight: 6,
            opacity: 0.9
        };
    }
    
    // Fallback pour les types Google (au cas où)
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

// === MARQUEURS ===

/**
 * Crée un divIcon Leaflet pour un arrêt
 * @param {string} role - Rôle de l'arrêt (boarding, alighting, transfer, intermediate)
 * @returns {L.DivIcon|null}
 */
export function createStopDivIcon(role) {
    if (typeof L === 'undefined' || !L.divIcon) return null;
    
    const sizeMap = {
        boarding: 22,
        alighting: 22,
        transfer: 16,
        intermediate: 12
    };
    const size = sizeMap[role] || 12;
    
    return L.divIcon({
        className: `itinerary-stop-marker ${role}`,
        html: '<span></span>',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
    });
}

/**
 * Ajoute les marqueurs d'arrêts pour un itinéraire
 * 
 * @param {Object} itinerary - L'itinéraire
 * @param {L.Map} map - La carte Leaflet
 * @param {L.LayerGroup} markerLayer - Le layer pour les marqueurs
 * @param {Object} [options] - Options
 * @param {Object} [options.dataManager] - Instance du DataManager
 */
export function addItineraryMarkers(itinerary, map, markerLayer, options = {}) {
    const { dataManager = null } = options;
    
    if (!itinerary || !Array.isArray(itinerary.steps) || !map || !markerLayer) return;

    markerLayer.clearLayers();

    const busSteps = itinerary.steps.filter(step => step.type === 'BUS' && !isWaitStep(step));
    if (!busSteps.length) {
        addFallbackItineraryMarkers(itinerary, markerLayer);
        return;
    }

    const stopPoints = [];

    busSteps.forEach((step, index) => {
        const isFirstBus = index === 0;
        const isLastBus = index === busSteps.length - 1;
        const stepStops = [];

        // Arrêt de départ
        if (step.departureStop) {
            stepStops.push({ name: step.departureStop, role: isFirstBus ? 'boarding' : 'transfer' });
        }

        // Arrêts intermédiaires
        let intermediateStopsData = [];
        
        if (Array.isArray(step.intermediateStops) && step.intermediateStops.length > 0) {
            intermediateStopsData = step.intermediateStops.map(stopName => ({
                name: typeof stopName === 'string' ? stopName : (stopName?.name || stopName?.stop_name || ''),
                lat: stopName?.lat || stopName?.stop_lat || null,
                lng: stopName?.lng || stopName?.stop_lon || null
            }));
        }
        
        if (intermediateStopsData.length === 0 && Array.isArray(step.stopTimes) && dataManager) {
            intermediateStopsData = step.stopTimes.slice(1, -1).map(st => {
                const stopObj = dataManager.getStop?.(st.stop_id);
                return {
                    name: stopObj?.stop_name || st.stop_id,
                    lat: parseFloat(stopObj?.stop_lat) || null,
                    lng: parseFloat(stopObj?.stop_lon) || null
                };
            });
        }
        
        intermediateStopsData.forEach(stop => {
            if (stop.name) {
                stepStops.push({ 
                    name: stop.name, 
                    role: 'intermediate',
                    directLat: stop.lat,
                    directLng: stop.lng
                });
            }
        });

        // Arrêt d'arrivée
        if (step.arrivalStop) {
            stepStops.push({ name: step.arrivalStop, role: isLastBus ? 'alighting' : 'transfer' });
        }

        // Résoudre les coordonnées
        stepStops.forEach(stop => {
            let coords = null;
            
            if (stop.directLat && stop.directLng) {
                coords = { lat: stop.directLat, lng: stop.directLng };
            } else if (dataManager) {
                coords = resolveStopCoordinates(stop.name, dataManager);
            }
            
            if (!coords) {
                console.log(`⚠️ Coordonnées non trouvées pour: ${stop.name}`);
                return;
            }

            const key = `${coords.lat.toFixed(5)}-${coords.lng.toFixed(5)}`;
            const existing = stopPoints.find(point => point.key === key);
            
            if (existing) {
                if (STOP_ROLE_PRIORITY[stop.role] > STOP_ROLE_PRIORITY[existing.role]) {
                    existing.role = stop.role;
                }
                if (!existing.names.includes(stop.name)) {
                    existing.names.push(stop.name);
                }
                return;
            }

            stopPoints.push({
                key,
                lat: coords.lat,
                lng: coords.lng,
                role: stop.role,
                names: [stop.name]
            });
        });
    });

    if (!stopPoints.length) {
        addFallbackItineraryMarkers(itinerary, markerLayer);
        return;
    }

    // Créer les marqueurs avec z-index approprié
    stopPoints.forEach(point => {
        const icon = createStopDivIcon(point.role);
        if (!icon) return;
        
        let zIndex = 800;
        if (point.role === 'boarding' || point.role === 'alighting') {
            zIndex = 1200;
        } else if (point.role === 'transfer') {
            zIndex = 1000;
        }
        
        const marker = L.marker([point.lat, point.lng], {
            icon,
            zIndexOffset: zIndex
        });
        markerLayer.addLayer(marker);
    });
    
    console.log(`📍 ${stopPoints.length} marqueurs ajoutés (${stopPoints.filter(p => p.role === 'intermediate').length} arrêts intermédiaires)`);
}

/**
 * Ajoute des marqueurs de fallback depuis les polylines
 * @param {Object} itinerary - L'itinéraire
 * @param {L.LayerGroup} markerLayer - Le layer pour les marqueurs
 */
export function addFallbackItineraryMarkers(itinerary, markerLayer) {
    if (!itinerary || !Array.isArray(itinerary.steps) || !itinerary.steps.length) return;

    const fallbackPoints = [];
    
    // Premier point
    const firstStep = itinerary.steps[0];
    const firstPolyline = (firstStep.type === 'BUS') ? firstStep.polyline : firstStep.polylines?.[0];
    const firstLatLngs = getPolylineLatLngs(firstPolyline);
    if (firstLatLngs && firstLatLngs.length) {
        const [lat, lng] = firstLatLngs[0];
        fallbackPoints.push({ lat, lng, role: 'boarding' });
    }

    // Points intermédiaires (correspondances)
    itinerary.steps.forEach((step, index) => {
        if (index === itinerary.steps.length - 1) return;
        const polyline = (step.type === 'BUS')
            ? step.polyline
            : (Array.isArray(step.polylines) ? step.polylines[step.polylines.length - 1] : null);
        const latLngs = getPolylineLatLngs(polyline);
        if (latLngs && latLngs.length) {
            const [lat, lng] = latLngs[latLngs.length - 1];
            fallbackPoints.push({ lat, lng, role: 'transfer' });
        }
    });

    // Dernier point
    const lastStep = itinerary.steps[itinerary.steps.length - 1];
    const lastPolyline = (lastStep.type === 'BUS')
        ? lastStep.polyline
        : (Array.isArray(lastStep.polylines) ? lastStep.polylines[lastStep.polylines.length - 1] : null);
    const lastLatLngs = getPolylineLatLngs(lastPolyline);
    if (lastLatLngs && lastLatLngs.length) {
        const [lat, lng] = lastLatLngs[lastLatLngs.length - 1];
        fallbackPoints.push({ lat, lng, role: 'alighting' });
    }

    // Créer les marqueurs
    fallbackPoints.forEach(point => {
        const icon = createStopDivIcon(point.role);
        if (!icon) return;
        markerLayer.addLayer(L.marker([point.lat, point.lng], {
            icon,
            zIndexOffset: (point.role === 'boarding' || point.role === 'alighting') ? 1200 : 900
        }));
    });
}

/**
 * Dessine un itinéraire sur une carte
 * 
 * @param {Object} itinerary - L'itinéraire à dessiner
 * @param {L.Map} map - La carte Leaflet
 * @param {L.Layer|null} existingRouteLayer - Layer existant à remplacer
 * @param {L.LayerGroup} markerLayer - Layer pour les marqueurs
 * @param {Object} [options] - Options
 * @param {Object} [options.dataManager] - Instance du DataManager
 * @returns {L.FeatureGroup|null} Le nouveau layer créé
 */
export function drawRouteOnMap(itinerary, map, existingRouteLayer, markerLayer, options = {}) {
    // Accepter un tableau ou un objet unique
    if (Array.isArray(itinerary)) {
        itinerary = itinerary[0];
    }
    
    if (!map || !itinerary || !itinerary.steps) return null;

    // Supprimer l'ancien layer
    if (existingRouteLayer) {
        map.removeLayer(existingRouteLayer);
    }
    
    // Vider les anciens marqueurs
    if (markerLayer) {
        markerLayer.clearLayers();
    }

    const stepLayers = [];
    
    itinerary.steps.forEach(step => {
        const style = getLeafletStyleForStep(step);
        const polylinesToDraw = extractStepPolylines(step);

        if (!polylinesToDraw.length) return;

        polylinesToDraw.forEach(polyline => {
            const latLngs = getPolylineLatLngs(polyline);
            if (!latLngs || !latLngs.length) return;

            const stepLayer = L.polyline(latLngs, style);
            stepLayers.push(stepLayer);
        });
    });

    if (stepLayers.length === 0) return null;

    // Créer un groupe avec toutes les couches
    const routeLayer = L.featureGroup(stepLayers).addTo(map);
    
    // Ajouter les marqueurs
    if (markerLayer) {
        addItineraryMarkers(itinerary, map, markerLayer, options);
    }

    // Ajuster la carte pour voir l'ensemble du trajet
    const bounds = routeLayer.getBounds();
    if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] });
    }

    return routeLayer;
}

/**
 * ✅ PRODUCTION: Extrait le segment de shape entre deux arrêts
 * Utilise les shapes.txt GTFS au lieu de tracer des lignes droites
 * 
 * @param {Object} dataManager - Instance du DataManager
 * @param {string} tripId - ID du trip
 * @param {Object} startStop - Arrêt de départ {stop_lat, stop_lon}
 * @param {Object} endStop - Arrêt d'arrivée {stop_lat, stop_lon}
 * @returns {Array<Array<number>>|null} Array de [lat, lng] ou null si shape non trouvé
 */
export function getShapeSegmentBetweenStops(dataManager, tripId, startStop, endStop) {
    if (!dataManager || !tripId) return null;
    
    // 1. Trouver le trip et son shape_id
    const trip = dataManager.tripsByTripId?.[tripId];
    if (!trip || !trip.shape_id) {
        console.warn(`⚠️ Shape non trouvé pour trip ${tripId}`);
        return null;
    }
    
    // 2. Récupérer les points du shape
    const shapePoints = dataManager.shapesById?.[trip.shape_id];
    if (!shapePoints || shapePoints.length < 2) {
        console.warn(`⚠️ Points shape manquants pour ${trip.shape_id}`);
        return null;
    }
    
    // 3. Convertir les coordonnées du shape [lon, lat] -> [lat, lng]
    const shapeLatLngs = shapePoints.map(([lon, lat]) => [lat, lon]);
    
    // 4. Trouver les indices des points les plus proches des arrêts
    const findNearestIndex = (points, targetLat, targetLng) => {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < points.length; i++) {
            const [lat, lng] = points[i];
            const dist = Math.sqrt(Math.pow(lat - targetLat, 2) + Math.pow(lng - targetLng, 2));
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
            }
        }
        return bestIdx;
    };
    
    const startLat = parseFloat(startStop.stop_lat);
    const startLng = parseFloat(startStop.stop_lon);
    const endLat = parseFloat(endStop.stop_lat);
    const endLng = parseFloat(endStop.stop_lon);
    
    if (isNaN(startLat) || isNaN(endLat)) return null;
    
    const startIdx = findNearestIndex(shapeLatLngs, startLat, startLng);
    const endIdx = findNearestIndex(shapeLatLngs, endLat, endLng);
    
    // 5. Extraire le segment (gère les deux sens)
    if (startIdx === endIdx) {
        return [shapeLatLngs[startIdx]];
    }
    
    if (startIdx < endIdx) {
        return shapeLatLngs.slice(startIdx, endIdx + 1);
    } else {
        // Shape inversé
        return shapeLatLngs.slice(endIdx, startIdx + 1).reverse();
    }
}

/**
 * ✅ PRODUCTION: Vérifie si un step a une polyline valide (pas juste une ligne droite)
 * @param {Object} step - L'étape
 * @returns {boolean}
 */
export function hasValidShapePolyline(step) {
    if (!step) return false;
    const latLngs = getPolylineLatLngs(step.polyline || step.polylines?.[0]);
    // Une polyline shape valide a généralement plus de 2 points
    return latLngs && latLngs.length > 2;
}

// === EXPORTS PAR DÉFAUT ===

export default {
    // Constantes
    STOP_ROLE_PRIORITY,
    
    // Détection
    isWaitStep,
    
    // Polylines
    getEncodedPolylineValue,
    getPolylineLatLngs,
    extractStepPolylines,
    
    // Styles
    getLeafletStyleForStep,
    
    // Marqueurs
    createStopDivIcon,
    addItineraryMarkers,
    addFallbackItineraryMarkers,
    
    // Dessin
    drawRouteOnMap,
    
    // ✅ PRODUCTION: Shapes GTFS
    getShapeSegmentBetweenStops,
    hasValidShapePolyline
};
