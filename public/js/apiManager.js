/**
 * apiManager.js - VERSION V181 (Proxy complet - Autocomplétion + Géocodage)
 * Gère tous les appels aux API externes (Google Places & Google Routes).
 *
 * ✅ V181: PROXY COMPLET - Tout passe par les proxies Vercel en production
 * - /api/routes : Google Routes API (itinéraires bus/vélo/marche)
 * - /api/places : Google Places API (autocomplétion + geocoding placeId→coords)
 * - /api/geocode : Google Geocoding API (reverse geocode lat/lng→placeId)
 * 
 * Le SDK Google Maps JavaScript n'est PAS chargé en mode proxy.
 *
 * *** MODIFICATION V48 (Alias Campus/Grenadière) ***
 * 1. Ajout d'un système d'alias pour fusionner des lieux équivalents.
 * 2. "Campus" et "Pôle Universitaire Grenadière" pointent vers le même lieu.
 *
 * *** MODIFICATION V57 (Géolocalisation) ***
 * 1. Ajout de la fonction `reverseGeocode` pour convertir lat/lng en place_id.
 */

import { getAppConfig, API_ENDPOINTS } from './config.js';

export class ApiManager {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.sessionToken = null;
        
        // ✅ V178: Configuration proxy
        const config = getAppConfig();
        this.useProxy = config.useProxy;
        this.apiEndpoints = config.apiEndpoints || API_ENDPOINTS;

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
        this.proxyReady = false; // ✅ V181: Flag pour mode proxy
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
     * ✅ V181: En mode proxy, on n'a PAS besoin du SDK Google Maps côté client
     * L'autocomplétion et le géocodage passent par les proxies Vercel
     */
    async loadGoogleMapsAPI() {
        // ✅ V181: En mode proxy, ne pas charger le SDK Google Maps
        // On utilise les endpoints /api/places et /api/geocode
        if (this.useProxy) {
            console.log("✅ Mode proxy activé - SDK Google Maps non requis");
            this.proxyReady = true;
            return Promise.resolve();
        }

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
     * Récupère les suggestions d'autocomplétion
     * ✅ V181: Utilise le proxy Vercel /api/places en production
     * ✅ V48: Intègre les alias de lieux (Campus = Pôle Universitaire Grenadière)
     */
    async getPlaceAutocomplete(inputString) {
        // ✅ V48: Vérifier si l'entrée correspond à un alias
        const aliasMatch = this._checkPlaceAlias(inputString);
        
        try {
            let results = [];
            
            // ✅ V181: Mode proxy - utiliser l'endpoint Vercel
            if (this.useProxy) {
                console.log("🔍 Recherche autocomplétion (proxy):", inputString);
                
                const url = new URL(this.apiEndpoints.places, window.location.origin);
                url.searchParams.set('input', inputString);
                
                const response = await fetch(url.toString());
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `Erreur proxy: ${response.status}`);
                }
                
                const data = await response.json();
                results = (data.predictions || []).map(p => ({
                    description: p.description,
                    placeId: p.placeId
                }));
                
                console.log(`✅ ${results.length} suggestions trouvées (proxy)`);
            } 
            // Mode SDK Google Maps (dev local avec clé API)
            else {
                if (!this.sessionToken) {
                    console.warn("⚠️ Service d'autocomplétion non initialisé. Tentative de chargement...");
                    try {
                        await this.loadGoogleMapsAPI();
                    } catch (error) {
                        console.error("❌ Impossible d'initialiser le service d'autocomplétion:", error.message);
                        return aliasMatch ? [this._createAliasResult(aliasMatch)] : [];
                    }
                    if (!this.sessionToken) {
                        console.error("❌ Impossible d'initialiser le service d'autocomplétion");
                        return aliasMatch ? [this._createAliasResult(aliasMatch)] : [];
                    }
                }
                
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

                    console.log("🔍 Recherche autocomplétion (SDK):", inputString);
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
            }
            
            // ✅ V48: Injecter l'alias en première position si trouvé
            if (aliasMatch) {
                // Vérifier si le résultat n'est pas déjà dans la liste
                const alreadyInList = results.some(r => 
                    r.description.toLowerCase().includes('grenadière') || 
                    r.description.toLowerCase().includes('universitaire')
                );
                
                if (!alreadyInList) {
                    results.unshift(this._createAliasResult(aliasMatch));
                    console.log(`🎓 Alias injecté: ${aliasMatch.canonicalName}`);
                }
            }
            
            return results;
        } catch (error) {
            console.error("❌ Erreur lors de l'autocomplétion:", error);
            
            // ✅ V48: Même en cas d'erreur, proposer l'alias si trouvé
            if (aliasMatch) {
                return [this._createAliasResult(aliasMatch)];
            }
            
            return [];
        }
    }
    
    /**
     * ✅ V181: Helper pour créer un résultat d'alias
     * @private
     */
    _createAliasResult(aliasMatch) {
        return {
            description: `🎓 ${aliasMatch.canonicalName}`,
            placeId: `ALIAS_CAMPUS`,
            isAlias: true,
            coordinates: aliasMatch.coordinates,
            aliasDescription: aliasMatch.description
        };
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
     * ✅ V57: Convertit les coordonnées (lat, lng) en le place_id le plus proche.
     * ✅ V181: Utilise le proxy Vercel /api/geocode en production
     * @param {number} lat
     * @param {number} lng
     * @returns {Promise<string|null>} Le place_id ou null
     */
    async reverseGeocode(lat, lng) {
        // ✅ V181: Mode proxy - utiliser l'endpoint Vercel
        if (this.useProxy) {
            try {
                const url = new URL(this.apiEndpoints.geocode, window.location.origin);
                url.searchParams.set('lat', lat);
                url.searchParams.set('lng', lng);
                
                const response = await fetch(url.toString());
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `Erreur geocode proxy: ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data.results && data.results.length > 0) {
                    const placeId = data.results[0].place_id;
                    console.log(`✅ Géocodage inversé réussi (proxy): ${placeId}`);
                    return placeId;
                }
                
                console.warn("Géocodage inversé: Aucun résultat trouvé.");
                return null;
            } catch (error) {
                console.error("❌ Erreur géocodage inversé (proxy):", error);
                return null;
            }
        }
        
        // Mode SDK Google Maps (dev local)
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
     * ✅ V181: Utilise le proxy Vercel /api/places?placeId=... en production
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
        
        // ✅ V181: Mode proxy - utiliser l'endpoint Vercel
        if (this.useProxy) {
            try {
                const url = new URL(this.apiEndpoints.places, window.location.origin);
                url.searchParams.set('placeId', placeId);
                
                const response = await fetch(url.toString());
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    console.warn('getPlaceCoords (proxy): erreur', errorData.error || response.status);
                    return null;
                }
                
                const data = await response.json();
                
                if (data.lat && data.lng) {
                    console.log(`✅ Coordonnées obtenues (proxy): ${placeId} → ${data.lat}, ${data.lng}`);
                    return { lat: data.lat, lng: data.lng };
                }
                
                console.warn('getPlaceCoords (proxy): pas de coordonnées pour', placeId);
                return null;
            } catch (error) {
                console.error('getPlaceCoords (proxy): erreur', error);
                return null;
            }
        }
        
        // Mode SDK Google Maps (dev local)
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
     * V188: MÉTHODE SNCF CONNECT
     * - 2 appels API (maintenant + 20min) pour avoir ~5 horaires consécutifs
     * - Cache les résultats pour "Voir plus"
     * - Dédoublonne et trie par heure de départ
     */
    async fetchItinerary(fromPlaceId, toPlaceId, searchTime = null) {
        const startTime = performance.now();
        console.log(`🧠 V188 RECHERCHE ITINÉRAIRE: ${fromPlaceId} → ${toPlaceId}`);
        if (searchTime) {
            console.log(`⏰ Mode: ${searchTime.type || 'partir'}, Heure: ${searchTime.hour}:${searchTime.minute}`);
        }
        
        // Convertir les alias en coordonnées
        const fromIsAlias = fromPlaceId && fromPlaceId.startsWith('ALIAS_');
        const toIsAlias = toPlaceId && toPlaceId.startsWith('ALIAS_');
        
        let fromCoords = null;
        let toCoords = null;
        
        const aliasPromises = [];
        if (fromIsAlias) aliasPromises.push(this.getPlaceCoords(fromPlaceId).then(c => { fromCoords = c; }));
        if (toIsAlias) aliasPromises.push(this.getPlaceCoords(toPlaceId).then(c => { toCoords = c; }));
        if (aliasPromises.length) await Promise.all(aliasPromises);

        const results = {
            bus: null,
            bike: null,
            walk: null,
            recommendations: []
        };

        // ========================================
        // V197: 4 APPELS DÉCALÉS = ~8-10 HORAIRES
        // Pour compenser les trajets TER/322 rejetés
        // V202: Adaptation selon le mode (partir/arriver)
        // ========================================
        
        let searchTimes;
        if (searchTime && searchTime.type === 'arriver') {
            // Pour "Arriver à", on cherche dans le PASSÉ pour avoir des options plus tôt
            // Ex: Arriver à 10h -> on cherche aussi arriver à 9h45, 9h30, 9h10
            searchTimes = [
                searchTime,                              // T-0 min
                this._offsetSearchTime(searchTime, -15), // T-15 min
                this._offsetSearchTime(searchTime, -30), // T-30 min
                this._offsetSearchTime(searchTime, -50), // T-50 min
            ];
        } else {
            // Pour "Partir à", on cherche dans le FUTUR
            searchTimes = [
                searchTime,                              // T+0 min
                this._offsetSearchTime(searchTime, 15), // T+15 min
                this._offsetSearchTime(searchTime, 30), // T+30 min
                this._offsetSearchTime(searchTime, 50), // T+50 min
            ];
        }
        
        const [busResults, bikeResult, walkResult] = await Promise.allSettled([
            // 4 appels bus en parallèle
            Promise.allSettled(searchTimes.map(st => this._fetchBusRoute(fromPlaceId, toPlaceId, st, fromCoords, toCoords))),
            this.fetchBicycleRoute(fromPlaceId, toPlaceId, fromCoords, toCoords),
            this.fetchWalkingRoute(fromPlaceId, toPlaceId, fromCoords, toCoords)
        ]);

        // 1️⃣ Traitement BUS - Fusionner et dédupliquer
        if (busResults.status === 'fulfilled') {
            const allBusRoutes = [];
            const seenDepartures = new Set();
            
            for (const result of busResults.value) {
                if (result.status === 'fulfilled' && result.value?.routes?.length > 0) {
                    for (const route of result.value.routes) {
                        // Clé unique = heure départ + ligne (pour éviter doublons)
                        const depTime = route.legs?.[0]?.localizedValues?.departureTime?.time?.text || '';
                        const transitStep = route.legs?.[0]?.steps?.find(s => s.travelMode === 'TRANSIT');
                        const lineName = transitStep?.transitDetails?.transitLine?.name || '';
                        const uniqueKey = `${depTime}-${lineName}`;
                        
                        if (!seenDepartures.has(uniqueKey)) {
                            seenDepartures.add(uniqueKey);
                            allBusRoutes.push(route);
                        }
                    }
                }
            }
            
            if (allBusRoutes.length > 0) {
                // Trier par heure de départ (format HH:MM)
                allBusRoutes.sort((a, b) => {
                    const depA = a.legs?.[0]?.localizedValues?.departureTime?.time?.text || '99:99';
                    const depB = b.legs?.[0]?.localizedValues?.departureTime?.time?.text || '99:99';
                    return depA.localeCompare(depB);
                });
                
                // V198: Nettoyage - On renvoie TOUT sans pagination ni cache
                // Le filtrage final se fera dans main.js
                const busData = { routes: allBusRoutes, hasMore: false };
                
                // Calculs pour le "meilleur" trajet (pour le score)
                const bestRoute = allBusRoutes[0];
                const durationSeconds = parseInt(bestRoute.duration?.replace('s', '')) || 0;
                const durationMinutes = Math.round(durationSeconds / 60);
                const transitSteps = bestRoute.legs?.[0]?.steps?.filter(s => s.travelMode === 'TRANSIT') || [];
                const transferCount = Math.max(0, transitSteps.length - 1);
                
                results.bus = { data: busData, duration: durationMinutes, transfers: transferCount };
                console.log(`🚍 V198: ${allBusRoutes.length} trajets trouvés (tous renvoyés)`);
                
                // Log des heures pour vérification
                const heures = allBusRoutes.map(r => r.legs?.[0]?.localizedValues?.departureTime?.time?.text).join(', ');
                console.log(`📋 Horaires: ${heures}`);
                
                // Score simplifié
                results.recommendations.push({
                    mode: 'bus', score: 100, // Bus toujours prioritaire
                    reason: `${durationMinutes}min${transferCount ? ` (${transferCount} corresp.)` : ''}`
                });
            } else {
                console.warn("⚠️ Pas de bus disponible");
                results.recommendations.push({ mode: 'bus', score: 0, reason: 'Aucun bus disponible' });
            }
        } else {
            console.warn("⚠️ Erreur appels bus");
            results.recommendations.push({ mode: 'bus', score: 0, reason: 'Erreur recherche bus' });
        }

        // 2️⃣ Traitement VÉLO
        if (bikeResult.status === 'fulfilled' && bikeResult.value?.routes?.length > 0) {
            const route = bikeResult.value.routes[0];
            const durationMinutes = Math.round((parseInt(route.duration?.replace('s', '')) || 0) / 60);
            const distanceKm = (route.distanceMeters / 1000).toFixed(1);
            
            results.bike = { data: bikeResult.value, duration: durationMinutes, distance: distanceKm };
            console.log(`🚴 Vélo: ${durationMinutes}min, ${distanceKm}km`);
            
            let score = durationMinutes < 15 ? 100 : durationMinutes < 30 ? 90 : durationMinutes < 45 ? 70 : 40;
            results.recommendations.push({
                mode: 'bike', score,
                reason: `${durationMinutes}min (${distanceKm}km)`
            });
        }

        // 3️⃣ Traitement MARCHE
        if (walkResult.status === 'fulfilled' && walkResult.value?.routes?.length > 0) {
            const route = walkResult.value.routes[0];
            const durationMinutes = Math.round((parseInt(route.duration?.replace('s', '')) || 0) / 60);
            const distanceKm = (route.distanceMeters / 1000).toFixed(1);
            
            results.walk = { data: walkResult.value, duration: durationMinutes, distance: distanceKm };
            console.log(`🚶 Marche: ${durationMinutes}min, ${distanceKm}km`);
            
            let score = durationMinutes < 10 ? 95 : durationMinutes < 20 ? 85 : durationMinutes < 30 ? 65 : durationMinutes < 45 ? 40 : 20;
            results.recommendations.push({
                mode: 'walk', score,
                reason: `${durationMinutes}min (${distanceKm}km)`
            });
        }

        // 4️⃣ TRIER PAR SCORE ET RETOURNER
        results.recommendations.sort((a, b) => b.score - a.score);
        
        const elapsed = Math.round(performance.now() - startTime);
        console.log(`⚡ Calcul terminé en ${elapsed}ms`);

        // Régénérer le token de session
        if (window.google?.maps?.places) {
            this.sessionToken = new google.maps.places.AutocompleteSessionToken();
        }

        return results;
    }

    /**
     * V187: Décale un searchTime de X minutes
     * @private
     */
    _offsetSearchTime(baseSearchTime, offsetMinutes) {
        if (!baseSearchTime) {
            const now = new Date();
            now.setMinutes(now.getMinutes() + offsetMinutes);
            return {
                type: 'partir',
                hour: now.getHours().toString().padStart(2, '0'),
                minute: now.getMinutes().toString().padStart(2, '0')
            };
        }
        
        // V203: Gestion complète de la date et du passage de minuit
        // On convertit tout en objet Date pour gérer correctement les changements de jour
        let dateObj;
        if (!baseSearchTime.date || baseSearchTime.date === 'today' || baseSearchTime.date === "Aujourd'hui") {
            dateObj = new Date();
        } else {
            dateObj = new Date(baseSearchTime.date);
        }
        
        // Définir l'heure de base
        dateObj.setHours(parseInt(baseSearchTime.hour) || 0);
        dateObj.setMinutes(parseInt(baseSearchTime.minute) || 0);
        dateObj.setSeconds(0);
        
        // Ajouter le décalage
        dateObj.setMinutes(dateObj.getMinutes() + offsetMinutes);
        
        // Reconstruire le searchTime avec la NOUVELLE date et heure
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        const newDateStr = `${year}-${month}-${day}`;
        
        return {
            ...baseSearchTime,
            date: newDateStr, // Date mise à jour (peut avoir changé de jour)
            hour: dateObj.getHours().toString().padStart(2, '0'),
            minute: dateObj.getMinutes().toString().padStart(2, '0')
        };
    }

    /**
     * Méthode privée pour calculer uniquement le bus
     * ✅ V178: Utilise le proxy Vercel pour masquer la clé API
     * ✅ V48: Gère les alias via coordonnées
     * @private
     */
    async _fetchBusRoute(fromPlaceId, toPlaceId, searchTime = null, fromCoords = null, toCoords = null) {
        // ✅ V178: Utiliser le proxy Vercel
        const API_URL = this.useProxy 
            ? `${this.apiEndpoints.routes}?action=directions`
            : 'https://routes.googleapis.com/directions/v2:computeRoutes';

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
            computeAlternativeRoutes: true,  // Demander plusieurs alternatives
            transitPreferences: {
                allowedTravelModes: ["BUS"],  // Uniquement bus (pas train, métro, tram)
                routingPreference: "FEWER_TRANSFERS"  // V63: Prioriser moins de correspondances
            },
            languageCode: "fr",
            units: "METRIC"
            // Note: requestedReferenceRoutes n'est PAS supporté pour TRANSIT
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

        // ✅ V178: Headers différents selon mode proxy ou direct
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (!this.useProxy) {
            headers['X-Goog-Api-Key'] = this.apiKey;
            headers['X-Goog-FieldMask'] = 'routes.duration,routes.distanceMeters,routes.polyline,routes.legs.steps';
        }

        const response = await fetch(API_URL, {
            method: 'POST',
            headers,
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
     * V142: Correction fuseau horaire - on envoie l'heure LOCALE avec offset timezone
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
        
        // V142: Construire ISO string avec offset timezone local au lieu de UTC
        // Cela évite que 13:20 local devienne 12:20 UTC
        const tzOffset = -dateObj.getTimezoneOffset();
        const sign = tzOffset >= 0 ? '+' : '-';
        const offsetHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
        const offsetMinutes = String(Math.abs(tzOffset) % 60).padStart(2, '0');
        
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        const hours = String(dateObj.getHours()).padStart(2, '0');
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        const seconds = String(dateObj.getSeconds()).padStart(2, '0');
        
        const isoWithTz = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMinutes}`;
        
        console.log("🕒 DateTime construit (local):", isoWithTz);
        return isoWithTz;
    }

    /**
     * Calcule un itinéraire à vélo
     * ✅ V178: Utilise le proxy Vercel pour masquer la clé API
     * ✅ V48: Gère les alias via coordonnées
     */
    async fetchBicycleRoute(fromPlaceId, toPlaceId, fromCoords = null, toCoords = null) {
        console.log(`🚴 API Google Routes (VÉLO): ${fromPlaceId} → ${toPlaceId}`);

        // ✅ V178: Utiliser le proxy Vercel
        const API_URL = this.useProxy 
            ? `${this.apiEndpoints.routes}?action=bicycle`
            : 'https://routes.googleapis.com/directions/v2:computeRoutes';

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

        // ✅ V178: Headers différents selon mode proxy ou direct
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (!this.useProxy) {
            headers['X-Goog-Api-Key'] = this.apiKey;
            headers['X-Goog-FieldMask'] = 'routes.duration,routes.distanceMeters,routes.polyline,routes.legs.steps';
        }

        const response = await fetch(API_URL, {
            method: 'POST',
            headers,
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
     * ✅ V178: Utilise le proxy Vercel pour masquer la clé API
     * ✅ V48: Gère les alias via coordonnées
     */
    async fetchWalkingRoute(fromPlaceId, toPlaceId, fromCoords = null, toCoords = null) {
        console.log(`🚶 API Google Routes (MARCHE): ${fromPlaceId} → ${toPlaceId}`);

        // ✅ V178: Utiliser le proxy Vercel
        const API_URL = this.useProxy 
            ? `${this.apiEndpoints.routes}?action=walking`
            : 'https://routes.googleapis.com/directions/v2:computeRoutes';

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

        // ✅ V178: Headers différents selon mode proxy ou direct
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (!this.useProxy) {
            headers['X-Goog-Api-Key'] = this.apiKey;
            headers['X-Goog-FieldMask'] = 'routes.duration,routes.distanceMeters,routes.polyline,routes.legs.steps';
        }

        const response = await fetch(API_URL, {
            method: 'POST',
            headers,
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
