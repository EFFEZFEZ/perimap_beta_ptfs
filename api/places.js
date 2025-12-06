/**
 * Proxy API pour Google Places Autocomplete (NEW API)
 * Masque la clé API côté serveur (Vercel Edge Function)
 * 
 * Utilise la NOUVELLE API Places (places.googleapis.com)
 * 
 * Endpoints supportés:
 * - GET /api/places?input=... : Autocomplétion
 * - GET /api/places?placeId=... : Récupérer les coordonnées d'un lieu
 */

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Méthode non autorisée. Utilisez GET.' });
        return;
    }

    const apiKey = process.env.GMAPS_SERVER_KEY;
    if (!apiKey) {
        res.status(500).json({ error: 'GMAPS_SERVER_KEY manquant sur le serveur.' });
        return;
    }

    const { input, placeId, sessionToken } = req.query;

    try {
        // Mode 1: Autocomplétion avec la NOUVELLE API Places
        if (input) {
            const url = 'https://places.googleapis.com/v1/places:autocomplete';
            
            const requestBody = {
                input: input,
                languageCode: 'fr',
                // Restriction stricte à la zone du Grand Périgueux (rectangle)
                locationRestriction: {
                    rectangle: {
                        low: {
                            latitude: 45.10,   // Sud
                            longitude: 0.55    // Ouest
                        },
                        high: {
                            latitude: 45.30,   // Nord
                            longitude: 0.90    // Est
                        }
                    }
                }
            };

            console.log('[places proxy] Autocomplete request (NEW API):', input);
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': apiKey,
                    'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text'
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();

            // Log pour debug
            console.log('[places proxy] Google response status:', response.status);
            if (data.error) {
                console.error('[places proxy] Google error:', data.error);
                res.status(response.status).json({ 
                    error: data.error.message || 'Google API error',
                    details: data.error
                });
                return;
            }

            if (!response.ok) {
                res.status(response.status).json(data);
                return;
            }

            // Transformer la réponse pour le frontend
            const predictions = (data.suggestions || [])
                .filter(s => s.placePrediction)
                .map(s => ({
                    description: s.placePrediction.text?.text || '',
                    placeId: s.placePrediction.placeId
                }));

            console.log('[places proxy] Returning', predictions.length, 'predictions');
            // Cache CDN court : 60s (suggestions = dynamiques mais souvent répétées)
            res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=30');
            res.status(200).json({ predictions });
            return;
        }

        // Mode 2: Place Details pour obtenir les coordonnées (NEW API)
        if (placeId) {
            // La nouvelle API Places attend le format "places/{placeId}"
            const placeName = placeId.startsWith('places/') ? placeId : `places/${placeId}`;
            const url = `https://places.googleapis.com/v1/${placeName}`;
            
            console.log('[places proxy] Place details request:', placeName);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'X-Goog-Api-Key': apiKey,
                    'X-Goog-FieldMask': 'location,formattedAddress'
                }
            });

            const data = await response.json();

            if (data.error) {
                console.error('[places proxy] Google error:', data.error);
                res.status(response.status).json({ 
                    error: data.error.message || 'Google API error',
                    details: data.error
                });
                return;
            }

            if (!response.ok) {
                res.status(response.status).json(data);
                return;
            }

            if (data.location) {
                // Cache CDN Vercel : 24h (coordonnées GPS = immuables)
                res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600');
                res.status(200).json({ 
                    lat: data.location.latitude, 
                    lng: data.location.longitude,
                    formattedAddress: data.formattedAddress || ''
                });
                return;
            }

            res.status(404).json({ error: 'Lieu non trouvé' });
            return;
        }

        res.status(400).json({ error: 'Paramètre input ou placeId requis.' });

    } catch (error) {
        console.error('[places proxy] Error:', error);
        res.status(502).json({ error: 'Places proxy error', details: error.message });
    }
}
