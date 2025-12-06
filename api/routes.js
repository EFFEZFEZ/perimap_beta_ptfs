/**
 * Proxy API pour Google Routes - V226
 * Masque la clé API côté serveur (Vercel Edge Function)
 * 
 * ✅ V226: Support GET pour activation du cache CDN Vercel
 * 
 * Endpoints supportés:
 * - GET/POST /api/routes?action=directions : Calcul d'itinéraire transit
 * - GET/POST /api/routes?action=walking : Itinéraire piéton
 * - GET/POST /api/routes?action=bicycle : Itinéraire vélo
 * 
 * Paramètres GET (pour cache CDN):
 * - origin: PlaceId ou "lat,lng"
 * - destination: PlaceId ou "lat,lng"
 * - time: ISO 8601 (arrondi à 5 min pour optimiser cache)
 * - timeType: "departure" ou "arrival"
 */

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // ✅ V226: Accepter GET et POST
    if (req.method !== 'POST' && req.method !== 'GET') {
        res.status(405).json({ error: 'Méthode non autorisée. Utilisez GET ou POST.' });
        return;
    }

    const apiKey = process.env.GMAPS_SERVER_KEY;
    if (!apiKey) {
        res.status(500).json({ error: 'GMAPS_SERVER_KEY manquant sur le serveur.' });
        return;
    }

    const { action } = req.query;
    
    if (!action || !['directions', 'walking', 'bicycle'].includes(action)) {
        res.status(400).json({ error: 'Paramètre action invalide. Valeurs: directions, walking, bicycle' });
        return;
    }

    const API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

    try {
        let body;

        // ✅ V226: Construire le body selon la méthode
        if (req.method === 'GET') {
            body = buildBodyFromQuery(req.query, action);
            if (!body) {
                res.status(400).json({ error: 'Paramètres GET invalides: origin et destination requis.' });
                return;
            }
        } else {
            // POST classique (fallback)
            body = req.body;
            if (!body || !body.origin || !body.destination) {
                res.status(400).json({ error: 'Corps de requête invalide: origin et destination requis.' });
                return;
            }
        }

        // Définir le FieldMask selon le type de route
        let fieldMask = 'routes.duration,routes.distanceMeters,routes.polyline';
        
        if (action === 'directions') {
            // Pour le transit, on veut les étapes détaillées
            fieldMask = 'routes.duration,routes.distanceMeters,routes.polyline,routes.legs.steps';
        } else {
            // Pour marche/vélo, on veut aussi la polyline des legs
            fieldMask = 'routes.duration,routes.distanceMeters,routes.polyline,routes.legs.polyline';
        }

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': fieldMask
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[routes proxy] Google API error:', data);
            res.status(response.status).json(data);
            return;
        }

        // ✅ V226: Cache CDN Vercel activé pour GET
        if (req.method === 'GET') {
            // Cache CDN 1h + stale-while-revalidate 10 min
            // Les itinéraires sont relativement stables sur une journée
            res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
        } else {
            // POST: cache navigateur uniquement
            res.setHeader('Cache-Control', 'private, max-age=120');
        }

        res.status(200).json(data);
    } catch (error) {
        console.error('[routes proxy] Error:', error);
        res.status(502).json({ error: 'Routes proxy error', details: error.message });
    }
}

/**
 * ✅ V226: Construit le body Google Routes à partir des query params
 * @param {Object} query - req.query
 * @param {string} action - 'directions', 'walking', ou 'bicycle'
 * @returns {Object|null} - Body pour l'API Google ou null si invalide
 */
function buildBodyFromQuery(query, action) {
    const { origin, destination, time, timeType } = query;

    if (!origin || !destination) {
        return null;
    }

    // Parser origin (PlaceId ou "lat,lng")
    const originObj = parseLocation(origin);
    const destObj = parseLocation(destination);

    if (!originObj || !destObj) {
        return null;
    }

    // Déterminer le travelMode selon l'action
    let travelMode;
    switch (action) {
        case 'directions':
            travelMode = 'TRANSIT';
            break;
        case 'walking':
            travelMode = 'WALK';
            break;
        case 'bicycle':
            travelMode = 'BICYCLE';
            break;
        default:
            travelMode = 'TRANSIT';
    }

    const body = {
        origin: originObj,
        destination: destObj,
        travelMode,
        languageCode: 'fr',
        units: 'METRIC'
    };

    // Ajouter les préférences transit pour les bus
    if (action === 'directions') {
        body.computeAlternativeRoutes = true;
        body.transitPreferences = {
            allowedTravelModes: ['BUS'],
            routingPreference: 'FEWER_TRANSFERS'
        };
    }

    // Ajouter le temps si fourni
    if (time) {
        if (timeType === 'arrival') {
            body.arrivalTime = time;
        } else {
            body.departureTime = time;
        }
    }

    return body;
}

/**
 * Parse une location string en objet Google Routes
 * @param {string} loc - PlaceId ou "lat,lng"
 * @returns {Object|null} - { placeId: ... } ou { location: { latLng: ... } }
 */
function parseLocation(loc) {
    if (!loc) return null;

    // Vérifier si c'est des coordonnées "lat,lng"
    if (loc.includes(',')) {
        const parts = loc.split(',');
        if (parts.length === 2) {
            const lat = parseFloat(parts[0]);
            const lng = parseFloat(parts[1]);
            if (!isNaN(lat) && !isNaN(lng)) {
                return {
                    location: {
                        latLng: {
                            latitude: lat,
                            longitude: lng
                        }
                    }
                };
            }
        }
    }

    // Sinon c'est un PlaceId
    return { placeId: loc };
}
