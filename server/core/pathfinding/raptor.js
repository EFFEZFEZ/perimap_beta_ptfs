/**
 * raptor.js
 * Implémentation de l'algorithme RAPTOR (Round-Based Public Transit Routing)
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 * 
 * RAPTOR est l'algorithme de référence pour le calcul d'itinéraires
 * en transport en commun. Il est utilisé par de nombreux systèmes
 * comme OpenTripPlanner, Navitia, etc.
 * 
 * Avantages:
 * - Très rapide (temps réel < 100ms)
 * - Gère les correspondances de manière optimale
 * - Retourne les itinéraires Pareto-optimaux
 * 
 * Référence: https://www.microsoft.com/en-us/research/publication/round-based-public-transit-routing/
 */

/**
 * @typedef {Object} Stop
 * @property {string} id - ID unique de l'arrêt
 * @property {string} name - Nom de l'arrêt
 * @property {number} lat - Latitude
 * @property {number} lon - Longitude
 */

/**
 * @typedef {Object} StopTime
 * @property {string} tripId - ID du voyage
 * @property {string} stopId - ID de l'arrêt
 * @property {number} arrivalTime - Heure d'arrivée (secondes depuis minuit)
 * @property {number} departureTime - Heure de départ (secondes depuis minuit)
 * @property {number} stopSequence - Ordre de l'arrêt dans le voyage
 */

/**
 * @typedef {Object} Journey
 * @property {Array} legs - Segments du trajet
 * @property {number} departureTime - Heure de départ
 * @property {number} arrivalTime - Heure d'arrivée
 * @property {number} duration - Durée totale (secondes)
 * @property {number} transfers - Nombre de correspondances
 */

export class RaptorAlgorithm {
  /**
   * @param {Object} graph - Graphe de transport
   * @param {Object} options - Options de configuration
   */
  constructor(graph, options = {}) {
    this.graph = graph;
    this.options = {
      maxRounds: options.maxTransfers + 1 || 4, // Nombre max de rounds (correspondances + 1)
      maxWalkDistance: options.maxWalkDistance || 1000, // Distance max de marche (m)
      walkSpeed: options.walkSpeed || 1.25, // Vitesse de marche (m/s)
      minTransferTime: options.minTransferTime || 120, // Temps min de correspondance (s)
      transferPenalty: options.transferPenalty || 300, // Pénalité de correspondance (s)
      ...options,
    };

    // Caches pour les calculs
    this.stopsIndex = new Map(); // stop_id -> index
    this.routesAtStop = new Map(); // stop_id -> [route_ids]
    this.stopTimesIndex = new Map(); // route_id -> {trip_id -> [stop_times]}
  }

  /**
   * Construit les index nécessaires pour RAPTOR
   */
  buildIndexes() {
    const { stops, stopTimes, routes, trips } = this.graph;

    // Index des arrêts
    stops.forEach((stop, index) => {
      this.stopsIndex.set(stop.stop_id, index);
    });

    // Routes par arrêt
    const routeStops = new Map(); // route_id -> Set<stop_id>
    stopTimes.forEach(st => {
      const trip = trips.find(t => t.trip_id === st.trip_id);
      if (!trip) return;
      
      if (!routeStops.has(trip.route_id)) {
        routeStops.set(trip.route_id, new Set());
      }
      routeStops.get(trip.route_id).add(st.stop_id);
    });

    // Inverser: pour chaque arrêt, quelles routes y passent
    routeStops.forEach((stopIds, routeId) => {
      stopIds.forEach(stopId => {
        if (!this.routesAtStop.has(stopId)) {
          this.routesAtStop.set(stopId, []);
        }
        this.routesAtStop.get(stopId).push(routeId);
      });
    });

    // Index des stop_times par route et trip
    stopTimes.forEach(st => {
      const trip = trips.find(t => t.trip_id === st.trip_id);
      if (!trip) return;

      if (!this.stopTimesIndex.has(trip.route_id)) {
        this.stopTimesIndex.set(trip.route_id, new Map());
      }
      const routeIndex = this.stopTimesIndex.get(trip.route_id);
      
      if (!routeIndex.has(st.trip_id)) {
        routeIndex.set(st.trip_id, []);
      }
      routeIndex.get(st.trip_id).push(st);
    });

    // Trier les stop_times par sequence
    this.stopTimesIndex.forEach(routeIndex => {
      routeIndex.forEach(tripStopTimes => {
        tripStopTimes.sort((a, b) => a.stop_sequence - b.stop_sequence);
      });
    });

    console.log(`📊 RAPTOR indexes built: ${this.stopsIndex.size} stops, ${this.routesAtStop.size} stop-routes`);
  }

