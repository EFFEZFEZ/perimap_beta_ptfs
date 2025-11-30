/**
 * apiManager.js - VERSION V48 (Alias Campus/Grenadière)
 * Gère tous les appels aux API externes (Google Places & Google Routes).
 *
 * *** MODIFICATION V48 (Alias Campus) ***
 * 1. Ajout d'un système d'alias pour fusionner des lieux équivalents.
 * 2. "Campus" et "Pôle Universitaire Grenadière" pointent vers le même lieu.
 *
 * *** MODIFICATION V47 (Fix FieldMask 400 Error) ***
 * 1. L'erreur 400 était causée par une demande de champ invalide
 * ('routes.legs.steps.duration') dans le FieldMask.
 * 2. Le 'X-Goog-FieldMask' dans les 3 fonctions a été simplifié.
 * 3. En demandant 'routes.legs.steps', nous recevons
 * implicitement tous les sous-champs dont nous avons besoin
 * (staticDuration, polyline, navigationInstruction, etc.)
 * sans causer d'erreur.
 *
 * *** MODIFICATION V57 (Géolocalisation) ***
 * 1. Ajout de la fonction `reverseGeocode` pour convertir lat/lng en place_id.
 * 2. Ajout de la bibliothèque 'geocoding' au chargement de l'API.
 * 3. Ajout de `this.geocoder` à `initServices`.
 *
 * *** CORRECTION (Race Condition) ***
 * 1. Ajout de `this.apiLoadPromise` pour s'assurer que `loadGoogleMapsAPI`
 * n'est exécuté qu'une seule fois, même s'il est appelé
 * plusieurs fois en parallèle au démarrage.
 */

export class ApiManager {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.sessionToken = null;

        // Zone du Grand Périgueux / Dordogne
        this.perigueuxBounds = {
            south: 45.10,  // Sud du Grand Périgueux
            west: 0.60,    // Ouest
            north: 45.30,  // Nord
            east: 0.85     // Est
        };
        
        this.perigueuxCenter = { lat: 45.184029, lng: 0.7211149 };

        // ✅ V57: Services Google Maps
        this.geocoder = null;
        this.autocompleteService = null;
        this.apiLoadPromise = null; // <-- CORRECTION: Ajout du verrou
        this.googleAuthFailed = false;
        this.googleAuthFailureMessage = '';
        this.clientOrigin = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
        
