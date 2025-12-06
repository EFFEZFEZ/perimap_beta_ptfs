/**
 * core/pathfinding/index.js
 * Export principal du module de pathfinding
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 */

import { RaptorAlgorithm } from './raptor.js';
import { AStarAlgorithm } from './astar.js';
import { TransportGraph } from './graph.js';

/**
 * Moteur de calcul d'itinéraires complet
 * Combine RAPTOR (transport) et A* (marche)
 */
export class PathfindingEngine {
  /**
   * @param {Object} gtfsData - Données GTFS chargées
   * @param {Object} options - Options de configuration
   */
  constructor(gtfsData, options = {}) {
    this.options = {
      maxWalkDistance: options.maxWalkDistance || 1000,
      walkSpeed: options.walkSpeed || 1.25,
      maxTransfers: options.maxTransfers || 3,
      minTransferTime: options.minTransferTime || 120,
      transferPenalty: options.transferPenalty || 300,
      maxResults: options.maxResults || 5,
      nearbyStopRadius: options.nearbyStopRadius || 500,
      ...options,
    };

    this.gtfsData = gtfsData;
    this.graph = null;
    this.raptor = null;
    this.astar = null;
    this.isReady = false;
  }

  /**
   * Construit le graphe et initialise les algorithmes
   */
  async buildGraph() {
    console.log('🔧 Construction du moteur de pathfinding...');
    const startTime = Date.now();

    // Construire le graphe de transport
    this.graph = new TransportGraph();
    this.graph.loadFromGtfs(this.gtfsData);

    // Initialiser RAPTOR
    this.raptor = new RaptorAlgorithm(this.graph, this.options);
    this.raptor.buildIndexes();

    // Initialiser A* (pour les trajets à pied)
    this.astar = new AStarAlgorithm({
      walkSpeed: this.options.walkSpeed,
      maxDistance: this.options.maxWalkDistance,
    });

    // Construire le graphe piéton à partir des arrêts
    const walkNodes = this.gtfsData.stops.map(stop => ({
      id: stop.stop_id,
      lat: parseFloat(stop.stop_lat),
      lon: parseFloat(stop.stop_lon),
    }));
    this.astar.buildGraphFromPoints(walkNodes, 5, 500);

    this.isReady = true;
    const elapsed = Date.now() - startTime;
    console.log(`✅ Moteur de pathfinding prêt en ${elapsed}ms`);

    return this;
  }

  /**
   * Calcule les itinéraires entre deux points géographiques
   * 
   * @param {Object} origin - {lat, lon, name?}
   * @param {Object} destination - {lat, lon, name?}
   * @param {Date} departureTime - Heure de départ
   * @returns {Array} Liste des itinéraires
   */
  async computeItineraries(origin, destination, departureTime) {
    if (!this.isReady) {
      throw new Error('PathfindingEngine not ready. Call buildGraph() first.');
    }

    const results = [];
    const dateStr = this.formatGtfsDate(departureTime);
    const timeSeconds = this.timeToSeconds(departureTime);

    // 1. Trouver les arrêts proches de l'origine et de la destination
    const originStops = this.raptor.findNearbyStops(origin.lat, origin.lon);
    const destStops = this.raptor.findNearbyStops(destination.lat, destination.lon);

    if (originStops.length === 0 || destStops.length === 0) {
      // Pas d'arrêts à proximité, retourner uniquement le trajet à pied
      const walkPath = this.astar.computeDirectPath(
        origin.lat, origin.lon,
        destination.lat, destination.lon
      );
      
      if (walkPath.distance <= this.options.maxWalkDistance * 2) {
        results.push({
          type: 'walk_only',
          legs: [{
            type: 'walk',
            from: origin,
            to: destination,
            distance: walkPath.distance,
            duration: walkPath.duration,
            polyline: walkPath.coordinates,
          }],
          totalDuration: walkPath.duration,
          totalDistance: walkPath.distance,
          transfers: 0,
          departureTime: departureTime.toISOString(),
          arrivalTime: new Date(departureTime.getTime() + walkPath.duration * 1000).toISOString(),
        });
      }
      return results;
    }

    // 2. Pour chaque combinaison origine/destination, calculer l'itinéraire RAPTOR
    for (const originStop of originStops.slice(0, 3)) {
      for (const destStop of destStops.slice(0, 3)) {
        const adjustedDepartureTime = timeSeconds + originStop.walkTime;
        
        const journeys = this.raptor.computeJourneys(
          originStop.stop.stop_id,
          destStop.stop.stop_id,
          adjustedDepartureTime,
          dateStr
        );

        for (const journey of journeys) {
          const itinerary = this.buildItinerary(
            origin,
            destination,
            originStop,
            destStop,
            journey,
            departureTime
          );
          results.push(itinerary);
        }
      }
    }

    // 3. Trier et filtrer les résultats
    const sorted = this.rankItineraries(results);
    return sorted.slice(0, this.options.maxResults);
  }