  /**
   * Calcule les itinéraires optimaux entre deux points
   * 
   * @param {string} originStopId - ID de l'arrêt de départ
   * @param {string} destStopId - ID de l'arrêt d'arrivée
   * @param {number} departureTime - Heure de départ (secondes depuis minuit)
   * @param {string} dateStr - Date au format YYYYMMDD
   * @returns {Journey[]} Liste des itinéraires Pareto-optimaux
   */
  computeJourneys(originStopId, destStopId, departureTime, dateStr) {
    const { maxRounds, minTransferTime } = this.options;

    // Tableaux RAPTOR
    // τ[k][p] = meilleure heure d'arrivée à l'arrêt p avec exactement k correspondances
    const tau = [];
    // τ*[p] = meilleure heure d'arrivée à l'arrêt p (tous rounds confondus)
    const tauStar = new Map();
    // Marquage des arrêts modifiés à chaque round
    const marked = new Set();
    // Reconstruction du chemin
    const journeyPointer = new Map(); // stop_id -> { round, tripId, boardStop, alightStop }

    const numStops = this.graph.stops.length;

    // Initialisation
    for (let k = 0; k <= maxRounds; k++) {
      tau[k] = new Array(numStops).fill(Infinity);
    }
    this.graph.stops.forEach(stop => {
      tauStar.set(stop.stop_id, Infinity);
    });

    // Arrêt de départ: arrivée au temps de départ
    const originIndex = this.stopsIndex.get(originStopId);
    if (originIndex === undefined) {
      console.error(`Arrêt de départ non trouvé: ${originStopId}`);
      return [];
    }

    tau[0][originIndex] = departureTime;
    tauStar.set(originStopId, departureTime);
    marked.add(originStopId);

    // Rounds RAPTOR
    for (let k = 1; k <= maxRounds; k++) {
      // Copier les valeurs du round précédent
      tau[k] = [...tau[k - 1]];

      // Collecter les routes à scanner
      const routesToScan = new Set();
      marked.forEach(stopId => {
        const routes = this.routesAtStop.get(stopId) || [];
        routes.forEach(r => routesToScan.add(r));
      });
      marked.clear();

      // Pour chaque route
      routesToScan.forEach(routeId => {
        this.scanRoute(k, routeId, departureTime, dateStr, tau, tauStar, marked, journeyPointer);
      });

      // Transferts à pied (si implémentés)
      // this.processFootpaths(k, tau, tauStar, marked);

      // Si aucun arrêt n'a été amélioré, on peut arrêter
      if (marked.size === 0) {
        break;
      }
    }

    // Récupérer le meilleur temps d'arrivée à destination
    const destIndex = this.stopsIndex.get(destStopId);
    if (destIndex === undefined) {
      console.error(`Arrêt de destination non trouvé: ${destStopId}`);
      return [];
    }

    // Construire les journeys Pareto-optimaux
    const journeys = this.reconstructJourneys(destStopId, tau, journeyPointer);

    return journeys;
  }

