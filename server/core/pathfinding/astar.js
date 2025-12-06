/**
 * astar.js
 * Implémentation de l'algorithme A* pour le calcul de chemins piétons
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 * 
 * A* est utilisé pour calculer les trajets à pied:
 * - De l'origine jusqu'à l'arrêt de bus le plus proche
 * - Entre deux arrêts lors d'une correspondance
 * - Du dernier arrêt jusqu'à la destination
 * 
 * Peut aussi être utilisé avec un graphe routier pour
 * le calcul d'itinéraires en voiture.
 */

/**
 * @typedef {Object} Node
 * @property {string} id - Identifiant unique du nœud
 * @property {number} lat - Latitude
 * @property {number} lon - Longitude
 */

/**
 * @typedef {Object} Edge
 * @property {string} from - ID du nœud de départ
 * @property {string} to - ID du nœud d'arrivée
 * @property {number} distance - Distance en mètres
 * @property {number} [duration] - Durée estimée en secondes
 */

/**
 * @typedef {Object} Path
 * @property {Node[]} nodes - Liste des nœuds du chemin
 * @property {number} distance - Distance totale en mètres
 * @property {number} duration - Durée totale en secondes
 * @property {Array<[number, number]>} coordinates - Coordonnées pour le tracé
 */

/**
 * File de priorité simple (min-heap)
 */
class PriorityQueue {
  constructor() {
    this.heap = [];
  }

  push(item, priority) {
    this.heap.push({ item, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) return null;
    
    const top = this.heap[0];
    const last = this.heap.pop();
    
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    
    return top.item;
  }

  isEmpty() {
    return this.heap.length === 0;
  }

  bubbleUp(index) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[parentIndex].priority <= this.heap[index].priority) break;
      [this.heap[parentIndex], this.heap[index]] = [this.heap[index], this.heap[parentIndex]];
      index = parentIndex;
    }
  }

  bubbleDown(index) {
    const length = this.heap.length;
    while (true) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;

      if (left < length && this.heap[left].priority < this.heap[smallest].priority) {
        smallest = left;
      }
      if (right < length && this.heap[right].priority < this.heap[smallest].priority) {
        smallest = right;
      }
      if (smallest === index) break;

      [this.heap[smallest], this.heap[index]] = [this.heap[index], this.heap[smallest]];
      index = smallest;
    }
  }
}

/**
 * Algorithme A* pour le calcul de chemins
 */
export class AStarAlgorithm {
  /**
   * @param {Object} options - Options de configuration
   */
  constructor(options = {}) {
    this.options = {
      walkSpeed: options.walkSpeed || 1.25, // m/s (~4.5 km/h)
      maxDistance: options.maxDistance || 5000, // Distance max (m)
      ...options,
    };

    // Graphe des nœuds et arêtes
    this.nodes = new Map(); // id -> Node
    this.adjacency = new Map(); // id -> [{to, distance, duration}]
  }

  /**
   * Ajoute un nœud au graphe
   * @param {Node} node
   */
  addNode(node) {
    this.nodes.set(node.id, node);
    if (!this.adjacency.has(node.id)) {
      this.adjacency.set(node.id, []);
    }
  }

  /**
   * Ajoute une arête au graphe
   * @param {Edge} edge
   * @param {boolean} bidirectional - Si true, ajoute aussi l'arête inverse
   */
  addEdge(edge, bidirectional = true) {
    const duration = edge.duration || Math.round(edge.distance / this.options.walkSpeed);
    
    this.adjacency.get(edge.from)?.push({
      to: edge.to,
      distance: edge.distance,
      duration,
    });

    if (bidirectional) {
      this.adjacency.get(edge.to)?.push({
        to: edge.from,
        distance: edge.distance,
        duration,
      });
    }
  }

  /**
   * Construit un graphe simple à partir d'une liste de points
   * Connecte chaque point à ses voisins les plus proches
   * 
   * @param {Node[]} points - Liste de points
   * @param {number} maxNeighbors - Nombre max de voisins par point
   * @param {number} maxEdgeDistance - Distance max pour une arête (m)
   */
  buildGraphFromPoints(points, maxNeighbors = 5, maxEdgeDistance = 500) {
    // Ajouter tous les nœuds
    points.forEach(point => this.addNode(point));

    // Pour chaque point, trouver les voisins les plus proches
    points.forEach(point => {
      const neighbors = this.findNearestNeighbors(point, points, maxNeighbors, maxEdgeDistance);
      
      neighbors.forEach(neighbor => {
        // Éviter les doublons (arêtes bidirectionnelles)
        const existingEdges = this.adjacency.get(point.id) || [];
        if (!existingEdges.some(e => e.to === neighbor.id)) {
          this.addEdge({
            from: point.id,
            to: neighbor.id,
            distance: neighbor.distance,
          }, true);
        }
      });
    });

    console.log(`📊 A* graph built: ${this.nodes.size} nodes, ${this.countEdges()} edges`);
  }

