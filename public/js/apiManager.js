// Copyright © 2025 Périmap - Tous droits réservés
/**
 * apiManager.js
 * Client léger vers le backend Perimap (OTP + Photon + GTFS-RT)
 */

import { getAppConfig } from './config.js';

export class ApiManager {
    constructor() {
        const config = getAppConfig();
        this.debug = !!config.debug;
        this.apiEndpoints = config.apiEndpoints || {
            routes: '/api/routes',
            places: '/api/places',
            realtime: '/api/realtime'
        };

        // Alias locaux conservés (Campus)
        this.placeAliases = {
            campus: {
                canonicalName: 'Campus Universitaire, Périgueux',
                aliases: ['campus', 'campus périgueux', 'fac', 'fac périgueux', 'université', 'université périgueux', 'iut', 'iut périgueux', 'grenadière', 'pole universitaire', 'pôle universitaire', 'la grenadière'],
                coordinates: { lat: 45.1958, lng: 0.7192 },
                description: 'Campus universitaire (arrêts Campus + Pôle Grenadière)',
                gtfsStops: [
                    { stopId: 'MOBIITI:StopPlace:77309', name: 'Campus', lat: 45.197113, lng: 0.718130 },
                    { stopId: 'MOBIITI:StopPlace:77314', name: 'Pôle Universitaire Grenadière', lat: 45.194477, lng: 0.720215 }
                ],
                searchRadius: 400
            }
        };
    }

    async getPlaceAutocomplete(inputString, lat, lon) {
        const aliasMatch = this._checkPlaceAlias(inputString);
        if (aliasMatch) {
            return [{
                description: `🎓 ${aliasMatch.canonicalName}`,
                placeId: 'ALIAS_CAMPUS',
                lat: aliasMatch.coordinates.lat,
                lng: aliasMatch.coordinates.lng,
                isAlias: true
            }];
        }

        const params = new URLSearchParams({ q: inputString });
        // Ajoute la position actuelle pour prioriser les résultats près de l'utilisateur
        if (lat && lon) {
            params.set('lat', String(lat));
            params.set('lon', String(lon));
        }
        const url = `${this.apiEndpoints.places}/autocomplete?${params.toString()}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error(`Autocomplete error ${resp.status}`);
        }
        const json = await resp.json();
        return (json.suggestions || []).map((s) => ({
            description: s.description || s.city || inputString,
            placeId: buildCoordPlaceId(s.lat, s.lon),
            lat: s.lat,
            lng: s.lon
        }));
    }

    async resolveAliasOrPlaceId(placeId) {
        return this.getPlaceCoords(placeId);
    }

    async getPlaceCoords(placeId) {
        if (!placeId) return null;
        if (placeId.startsWith('ALIAS_')) {
            const alias = this.placeAliases.campus;
            return { lat: alias.coordinates.lat, lng: alias.coordinates.lng, gtfsStops: alias.gtfsStops, isMultiStop: true };
        }
        const coord = parseCoordPlaceId(placeId);
        if (coord) return coord;
        return null;
    }

    async reverseGeocode(lat, lng) {
        const params = new URLSearchParams({ lat: String(lat), lon: String(lng) });
        const resp = await fetch(`${this.apiEndpoints.places}/reverse?${params.toString()}`);
        if (!resp.ok) return null;
        const json = await resp.json();
        const p = json.place;
        return p ? buildCoordPlaceId(p.lat, p.lon) : null;
    }

    async fetchBicycleRoute(fromPlaceId, toPlaceId) {
        const origin = await this.getPlaceCoords(fromPlaceId);
        const destination = await this.getPlaceCoords(toPlaceId);
        if (!origin || !destination) return null;

        const body = {
            origin: { lat: origin.lat, lon: origin.lng },
            destination: { lat: destination.lat, lon: destination.lng },
            mode: 'BICYCLE'
        };

        const resp = await fetch(this.apiEndpoints.routes, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!resp.ok) return null;
        const json = await resp.json();
        return { routes: json.routes || [] };
    }

    async fetchWalkingRoute(fromPlaceId, toPlaceId) {
        const origin = await this.getPlaceCoords(fromPlaceId);
        const destination = await this.getPlaceCoords(toPlaceId);
        if (!origin || !destination) return null;

        const body = {
            origin: { lat: origin.lat, lon: origin.lng },
            destination: { lat: destination.lat, lon: destination.lng },
            mode: 'WALK'
        };

        const resp = await fetch(this.apiEndpoints.routes, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!resp.ok) return null;
        const json = await resp.json();
        return { routes: json.routes || [] };
    }

    async fetchItinerary(fromPlaceId, toPlaceId, searchTime = null) {
        const origin = await this.getPlaceCoords(fromPlaceId);
        const destination = await this.getPlaceCoords(toPlaceId);
        if (!origin || !destination) throw new Error('Coordonnées manquantes');

        const body = {
            origin: { lat: origin.lat, lon: origin.lng },
            destination: { lat: destination.lat, lon: destination.lng },
            time: searchTime ? buildIsoDateTime(searchTime) : new Date().toISOString(),
            timeType: searchTime?.type === 'arriver' ? 'arrival' : 'departure',
            mode: 'TRANSIT'
        };

        if (this.debug) {
            console.log('📤 apiManager.fetchItinerary() body:', body);
        }

        const resp = await fetch(this.apiEndpoints.routes, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const err = await safeJson(resp);
            throw new Error(`Routes error ${resp.status}: ${err?.error || ''}`);
        }

        const json = await resp.json();
        if (this.debug) {
            console.log('📥 apiManager.fetchItinerary() response:', json);
        }
        // Retourner un objet avec routes pour compatibilité avec processIntelligentResults
        return { routes: json.routes || [] };
    }

    _checkPlaceAlias(input) {
        const lower = (input || '').toLowerCase().trim();
        if (!lower) return null;
        const alias = this.placeAliases.campus;
        return alias.aliases.includes(lower) ? alias : null;
    }
}

// Helpers
function buildCoordPlaceId(lat, lon) {
    return `COORD_${lat.toFixed(6)}_${lon.toFixed(6)}`;
}

function parseCoordPlaceId(placeId) {
    if (!placeId?.startsWith('COORD_')) return null;
    const parts = placeId.replace('COORD_', '').split('_');
    if (parts.length !== 2) return null;
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    return isNaN(lat) || isNaN(lng) ? null : { lat, lng };
}

function buildIsoDateTime(searchTime) {
    if (searchTime?.dateTime) return searchTime.dateTime;
    
    // searchTime.date est en format YYYY-MM-DD (local)
    // searchTime.hour et searchTime.minute sont des strings (ex: "7", "30")
    const dateStr = searchTime?.date;
    const hour = parseInt(searchTime?.hour || '0', 10);
    const minute = parseInt(searchTime?.minute || '0', 10);
    
    if (!dateStr) {
        return new Date().toISOString();
    }
    
    // OTP backend attend une ISO UTC qui REPRÉSENTE l'heure locale
    // Ex: Pour 7:25 locale → on envoie une date UTC qui dit "2025-12-09T07:25:00.000Z"
    // Le backend OTP interprète le time=07:25 avec date=2025-12-09 comme heure locale
    const [year, month, day] = dateStr.split('-');
    const hours = String(hour).padStart(2, '0');
    const mins = String(minute).padStart(2, '0');
    
    // Construire directement l'ISO avec les valeurs locales dans la partie UTC
    return `${year}-${month}-${day}T${hours}:${mins}:00.000Z`;
}

async function safeJson(resp) {
    try {
        return await resp.json();
    } catch {
        return null;
    }
}