  /**
   * Scanne une route pour améliorer les temps d'arrivée
   */
  scanRoute(k, routeId, queryTime, dateStr, tau, tauStar, marked, journeyPointer) {
    const routeTrips = this.stopTimesIndex.get(routeId);
    if (!routeTrips) return;

    // Prendre le premier trip comme référence pour l'ordre des arrêts
    const firstTripStopTimes = routeTrips.values().next().value;
    if (!firstTripStopTimes || firstTripStopTimes.length === 0) return;

    // Pour chaque trip de la route
    routeTrips.forEach((tripStopTimes, tripId) => {
      // Vérifier si le trip est actif à cette date
      // (simplifié - en vrai il faut vérifier calendar/calendar_dates)
      
      let boardingStop = null;
      let boardingTime = null;

      // Parcourir les arrêts du trip dans l'ordre
      for (const st of tripStopTimes) {
        const stopIndex = this.stopsIndex.get(st.stop_id);
        if (stopIndex === undefined) continue;

        // Est-ce qu'on peut monter ici?
        if (boardingStop === null) {
          // On peut monter si on peut atteindre cet arrêt avant le départ du bus
          const arrivalAtStop = tau[k - 1][stopIndex];
          if (arrivalAtStop !== Infinity && arrivalAtStop <= st.departure_time) {
            boardingStop = st.stop_id;
            boardingTime = st.departure_time;
          }
        }

        // Est-ce qu'on peut descendre ici et améliorer le temps?
        if (boardingStop !== null) {
          const newArrival = st.arrival_time;
          
          if (newArrival < tau[k][stopIndex]) {
            tau[k][stopIndex] = newArrival;
            
            if (newArrival < tauStar.get(st.stop_id)) {
              tauStar.set(st.stop_id, newArrival);
              marked.add(st.stop_id);

              // Sauvegarder pour reconstruction
              journeyPointer.set(`${st.stop_id}_${k}`, {
                round: k,
                tripId: tripId,
                routeId: routeId,
                boardStop: boardingStop,
                alightStop: st.stop_id,
                boardTime: boardingTime,
                alightTime: newArrival,
              });
            }
          }
        }
      }
    });
  }

  /**
   * Reconstruit les journeys à partir des pointeurs
   */
  reconstructJourneys(destStopId, tau, journeyPointer) {
    const journeys = [];
    const destIndex = this.stopsIndex.get(destStopId);

    // Pour chaque round, vérifier si on a un chemin
    for (let k = 1; k < tau.length; k++) {
      if (tau[k][destIndex] === Infinity) continue;

      const journey = {
        legs: [],
        departureTime: null,
        arrivalTime: tau[k][destIndex],
        duration: 0,
        transfers: k - 1,
      };

      // Reconstruire le chemin en remontant
      let currentStop = destStopId;
      let currentRound = k;

      while (currentRound > 0) {
        const pointer = journeyPointer.get(`${currentStop}_${currentRound}`);
        if (!pointer) break;

        journey.legs.unshift({
          type: 'transit',
          tripId: pointer.tripId,
          routeId: pointer.routeId,
          fromStop: pointer.boardStop,
          toStop: pointer.alightStop,
          departureTime: pointer.boardTime,
          arrivalTime: pointer.alightTime,
        });

        currentStop = pointer.boardStop;
        currentRound--;
      }

      if (journey.legs.length > 0) {
        journey.departureTime = journey.legs[0].departureTime;
        journey.duration = journey.arrivalTime - journey.departureTime;
        journeys.push(journey);
      }
    }

    // Filtrer les journeys dominés (Pareto)
    return this.filterParetoOptimal(journeys);
  }

  /**
   * Filtre les itinéraires pour ne garder que les Pareto-optimaux
   * (non dominés en termes de temps d'arrivée et nombre de correspondances)
   */
  filterParetoOptimal(journeys) {
    const dominated = new Set();

    for (let i = 0; i < journeys.length; i++) {
      for (let j = 0; j < journeys.length; j++) {
        if (i === j) continue;

        const ji = journeys[i];
        const jj = journeys[j];

        // j domine i si j est meilleur ou égal sur tous les critères et strictement meilleur sur au moins un
        if (
          jj.arrivalTime <= ji.arrivalTime &&
          jj.transfers <= ji.transfers &&
          (jj.arrivalTime < ji.arrivalTime || jj.transfers < ji.transfers)
        ) {
          dominated.add(i);
        }
      }
    }

    return journeys.filter((_, index) => !dominated.has(index));
  }

  /**
   * Trouve les arrêts accessibles à pied depuis un point
   * 
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @returns {Array<{stop: Stop, walkTime: number}>}
   */
  findNearbyStops(lat, lon) {
    const { maxWalkDistance, walkSpeed } = this.options;
    const nearby = [];

    this.graph.stops.forEach(stop => {
      const distance = this.haversineDistance(lat, lon, stop.stop_lat, stop.stop_lon);
      
      if (distance <= maxWalkDistance) {
        const walkTime = Math.round(distance / walkSpeed);
        nearby.push({
          stop,
          distance,
          walkTime,
        });
      }
    });

    // Trier par distance
    nearby.sort((a, b) => a.distance - b.distance);

    return nearby;
  }

  /**
   * Calcule la distance Haversine entre deux points
   */
  haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Rayon de la Terre en mètres
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }
}

export default RaptorAlgorithm;