        // ✅ V49: Alias de lieux - Fusion d'arrêts équivalents (pôles multimodaux)
        // Quand l'utilisateur cherche un de ces termes, on lui propose le lieu canonique
        // ET le routeur considère TOUS les arrêts du pôle comme équivalents
        this.placeAliases = {
            // Campus universitaire de Périgueux - PÔLE MULTIMODAL
            // Regroupe l'arrêt "Campus" (K1A) et "Pôle Universitaire Grenadière" (K1B)
            'campus': {
                canonicalName: 'Campus Universitaire, Périgueux',
                aliases: ['campus', 'campus périgueux', 'fac', 'fac périgueux', 'université', 'université périgueux', 'iut', 'iut périgueux', 'grenadière', 'pole universitaire', 'pôle universitaire', 'la grenadière'],
                // Coordonnées centrales (entre les deux arrêts)
                coordinates: { lat: 45.1958, lng: 0.7192 },
                description: 'Campus universitaire (arrêts Campus + Pôle Grenadière)',
                // ✅ V49: Liste des arrêts GTFS qui desservent ce pôle
                gtfsStops: [
                    { stopId: 'MOBIITI:StopPlace:77309', name: 'Campus', lat: 45.197113, lng: 0.718130 },
                    { stopId: 'MOBIITI:StopPlace:77314', name: 'Pôle Universitaire Grenadière', lat: 45.194477, lng: 0.720215 }
                ],
                // Rayon de recherche autour du centre (en mètres)
                searchRadius: 400
            }
        };
    }

    /**
     * Initialise le chargeur de l'API Google Maps.
     */
    async loadGoogleMapsAPI() {
        if (this.googleAuthFailed) {
            return Promise.reject(new Error(this.buildAuthFailureMessage()));
        }

        // <-- CORRECTION: Vérifie si un chargement est déjà en cours
        if (this.apiLoadPromise) {
            return this.apiLoadPromise;
        }

        if (window.google?.maps) {
            await this.ensureGoogleLibraries();
            if (window.google.maps.places && window.google.maps.Geocoder) {
                console.log("✅ API Google Maps déjà chargée.");
                this.initServices();
                return Promise.resolve();
            }
        }

        this.installGoogleAuthHook();

        // <-- CORRECTION: Stocke la promesse pour la réutiliser
        this.apiLoadPromise = new Promise((resolve, reject) => {
            const authEventName = 'peribus-google-auth-failure';
            const handleAuthFailure = (event) => {
                window.removeEventListener(authEventName, handleAuthFailure);
                this.googleAuthFailed = true;
                this.googleAuthFailureMessage = this.buildAuthFailureMessage(event?.detail?.origin);
                console.error(this.googleAuthFailureMessage);
                this.apiLoadPromise = null;
                reject(new Error(this.googleAuthFailureMessage));
            };
            window.addEventListener(authEventName, handleAuthFailure, { once: true });

            const cleanupAuthHandler = () => window.removeEventListener(authEventName, handleAuthFailure);
            const script = document.createElement('script');
            
            // ✅ V57: Charge 'places' (pour Autocomplete) et 'geocoding' (pour Reverse Geocode)
            script.src = `https://maps.googleapis.com/maps/api/js?key=${this.apiKey}&libraries=places,geocoding&v=weekly&loading=async`;
            
            script.async = true;
            script.defer = true;
            script.setAttribute('data-google-maps', 'true');
            
            script.onload = () => {
                cleanupAuthHandler();
                console.log("✅ API Google Maps chargée avec succès.");
                setTimeout(async () => {
                    try {
                        await this.ensureGoogleLibraries();
                        // ✅ V57: Vérifie les deux bibliothèques
                        if (window.google?.maps?.places && window.google?.maps?.Geocoder) {
                            this.initServices();
                            resolve();
                        } else {
                            throw new Error("Bibliothèques places/geocoding non disponibles");
                        }
                    } catch (err) {
                        console.error("❌ google.maps.places ou google.maps.Geocoder n'est pas disponible");
                        this.apiLoadPromise = null;
                        reject(err);
                    }
                }, 100);
            };
            
            script.onerror = () => {
                cleanupAuthHandler();
                console.error("❌ Erreur lors du chargement du script Google Maps.");
                this.apiLoadPromise = null;
                reject(new Error("Impossible de charger Google Maps API."));
            };
            
            document.head.appendChild(script);
        });

        return this.apiLoadPromise;
    }

    /**
     * Initialise les services une fois l'API chargée.
     */
    initServices() {
        if (!window.google?.maps?.places || !window.google?.maps?.Geocoder) { // ✅ V57: Vérifie les deux
            console.error("❌ Les bibliothèques Google Maps 'places' ou 'geocoding' ne sont pas disponibles.");
            return;
        }
        
        try {
            // ✅ V57: Service de Geocoding
            this.geocoder = new google.maps.Geocoder();
            
            // Service d'Autocomplete
            if (google.maps.places.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
                console.log("✅ Nouvelle API AutocompleteSuggestion disponible.");
                // Pas besoin d'instancier, on utilise la méthode statique
            } else {
                console.warn("⚠️ AutocompleteSuggestion non disponible, fallback vers ancienne API");
                this.autocompleteService = new google.maps.places.AutocompleteService();
            }
            
            this.sessionToken = new google.maps.places.AutocompleteSessionToken();
            
        } catch (error) {
            console.error("❌ Erreur lors de l'initialisation des services:", error);
        }
    }

    /**
     * S'assure que les bibliothèques Google nécessaires sont prêtes
     */
    async ensureGoogleLibraries() {
        if (!window.google?.maps) {
            return;
        }

        const importLib = window.google.maps.importLibrary;
        if (typeof importLib !== 'function') {
            return;
        }

        // Charger la bibliothèque Places si nécessaire
        if (!window.google.maps.places) {
            try {
                const placesLib = await importLib('places');
                if (placesLib) {
                    window.google.maps.places = window.google.maps.places || {};
                    Object.assign(window.google.maps.places, placesLib);
                }
            } catch (error) {
                console.warn('⚠️ Impossible de charger la bibliothèque Places via importLibrary:', error);
            }
        }

        // Charger la bibliothèque Geocoding si nécessaire
        if (!window.google.maps.Geocoder) {
            try {
                const geocodingLib = await importLib('geocoding');
                if (geocodingLib?.Geocoder && !window.google.maps.Geocoder) {
                    window.google.maps.Geocoder = geocodingLib.Geocoder;
                }
            } catch (error) {
                console.warn('⚠️ Impossible de charger la bibliothèque Geocoding via importLibrary:', error);
            }
        }
    }

    /**
     * Récupère les suggestions d'autocomplétion avec la NOUVELLE API
     * Basé sur la documentation officielle Google :
     * https://developers.google.com/maps/documentation/javascript/place-autocomplete-data
     * 
     * ✅ V48: Intègre les alias de lieux (Campus = Pôle Universitaire Grenadière)
     */
    async getPlaceAutocomplete(inputString) {
        if (!this.sessionToken) {
            console.warn("⚠️ Service d'autocomplétion non initialisé. Tentative de chargement...");
            try {
                await this.loadGoogleMapsAPI();
            } catch (error) {
                console.error("❌ Impossible d'initialiser le service d'autocomplétion:", error.message);
                return [];
            }
            if (!this.sessionToken) {
                console.error("❌ Impossible d'initialiser le service d'autocomplétion");
                return [];
            }
        }

        // ✅ V48: Vérifier si l'entrée correspond à un alias
        const aliasMatch = this._checkPlaceAlias(inputString);
        
        try {
            let results = [];
            
            // Vérifier si la nouvelle API est disponible
            if (google.maps.places.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
                // ✅ NOUVELLE API (recommandée depuis mars 2025)
                const request = {
                    input: inputString,
                    locationRestriction: {
                        west: this.perigueuxBounds.west,
                        north: this.perigueuxBounds.north,
                        east: this.perigueuxBounds.east,
                        south: this.perigueuxBounds.south
                    },
                    region: "fr",
                    sessionToken: this.sessionToken,
                };

                console.log("🔍 Recherche autocomplétion (nouvelle API):", inputString);
                const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
                console.log(`✅ ${suggestions.length} suggestions trouvées`);
                
                results = suggestions.map(s => ({
                    description: s.placePrediction.text.text,
                    placeId: s.placePrediction.placeId,
                }));
            } else {
                // ❌ FALLBACK : Ancienne API (dépréciée mais fonctionnelle)
                console.warn("⚠️ Utilisation de l'ancienne API AutocompleteService (dépréciée)");
                
                results = await new Promise((resolve, reject) => {
                    const request = {
                        input: inputString,
                        sessionToken: this.sessionToken,
                        componentRestrictions: { country: 'fr' },
                        bounds: new google.maps.LatLngBounds(
                            new google.maps.LatLng(this.perigueuxBounds.south, this.perigueuxBounds.west),
                            new google.maps.LatLng(this.perigueuxBounds.north, this.perigueuxBounds.east)
                        ),
                        strictBounds: true,
                    };

                    this.autocompleteService.getPlacePredictions(request, (predictions, status) => {
                        if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
                            console.warn("⚠️ Échec de l'autocomplétion Places:", status);
                            resolve([]);
                        } else {
                            console.log(`✅ ${predictions.length} suggestions trouvées (ancienne API)`);
                            resolve(predictions.map(p => ({
                                description: p.description,
                                placeId: p.place_id,
                            })));
                        }
                    });
                });
            }
            
            // ✅ V48: Injecter l'alias en première position si trouvé
            if (aliasMatch) {
                // Vérifier si le résultat n'est pas déjà dans la liste
                const alreadyInList = results.some(r => 
                    r.description.toLowerCase().includes('grenadière') || 
                    r.description.toLowerCase().includes('universitaire')
                );
                
                if (!alreadyInList) {
                    results.unshift({
                        description: `🎓 ${aliasMatch.canonicalName}`,
                        placeId: `ALIAS_CAMPUS`, // Marqueur spécial
                        isAlias: true,
                        coordinates: aliasMatch.coordinates,
                        aliasDescription: aliasMatch.description
                    });
                    console.log(`🎓 Alias injecté: ${aliasMatch.canonicalName}`);
                }
            }
            
            return results;
        } catch (error) {
            console.error("❌ Erreur lors de l'autocomplétion:", error);
            
            // ✅ V48: Même en cas d'erreur, proposer l'alias si trouvé
            if (aliasMatch) {
                return [{
                    description: `🎓 ${aliasMatch.canonicalName}`,
                    placeId: `ALIAS_CAMPUS`,
                    isAlias: true,
                    coordinates: aliasMatch.coordinates,
                    aliasDescription: aliasMatch.description
                }];
            }
            
            return [];
        }
    }
    
    /**
     * ✅ V48: Vérifie si l'entrée correspond à un alias de lieu
     * @private
     */
    _checkPlaceAlias(inputString) {
        if (!inputString || inputString.length < 3) return null;
        
        const normalizedInput = inputString.toLowerCase().trim();
        
        for (const [key, aliasData] of Object.entries(this.placeAliases)) {
            // Vérifier si l'entrée correspond à un des alias
            const matchesAlias = aliasData.aliases.some(alias => {
                // Match exact ou partiel (l'alias commence par l'entrée)
                return alias.startsWith(normalizedInput) || normalizedInput.startsWith(alias);
            });
            
            if (matchesAlias) {
                console.log(`🎓 Alias trouvé: "${inputString}" → "${aliasData.canonicalName}"`);
                return aliasData;
            }
        }
        
        return null;
    }
    
    /**
     * ✅ V48: Résout un placeId d'alias en coordonnées
     * @param {string} placeId - Le placeId (peut être un alias comme ALIAS_CAMPUS)
     * @returns {Promise<{lat:number, lng:number}|null>}
     */
    async resolveAliasOrPlaceId(placeId) {
        // Vérifier si c'est un alias
        if (placeId && placeId.startsWith('ALIAS_')) {
            const aliasKey = placeId.replace('ALIAS_', '').toLowerCase();
            const aliasData = this.placeAliases[aliasKey];
            if (aliasData && aliasData.coordinates) {
                console.log(`🎓 Résolution alias: ${placeId} → ${JSON.stringify(aliasData.coordinates)}`);
                return aliasData.coordinates;
            }
        }
        
        // Sinon, utiliser le geocoder normal
        return this.getPlaceCoords(placeId);
    }

    /**
     * ✅ V57: NOUVELLE FONCTION
     * Convertit les coordonnées (lat, lng) en le place_id le plus proche.
     * @param {number} lat
     * @param {number} lng
     * @returns {Promise<string|null>} Le place_id ou null
     */
    async reverseGeocode(lat, lng) {
        if (!this.geocoder) {
            console.warn("⚠️ Service Geocoder non initialisé. Tentative de chargement...");
            try {
                await this.loadGoogleMapsAPI();
            } catch (error) {
                console.error("❌ Impossible d'initialiser le service Geocoder:", error.message);
                return null;
            }
            if (!this.geocoder) {
                console.error("❌ Impossible d'initialiser le service Geocoder");
                return null;
            }
        }

        return new Promise((resolve, reject) => {
            const latlng = { lat: lat, lng: lng };
            this.geocoder.geocode({ location: latlng }, (results, status) => {
                if (status === 'OK') {
                    if (results && results.length > 0) {
                        // On prend le premier résultat (le plus précis)
                        console.log(`✅ Géocodage inversé réussi: ${results[0].place_id}`);
                        resolve(results[0].place_id);
                    } else {
                        console.warn("Géocodage inversé: Aucun résultat trouvé.");
                        resolve(null);
                    }
                } else {
                    console.warn("Échec du géocodage inversé:", status);
                    reject(new Error(`Geocode failed with status: ${status}`));
                }
            });
        });
    }

    /**
     * Récupère les coordonnées {lat,lng} pour un place_id en utilisant le Geocoder
     * ✅ V49: Gère les alias avec pôles multimodaux (retourne aussi les arrêts GTFS)
     * @param {string} placeId
     * @returns {Promise<{lat:number, lng:number, gtfsStops?:Array, searchRadius?:number}|null>}
     */
    async getPlaceCoords(placeId) {
        // ✅ V49: Vérifier si c'est un alias avec pôle multimodal
        if (placeId && placeId.startsWith('ALIAS_')) {
            const aliasKey = placeId.replace('ALIAS_', '').toLowerCase();
            const aliasData = this.placeAliases[aliasKey];
            if (aliasData && aliasData.coordinates) {
                console.log(`🎓 Résolution alias coords: ${placeId} → ${JSON.stringify(aliasData.coordinates)}`);
                // Retourner les coordonnées ET les infos du pôle multimodal
                return {
                    lat: aliasData.coordinates.lat,
                    lng: aliasData.coordinates.lng,
                    gtfsStops: aliasData.gtfsStops || null,
                    searchRadius: aliasData.searchRadius || 300,
                    isMultiStop: Array.isArray(aliasData.gtfsStops) && aliasData.gtfsStops.length > 1
                };
            }
        }
        
        if (!this.geocoder) {
            console.warn("⚠️ Service Geocoder non initialisé. Tentative de chargement...");
            try {
                await this.loadGoogleMapsAPI();
            } catch (error) {
                console.error("❌ Impossible d'initialiser le service Geocoder:", error.message);
                return null;
            }
            if (!this.geocoder) {
                console.error("❌ Impossible d'initialiser le service Geocoder");
                return null;
            }
        }

        return new Promise((resolve, reject) => {
            this.geocoder.geocode({ placeId: placeId }, (results, status) => {
                if (status === 'OK' && results && results.length > 0) {
                    const loc = results[0].geometry && results[0].geometry.location;
                    if (loc && typeof loc.lat === 'function' && typeof loc.lng === 'function') {
                        resolve({ lat: loc.lat(), lng: loc.lng() });
                        return;
                    }
                    if (loc && loc.lat && loc.lng) {
                        resolve({ lat: loc.lat, lng: loc.lng });
                        return;
                    }
                }
                console.warn('getPlaceCoords: pas de résultat pour', placeId, status);
                resolve(null);
            });
        });
    }


    /**
     * ✨ NOUVELLE VERSION V39: Calcul intelligent d'itinéraire
     * ✅ V48: Gère les alias de lieux (ALIAS_CAMPUS, etc.)
     */
    async fetchItinerary(fromPlaceId, toPlaceId, searchTime = null) {
        console.log(`🧠 CALCUL INTELLIGENT: ${fromPlaceId} → ${toPlaceId}`);
        
        // ✅ V48: Convertir les alias en coordonnées
        const fromIsAlias = fromPlaceId && fromPlaceId.startsWith('ALIAS_');
        const toIsAlias = toPlaceId && toPlaceId.startsWith('ALIAS_');
        
        let fromCoords = null;
        let toCoords = null;
        
        if (fromIsAlias) {
            fromCoords = await this.getPlaceCoords(fromPlaceId);
            console.log(`🎓 Origine alias résolu: ${JSON.stringify(fromCoords)}`);
        }
        if (toIsAlias) {
            toCoords = await this.getPlaceCoords(toPlaceId);
            console.log(`🎓 Destination alias résolu: ${JSON.stringify(toCoords)}`);
        }

        const results = {
            bus: null,
            bike: null,
            walk: null,
            recommendations: []
        };

        // ========================================
        // 1️⃣ ESSAYER LE BUS D'ABORD
        // ========================================
        try {
            const busData = await this._fetchBusRoute(fromPlaceId, toPlaceId, searchTime, fromCoords, toCoords);
            
            if (busData?.routes?.length > 0) {
                const bestRoute = busData.routes[0];
                
                // Extraire la durée
                const durationSeconds = parseInt(bestRoute.duration?.replace('s', '')) || 0;
                const durationMinutes = Math.round(durationSeconds / 60);
                
                // Compter les correspondances (nombre de segments TRANSIT - 1)
                const transitSteps = bestRoute.legs?.[0]?.steps?.filter(s => s.travelMode === 'TRANSIT') || [];
                const transferCount = Math.max(0, transitSteps.length - 1);
                
                results.bus = {
                    data: busData,
                    duration: durationMinutes,
                    transfers: transferCount
                };
                
                console.log(`🚍 Bus trouvé: ${durationMinutes}min, ${transferCount} correspondance(s)`);
                
                // ⚠️ SCORING DU BUS
                if (durationMinutes > 90 || transferCount > 2) {
                    // BUS ABSURDE (trop long ou trop complexe)
                    results.recommendations.push({
                        mode: 'bus',
                        score: 20,
                        reason: `${durationMinutes}min avec ${transferCount} corresp. - trop complexe !`
                    });
                } else if (durationMinutes > 60) {
                    // BUS MOYEN
                    results.recommendations.push({
                        mode: 'bus',
                        score: 50,
                        reason: `${durationMinutes}min - un peu long`
                    });
                } else if (durationMinutes > 30) {
                    // BUS CORRECT
                    results.recommendations.push({
                        mode: 'bus',
                        score: 75,
                        reason: `${durationMinutes}min - correct`
                    });
                } else {
                    // BON BUS !
                    results.recommendations.push({
                        mode: 'bus',
                        score: 100,
                        reason: `${durationMinutes}min - rapide et pratique !`
                    });
                }
            }
        } catch (error) {
            console.warn("⚠️ Pas de bus disponible:", error.message);
            results.recommendations.push({
                mode: 'bus',
                score: 0,
                reason: 'Aucun bus disponible (dimanche ou horaires inadaptés)'
            });
        }

        // ========================================
        // 2️⃣ CALCULER VÉLO EN PARALLÈLE
        // ========================================
        try {
            const bikeData = await this.fetchBicycleRoute(fromPlaceId, toPlaceId, fromCoords, toCoords);
            
            if (bikeData?.routes?.length > 0) {
                const route = bikeData.routes[0];
                const durationSeconds = parseInt(route.duration?.replace('s', '')) || 0;
                const durationMinutes = Math.round(durationSeconds / 60);
                const distanceKm = (route.distanceMeters / 1000).toFixed(1);
                
                results.bike = {
                    data: bikeData,
                    duration: durationMinutes,
                    distance: distanceKm
                };
                
                console.log(`🚴 Vélo: ${durationMinutes}min, ${distanceKm}km`);
                
                // SCORING VÉLO
                let score = 80;
                let reason = `${durationMinutes}min (${distanceKm}km)`;
                
                if (durationMinutes < 15) {
                    score = 100;
                    reason += ' - parfait !';
                } else if (durationMinutes < 30) {
                    score = 90;
                    reason += ' - rapide et écolo';
                } else if (durationMinutes < 45) {
                    score = 70;
                    reason += ' - acceptable';
                } else {
                    score = 40;
                    reason += ' - un peu sportif';
                }
                
                results.recommendations.push({
                    mode: 'bike',
                    score: score,
                    reason: reason
                });
            }
        } catch (error) {
            console.error("❌ Erreur calcul vélo:", error);
        }

        // ========================================
        // 3️⃣ CALCULER MARCHE
        // ========================================
        try {
            const walkData = await this.fetchWalkingRoute(fromPlaceId, toPlaceId, fromCoords, toCoords);
            
            if (walkData?.routes?.length > 0) {
                const route = walkData.routes[0];
                const durationSeconds = parseInt(route.duration?.replace('s', '')) || 0;
                const durationMinutes = Math.round(durationSeconds / 60);
                const distanceKm = (route.distanceMeters / 1000).toFixed(1);
                
                results.walk = {
                    data: walkData,
                    duration: durationMinutes,
                    distance: distanceKm
                };
                
                console.log(`🚶 Marche: ${durationMinutes}min, ${distanceKm}km`);
                
                // SCORING MARCHE
                let score = 60;
                let reason = `${durationMinutes}min (${distanceKm}km)`;
                
                if (durationMinutes < 10) {
                    score = 95;
                    reason += ' - tout proche !';
                } else if (durationMinutes < 20) {
                    score = 85;
                    reason += ' - très accessible';
                } else if (durationMinutes < 30) {
                    score = 65;
                    reason += ' - bonne marche';
                } else if (durationMinutes < 45) {
                    score = 40;
                    reason += ' - longue marche';
                } else {
                    score = 20;
                    reason += ' - trop loin à pied';
                }
                
                results.recommendations.push({
                    mode: 'walk',
                    score: score,
                    reason: reason
                });
            }
        } catch (error) {
            console.error("❌ Erreur calcul marche:", error);
        }

        // ========================================
        // 4️⃣ TRIER PAR SCORE ET RETOURNER
        // ========================================
        results.recommendations.sort((a, b) => b.score - a.score);
        
        console.log("🏆 RECOMMANDATIONS TRIÉES:");
        results.recommendations.forEach((rec, i) => {
            const emoji = rec.mode === 'bus' ? '🚍' : rec.mode === 'bike' ? '🚴' : '🚶';
            console.log(`  ${i+1}. ${emoji} ${rec.mode.toUpperCase()} (score: ${rec.score}/100) - ${rec.reason}`);
        });
        
        // Régénérer le token de session
        if (window.google?.maps?.places) {
            this.sessionToken = new google.maps.places.AutocompleteSessionToken();
        }

        return results;
    }

    /**
     * Méthode privée pour calculer uniquement le bus
     * ✅ V48: Gère les alias via coordonnées
     * @private
     */
    async _fetchBusRoute(fromPlaceId, toPlaceId, searchTime = null, fromCoords = null, toCoords = null) {
        const API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

        // ✅ V48: Utiliser les coordonnées pour les alias, sinon placeId
        const origin = fromCoords 
            ? { location: { latLng: { latitude: fromCoords.lat, longitude: fromCoords.lng } } }
            : { placeId: fromPlaceId };
        const destination = toCoords
            ? { location: { latLng: { latitude: toCoords.lat, longitude: toCoords.lng } } }
            : { placeId: toPlaceId };

        const body = {
            origin,
            destination,
            travelMode: "TRANSIT",
            computeAlternativeRoutes: true,
            transitPreferences: {
                allowedTravelModes: ["BUS"],
                routingPreference: "LESS_WALKING"
            },
            languageCode: "fr",
            units: "METRIC"
        };

        // Ajout du temps de départ/arrivée
        if (searchTime) {
            const dateTime = this._buildDateTime(searchTime);
            if (searchTime.type === 'arriver') {
                body.arrivalTime = dateTime;
            } else {
                body.departureTime = dateTime;
            }
        }

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': this.apiKey,
                // ✅ CORRECTION V47: Masque simplifié et valide
                'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline,routes.legs.steps'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ Erreur API Routes (bus):", errorText);
            
            if (response.status === 404 || errorText.includes("NOT_FOUND")) {
                throw new Error("Aucun bus disponible");
            }
            throw new Error(`Erreur API Routes: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.routes || data.routes.length === 0) {
            throw new Error("Aucun itinéraire en bus trouvé");
        }

        console.log(`✅ ${data.routes.length} itinéraire(s) bus trouvé(s)`);
        return data;
    }

    /**
     * Construit un objet DateTime ISO 8601 pour l'API Google Routes
     * @private
     */
    _buildDateTime(searchTime) {
        const { date, hour, minute } = searchTime;
        
        let dateObj;
        if (!date || date === 'today' || date === "Aujourd'hui") {
            dateObj = new Date();
        } else {
            dateObj = new Date(date);
        }
        
        if (isNaN(dateObj.getTime())) {
            console.warn("⚠️ Date invalide, utilisation de la date actuelle");
            dateObj = new Date();
        }
        
        const hourInt = parseInt(hour) || 0;
        const minuteInt = parseInt(minute) || 0;
        dateObj.setHours(hourInt, minuteInt, 0, 0);
        
        console.log("🕒 DateTime construit:", dateObj.toISOString());
        return dateObj.toISOString();
    }

    /**
     * Calcule un itinéraire à vélo
     * ✅ V48: Gère les alias via coordonnées
     */
    async fetchBicycleRoute(fromPlaceId, toPlaceId, fromCoords = null, toCoords = null) {
        console.log(`🚴 API Google Routes (VÉLO): ${fromPlaceId} → ${toPlaceId}`);

        const API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

        // ✅ V48: Utiliser les coordonnées pour les alias, sinon placeId
        const origin = fromCoords 
            ? { location: { latLng: { latitude: fromCoords.lat, longitude: fromCoords.lng } } }
            : { placeId: fromPlaceId };
        const destination = toCoords
            ? { location: { latLng: { latitude: toCoords.lat, longitude: toCoords.lng } } }
            : { placeId: toPlaceId };

        const body = {
            origin,
            destination,
            travelMode: "BICYCLE",
            languageCode: "fr",
            units: "METRIC"
        };

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': this.apiKey,
                // ✅ CORRECTION V4T: Masque simplifié et valide
                'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline,routes.legs.steps'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ Erreur API Routes (vélo):", errorText);
            throw new Error(`Erreur vélo: ${response.status}`);
        }

        const data = await response.json();
        console.log("✅ Itinéraire vélo calculé");
        return data;
    }
    
    /**
     * Calcule un itinéraire à pied
     * ✅ V48: Gère les alias via coordonnées
     */
    async fetchWalkingRoute(fromPlaceId, toPlaceId, fromCoords = null, toCoords = null) {
        console.log(`🚶 API Google Routes (MARCHE): ${fromPlaceId} → ${toPlaceId}`);

        const API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

        // ✅ V48: Utiliser les coordonnées pour les alias, sinon placeId
        const origin = fromCoords 
            ? { location: { latLng: { latitude: fromCoords.lat, longitude: fromCoords.lng } } }
            : { placeId: fromPlaceId };
        const destination = toCoords
            ? { location: { latLng: { latitude: toCoords.lat, longitude: toCoords.lng } } }
            : { placeId: toPlaceId };

        const body = {
            origin,
            destination,
            travelMode: "WALK",
            languageCode: "fr",
            units: "METRIC"
        };

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': this.apiKey,
                // ✅ CORRECTION V47: Masque simplifié et valide
                'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline,routes.legs.steps'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ Erreur API Routes (marche):", errorText);
            throw new Error(`Erreur marche: ${response.status}`);
        }

        const data = await response.json();
        console.log("✅ Itinéraire marche calculé");
        return data;
    }

    // Compatibilité ascendante (ancienne signature)
    async fetchWalkRoute(fromPlaceId, toPlaceId) {
        return this.fetchWalkingRoute(fromPlaceId, toPlaceId);
    }

    installGoogleAuthHook() {
        if (typeof window === 'undefined') {
            return;
        }
        if (window.__peribusGoogleAuthHookInstalled) {
            return;
        }
        window.__peribusGoogleAuthHookInstalled = true;
        const previousHandler = window.gm_authFailure;
        window.gm_authFailure = () => {
            try {
                window.dispatchEvent(new CustomEvent('peribus-google-auth-failure', {
                    detail: { origin: window.location?.origin }
                }));
            } catch (error) {
                console.warn('gm_authFailure dispatch error', error);
            }
            if (typeof previousHandler === 'function') {
                try {
                    previousHandler();
                } catch (error) {
                    console.warn('gm_authFailure previous handler failed', error);
                }
            }
        };
    }

    buildAuthFailureMessage(origin = this.clientOrigin) {
        const target = origin || this.clientOrigin || 'ce domaine';
        return `Google Maps API a refusé le referer ${target}. Ajoutez cette URL dans les restrictions HTTP de votre clé Google Cloud.`;
    }
}