  /**
   * Construit un itinéraire complet avec les segments de marche
   */
  buildItinerary(origin, destination, originStop, destStop, journey, baseTime) {
    const legs = [];
    let currentTime = new Date(baseTime);

    // Segment de marche vers le premier arrêt
    if (originStop.walkTime > 0) {
      legs.push({
        type: 'walk',
        from: origin,
        to: {
          lat: originStop.stop.stop_lat,
          lon: originStop.stop.stop_lon,
          name: originStop.stop.stop_name,
          stopId: originStop.stop.stop_id,
        },
        distance: originStop.distance,
        duration: originStop.walkTime,
        departureTime: currentTime.toISOString(),
        arrivalTime: new Date(currentTime.getTime() + originStop.walkTime * 1000).toISOString(),
      });
      currentTime = new Date(currentTime.getTime() + originStop.walkTime * 1000);
    }

    // Segments de transport
    for (const leg of journey.legs) {
      const fromStop = this.graph.stopsById.get(leg.fromStop);
      const toStop = this.graph.stopsById.get(leg.toStop);
      const route = this.graph.routesById.get(leg.routeId);
      const trip = this.graph.tripsById.get(leg.tripId);

      // Attente éventuelle
      const legDepartureTime = this.secondsToDate(baseTime, leg.departureTime);
      if (legDepartureTime > currentTime) {
        // Il y a une attente (correspondance)
        const waitTime = (legDepartureTime - currentTime) / 1000;
        if (waitTime > 60) { // Plus d'une minute d'attente
          legs.push({
            type: 'wait',
            at: {
              lat: fromStop?.stop_lat,
              lon: fromStop?.stop_lon,
              name: fromStop?.stop_name,
              stopId: leg.fromStop,
            },
            duration: Math.round(waitTime),
            departureTime: currentTime.toISOString(),
            arrivalTime: legDepartureTime.toISOString(),
          });
        }
        currentTime = legDepartureTime;
      }

      legs.push({
        type: 'transit',
        mode: this.getRouteMode(route),
        routeId: leg.routeId,
        routeName: route?.route_short_name || route?.route_long_name,
        routeColor: route?.route_color ? `#${route.route_color}` : '#1976D2',
        tripId: leg.tripId,
        tripHeadsign: trip?.trip_headsign,
        from: {
          lat: fromStop?.stop_lat,
          lon: fromStop?.stop_lon,
          name: fromStop?.stop_name,
          stopId: leg.fromStop,
        },
        to: {
          lat: toStop?.stop_lat,
          lon: toStop?.stop_lon,
          name: toStop?.stop_name,
          stopId: leg.toStop,
        },
        departureTime: this.secondsToDate(baseTime, leg.departureTime).toISOString(),
        arrivalTime: this.secondsToDate(baseTime, leg.alightTime).toISOString(),
        duration: leg.alightTime - leg.departureTime,
      });

      currentTime = this.secondsToDate(baseTime, leg.alightTime);
    }

    // Segment de marche vers la destination
    if (destStop.walkTime > 0) {
      legs.push({
        type: 'walk',
        from: {
          lat: destStop.stop.stop_lat,
          lon: destStop.stop.stop_lon,
          name: destStop.stop.stop_name,
          stopId: destStop.stop.stop_id,
        },
        to: destination,
        distance: destStop.distance,
        duration: destStop.walkTime,
        departureTime: currentTime.toISOString(),
        arrivalTime: new Date(currentTime.getTime() + destStop.walkTime * 1000).toISOString(),
      });
      currentTime = new Date(currentTime.getTime() + destStop.walkTime * 1000);
    }

    // Calculer les totaux
    const totalDuration = (currentTime - baseTime) / 1000;
    const totalWalkDistance = legs
      .filter(l => l.type === 'walk')
      .reduce((sum, l) => sum + (l.distance || 0), 0);
    const transfers = legs.filter(l => l.type === 'transit').length - 1;

    return {
      type: 'transit',
      legs,
      totalDuration: Math.round(totalDuration),
      totalWalkDistance: Math.round(totalWalkDistance),
      transfers: Math.max(0, transfers),
      departureTime: baseTime.toISOString(),
      arrivalTime: currentTime.toISOString(),
    };
  }

  /**
   * Classe les itinéraires par qualité
   */
  rankItineraries(itineraries) {
    return itineraries.sort((a, b) => {
      // Score = durée + pénalité par correspondance
      const scoreA = a.totalDuration + a.transfers * this.options.transferPenalty;
      const scoreB = b.totalDuration + b.transfers * this.options.transferPenalty;
      return scoreA - scoreB;
    });
  }

  /**
   * Détermine le mode de transport d'une route
   */
  getRouteMode(route) {
    if (!route) return 'bus';
    
    const type = parseInt(route.route_type, 10);
    switch (type) {
      case 0: return 'tram';
      case 1: return 'metro';
      case 2: return 'rail';
      case 3: return 'bus';
      case 4: return 'ferry';
      case 5: return 'cable_car';
      case 6: return 'gondola';
      case 7: return 'funicular';
      default: return 'bus';
    }
  }

  /**
   * Formate une date au format GTFS (YYYYMMDD)
   */
  formatGtfsDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * Convertit une heure en secondes depuis minuit
   */
  timeToSeconds(date) {
    return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  }

  /**
   * Convertit des secondes en Date
   */
  secondsToDate(baseDate, seconds) {
    const result = new Date(baseDate);
    result.setHours(0, 0, 0, 0);
    result.setSeconds(seconds);
    return result;
  }

  /**
   * Statistiques du moteur
   */
  getStats() {
    return {
      ready: this.isReady,
      graph: this.graph?.stats || {},
      memory: this.graph?.estimateMemory() || {},
    };
  }
}

// Exports
export { RaptorAlgorithm } from './raptor.js';
export { AStarAlgorithm } from './astar.js';
export { TransportGraph } from './graph.js';

export default PathfindingEngine;