  /**
   * Trouve les voisins les plus proches d'un point
   */
  findNearestNeighbors(point, allPoints, maxNeighbors, maxDistance) {
    const distances = [];

    allPoints.forEach(other => {
      if (other.id === point.id) return;
      
      const distance = this.haversineDistance(
        point.lat, point.lon,
        other.lat, other.lon
      );

      if (distance <= maxDistance) {
        distances.push({ id: other.id, distance });
      }
    });

    // Trier par distance et prendre les N premiers
    distances.sort((a, b) => a.distance - b.distance);
    return distances.slice(0, maxNeighbors);
  }

  /**
   * Compte le nombre total d'arêtes
   */
  countEdges() {
    let count = 0;
    this.adjacency.forEach(edges => {
      count += edges.length;
    });
    return count / 2; // Arêtes bidirectionnelles comptées 2 fois
  }

  /**
   * Calcule le chemin optimal entre deux points
   * 
   * @param {string} startId - ID du nœud de départ
   * @param {string} endId - ID du nœud d'arrivée
   * @returns {Path|null} Le chemin trouvé ou null
   */
  findPath(startId, endId) {
    const start = this.nodes.get(startId);
    const end = this.nodes.get(endId);

    if (!start || !end) {
      console.error(`Nœuds non trouvés: ${startId} ou ${endId}`);
      return null;
    }

    const openSet = new PriorityQueue();
    const cameFrom = new Map(); // id -> id (nœud précédent)
    const gScore = new Map(); // id -> coût réel depuis le départ
    const fScore = new Map(); // id -> coût estimé total

    // Initialisation
    gScore.set(startId, 0);
    fScore.set(startId, this.heuristic(start, end));
    openSet.push(startId, fScore.get(startId));

    const closedSet = new Set();

    while (!openSet.isEmpty()) {
      const currentId = openSet.pop();

      if (currentId === endId) {
        return this.reconstructPath(cameFrom, currentId, gScore.get(currentId));
      }

      if (closedSet.has(currentId)) continue;
      closedSet.add(currentId);

      const neighbors = this.adjacency.get(currentId) || [];
      
      for (const neighbor of neighbors) {
        if (closedSet.has(neighbor.to)) continue;

        const tentativeGScore = gScore.get(currentId) + neighbor.distance;

        if (!gScore.has(neighbor.to) || tentativeGScore < gScore.get(neighbor.to)) {
          cameFrom.set(neighbor.to, currentId);
          gScore.set(neighbor.to, tentativeGScore);
          
          const neighborNode = this.nodes.get(neighbor.to);
          const f = tentativeGScore + this.heuristic(neighborNode, end);
          fScore.set(neighbor.to, f);
          
          openSet.push(neighbor.to, f);
        }
      }
    }

    // Pas de chemin trouvé
    return null;
  }

  /**
   * Calcule un chemin direct (ligne droite) entre deux coordonnées
   * Utilisé quand il n'y a pas de graphe routier
   * 
   * @param {number} startLat
   * @param {number} startLon
   * @param {number} endLat
   * @param {number} endLon
   * @returns {Path}
   */
  computeDirectPath(startLat, startLon, endLat, endLon) {
    const distance = this.haversineDistance(startLat, startLon, endLat, endLon);
    const duration = Math.round(distance / this.options.walkSpeed);

    return {
      nodes: [
        { id: 'start', lat: startLat, lon: startLon },
        { id: 'end', lat: endLat, lon: endLon },
      ],
      distance: Math.round(distance),
      duration,
      coordinates: [
        [startLon, startLat],
        [endLon, endLat],
      ],
    };
  }

  /**
   * Heuristique A* (distance Haversine)
   */
  heuristic(nodeA, nodeB) {
    return this.haversineDistance(nodeA.lat, nodeA.lon, nodeB.lat, nodeB.lon);
  }

  /**
   * Reconstruit le chemin à partir de la map cameFrom
   */
  reconstructPath(cameFrom, currentId, totalDistance) {
    const path = [];
    let id = currentId;

    while (id) {
      const node = this.nodes.get(id);
      if (node) {
        path.unshift(node);
      }
      id = cameFrom.get(id);
    }

    return {
      nodes: path,
      distance: Math.round(totalDistance),
      duration: Math.round(totalDistance / this.options.walkSpeed),
      coordinates: path.map(n => [n.lon, n.lat]),
    };
  }

  /**
   * Calcule la distance Haversine entre deux points
   */
  haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
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

export default AStarAlgorithm;
