/**
 * localRouter.js
 * Moteur de recherche d'itinéraire 100% local (Client-Side).
 * Remplace l'API Google Routes pour les trajets BUS + MARCHE.
 */
export class LocalRouter {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.connections = []; // Liste plate des segments (Départ -> Arrivée)
    }

    /**
     * 1. CONSTRUCTION DU GRAPHE (Optimisé pour la date choisie)
     * Ne garde que les bus qui roulent ce jour-là.
     */
    buildGraphForDate(dateObj) {
        this.connections = [];
        
        // Récupérer les service_ids actifs pour cette date (utilise ta logique existante)
        const activeServices = this.dataManager.getServiceIds(dateObj);
        
        // Parcourir tous les trips
        this.dataManager.trips.forEach(trip => {
            // Filtrer par service actif
            const isActive = Array.from(activeServices).some(id => 
                this.dataManager.serviceIdsMatch(trip.service_id, id)
            );
            
            if (!isActive) return;

            const stopTimes = this.dataManager.stopTimesByTrip[trip.trip_id];
            if (!stopTimes) return;

            // Créer les connexions (Segments d'arrêt à arrêt)
            for (let i = 0; i < stopTimes.length - 1; i++) {
                const stDep = stopTimes[i];
                const stArr = stopTimes[i + 1];

                this.connections.push({
                    depTime: this.dataManager.timeToSeconds(stDep.departure_time),
                    arrTime: this.dataManager.timeToSeconds(stArr.arrival_time),
                    fromStop: stDep.stop_id,
                    toStop: stArr.stop_id,
                    tripId: trip.trip_id,
                    routeId: trip.route_id,
                    stopSequence: parseInt(stDep.stop_sequence)
                });
            }
        });

        // TRI CRUCIAL pour l'algo CSA : Trier par heure de départ croissante
        this.connections.sort((a, b) => a.depTime - b.depTime);
        
        console.log(`⚡ Graphe local construit : ${this.connections.length} connexions actives pour ce jour.`);
    }

    /**
     * 2. RECHERCHE D'ITINÉRAIRE (ALGORITHME CSA SIMPLIFIÉ)
     */
    findItinerary(fromLat, fromLon, toLat, toLon, departureTimeSeconds) {
        // A. Trouver les arrêts de départ et d'arrivée les plus proches (< 1.5km)
        const startStops = this.findNearestStops(fromLat, fromLon, 1500);
        const endStops = this.findNearestStops(toLat, toLon, 1500);

        if (startStops.length === 0 || endStops.length === 0) {
            throw new Error("Aucun arrêt à proximité du départ ou de l'arrivée.");
        }

        const targetStopIds = new Set(endStops.map(s => s.stop_id));

        // B. Initialisation
        // arrivalLabels[stopId] = { time, connection (le bus qui nous a amené ici), prevStop }
        let arrivalLabels = {};
        const WALK_SPEED = 1.1; // m/s (~4 km/h)
        const TRANSFER_PENALTY = 120; // 2 minutes de pénalité pour changer de bus (pour éviter les changements inutiles)

        // Initialiser avec la marche vers les arrêts de départ
        startStops.forEach(stop => {
            const dist = stop.dist; // Distance vol d'oiseau
            const walkTime = Math.ceil((dist * 1.4) / WALK_SPEED); // 1.4 = tortuosité
            
            arrivalLabels[stop.stop_id] = {
                arrivalAtStop: departureTimeSeconds + walkTime,
                tripId: 'WALK_START',
                prevStop: null,
                enterTime: departureTimeSeconds
            };
        });

        // C. Le Scan (Cœur de l'algo)
        for (let conn of this.connections) {
            // Si le bus part avant qu'on puisse y être, on ignore
            if (!arrivalLabels[conn.fromStop]) continue;
            if (arrivalLabels[conn.fromStop].arrivalAtStop > conn.depTime) continue;

            // Optimisation: Si on a déjà atteint la destination finale plus tôt que ce bus ne part, on arrête (heuristic)
            // (Simplifié ici pour la robustesse)

            // Si on améliore le temps d'arrivée à l'arrêt suivant
            // On ajoute une petite pénalité de transfert si on change de TripID pour privilégier les trajets directs
            const isTransfer = arrivalLabels[conn.fromStop].tripId !== conn.tripId && arrivalLabels[conn.fromStop].tripId !== 'WALK_START';
            const penalty = isTransfer ? TRANSFER_PENALTY : 0;

            if (!arrivalLabels[conn.toStop] || arrivalLabels[conn.toStop].arrivalAtStop > conn.arrTime + penalty) {
                arrivalLabels[conn.toStop] = {
                    arrivalAtStop: conn.arrTime,
                    tripId: conn.tripId,
                    routeId: conn.routeId,
                    prevStop: conn.fromStop,
                    connection: conn // On stocke la connexion pour reconstruire le trajet
                };
            }
        }

        // D. Trouver le meilleur arrêt d'arrivée final
        let bestEndStop = null;
        let minTotalTime = Infinity;

        endStops.forEach(stop => {
            if (arrivalLabels[stop.stop_id]) {
                const busArrivalTime = arrivalLabels[stop.stop_id].arrivalAtStop;
                const dist = stop.dist;
                const walkTime = Math.ceil((dist * 1.4) / WALK_SPEED);
                const finalTime = busArrivalTime + walkTime;

                if (finalTime < minTotalTime) {
                    minTotalTime = finalTime;
                    bestEndStop = stop;
                }
            }
        });

        if (!bestEndStop) {
            throw new Error("Aucun itinéraire trouvé en transports en commun.");
        }

        // E. Reconstruction du trajet (Format compatible Google/Main.js)
        return this.reconstructItinerary(arrivalLabels, bestEndStop, fromLat, fromLon, toLat, toLon, minTotalTime, departureTimeSeconds);
    }

    /**
     * 3. RECONSTRUCTION ET GÉOMÉTRIE (TRACÉ SUR CARTE)
     */
    reconstructItinerary(labels, endStop, startLat, startLon, endLat, endLon, arrivalTime, startTime) {
        const steps = [];
        let currentStopId = endStop.stop_id;
        
        // 1. Étape Finale : Marche Arrivée
        const lastBusTime = labels[currentStopId].arrivalAtStop;
        const walkEndDuration = arrivalTime - lastBusTime;
        steps.unshift({
            type: 'WALK',
            instruction: "Marcher vers votre destination",
            distance: `${Math.round(endStop.dist * 1.4)} m`,
            duration: this.formatDuration(walkEndDuration),
            polylines: [this.createStraightPolyline(this.dataManager.getStop(currentStopId), {stop_lat: endLat, stop_lon: endLon})],
            subSteps: []
        });

        // 2. Remonter les bus (Backtracking)
        while (labels[currentStopId] && labels[currentStopId].tripId !== 'WALK_START') {
            const data = labels[currentStopId];
            const conn = data.connection;
            
            // On regroupe les connexions contiguës du même Trip (pour faire une seule étape "Ligne A")
            let segmentStops = [this.dataManager.getStop(conn.toStop)];
            let segmentStartConn = conn;
            
            // Remonter tant que c'est le même trip
            while (labels[segmentStartConn.fromStop] && labels[segmentStartConn.fromStop].tripId === segmentStartConn.tripId) {
                segmentStartConn = labels[segmentStartConn.fromStop].connection;
                segmentStops.unshift(this.dataManager.getStop(segmentStartConn.toStop));
            }
            
            // On est au début du trip (segmentStartConn.fromStop est l'arrêt de montée)
            const fromStopInfo = this.dataManager.getStop(segmentStartConn.fromStop);
            const toStopInfo = this.dataManager.getStop(currentStopId); // L'arrêt où on était avant de remonter
            const route = this.dataManager.routesById[segmentStartConn.routeId];

            // GÉOMÉTRIE PRÉCISE : On découpe le GeoJSON
            const geometry = this.getRouteGeometrySlice(segmentStartConn.routeId, fromStopInfo, toStopInfo);

            steps.unshift({
                type: 'BUS',
                routeShortName: route.route_short_name,
                routeColor: route.route_color || '000000',
                routeTextColor: route.route_text_color || 'FFFFFF',
                instruction: `Prendre la ligne ${route.route_short_name}`,
                departureStop: fromStopInfo.stop_name,
                arrivalStop: toStopInfo.stop_name,
                departureTime: this.formatTime(segmentStartConn.depTime),
                arrivalTime: this.formatTime(conn.arrTime), // L'heure d'arrivée du dernier segment du trip
                numStops: segmentStops.length,
                duration: this.formatDuration(conn.arrTime - segmentStartConn.depTime),
                intermediateStops: segmentStops.map(s => s.stop_name),
                polyline: { encodedPolyline: this.encodePolyline(geometry) } // On encode pour que main.js le décode
            });

            currentStopId = segmentStartConn.fromStop;
        }

        // 3. Étape Initiale : Marche Départ
        const walkStartDuration = labels[currentStopId].arrivalAtStop - startTime;
        steps.unshift({
            type: 'WALK',
            instruction: "Marcher vers l'arrêt",
            distance: "Environ 5 min", // Estimation
            duration: this.formatDuration(walkStartDuration),
            polylines: [this.createStraightPolyline({stop_lat: startLat, stop_lon: startLon}, this.dataManager.getStop(currentStopId))],
            subSteps: []
        });

        // 4. Structure finale "Google-like"
        return {
            type: 'BUS',
            steps: steps,
            departureTime: this.formatTime(startTime),
            arrivalTime: this.formatTime(arrivalTime),
            duration: this.formatDuration(arrivalTime - startTime),
            summarySegments: steps.filter(s => s.type === 'BUS').map(s => ({
                name: s.routeShortName,
                color: `#${s.routeColor}`,
                textColor: `#${s.routeTextColor}`
            }))
        };
    }

    // --- HELPERS GÉOMÉTRIE & UTILITAIRES ---

    findNearestStops(lat, lon, maxDist) {
        return this.dataManager.masterStops
            .map(s => {
                const d = this.dataManager.calculateDistance(lat, lon, s.stop_lat, s.stop_lon);
                return { ...s, dist: d };
            })
            .filter(s => s.dist <= maxDist)
            .sort((a, b) => a.dist - b.dist)
            .slice(0, 5);
    }

    /**
     * Découpe le GeoJSON complet de la ligne pour ne garder que la portion entre deux arrêts.
     * C'est ce qui donne le tracé précis sur la carte.
     */
    getRouteGeometrySlice(routeId, fromStop, toStop) {
        const fullCoords = this.dataManager.getRouteGeometry(routeId);
        if (!fullCoords) return []; // Fallback ligne droite si pas de GeoJSON

        // Trouver les points les plus proches sur la ligne (Projection)
        // Note: On utilise les index pour savoir dans quel sens aller
        const fromIdx = this.dataManager.findNearestPointOnRoute(fullCoords, parseFloat(fromStop.stop_lat), parseFloat(fromStop.stop_lon));
        const toIdx = this.dataManager.findNearestPointOnRoute(fullCoords, parseFloat(toStop.stop_lat), parseFloat(toStop.stop_lon));

        if (fromIdx === null || toIdx === null) return [[parseFloat(fromStop.stop_lat), parseFloat(fromStop.stop_lon)], [parseFloat(toStop.stop_lat), parseFloat(toStop.stop_lon)]];

        if (fromIdx <= toIdx) {
            // Sens normal
            return fullCoords.slice(fromIdx, toIdx + 1).map(pt => [pt[1], pt[0]]); // Inversion Lat/Lon pour Leaflet/Encoding
        } else {
            // Sens inverse ou boucle (cas complexe simplifié ici)
            // On tente de prendre le segment inverse
             return fullCoords.slice(toIdx, fromIdx + 1).reverse().map(pt => [pt[1], pt[0]]);
        }
    }

    createStraightPolyline(p1, p2) {
        // Retourne un format compatible avec main.js (encoded)
        const coords = [[parseFloat(p1.stop_lat), parseFloat(p1.stop_lon)], [parseFloat(p2.stop_lat), parseFloat(p2.stop_lon)]];
        return { encodedPolyline: this.encodePolyline(coords) };
    }

    // Algorithme d'encodage Polyline (Google Algorithm) pour compatibilité avec main.js
    encodePolyline(coords) {
        let str = '';
        let lastLat = 0;
        let lastLng = 0;

        for (const point of coords) {
            let lat = Math.round(point[0] * 1e5);
            let lng = Math.round(point[1] * 1e5);

            let dLat = lat - lastLat;
            let dLng = lng - lastLng;

            str += this.encodeValue(dLat) + this.encodeValue(dLng);

            lastLat = lat;
            lastLng = lng;
        }
        return str;
    }

    encodeValue(value) {
        value = value < 0 ? ~(value << 1) : (value << 1);
        let str = '';
        while (value >= 0x20) {
            str += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
            value >>= 5;
        }
        str += String.fromCharCode(value + 63);
        return str;
    }

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600) % 24;
        const m = Math.floor((seconds % 3600) / 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    formatDuration(seconds) {
        const m = Math.ceil(seconds / 60);
        if (m >= 60) {
            const h = Math.floor(m / 60);
            const rem = m % 60;
            return `${h}h ${rem}min`;
        }
        return `${m} min`;
    }
}
