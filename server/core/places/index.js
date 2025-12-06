/**
 * core/places/index.js
 * Export principal du module d'autocomplétion de lieux
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 */

import { Trie } from './trie.js';
import { FuzzySearcher, fuzzyMatch, normalizeText } from './fuzzy.js';
import { PlacesIndexer } from './indexer.js';

/**
 * Moteur d'autocomplétion de lieux
 * Combine la recherche par préfixe (Trie) et la recherche floue
 */
export class PlacesEngine {
  /**
   * @param {Array} stops - Arrêts GTFS
   * @param {Object} options - Options de configuration
   */
  constructor(stops = [], options = {}) {
    this.options = {
      maxSuggestions: options.maxSuggestions || 10,
      minQueryLength: options.minQueryLength || 2,
      fuzzyThreshold: options.fuzzyThreshold || 0.4,
      recentBoost: options.recentBoost || 1.5,
      frequencyBoost: options.frequencyBoost || 1.2,
      ...options,
    };

    this.stops = stops;
    this.indexer = new PlacesIndexer();
    this.isReady = false;
  }

  /**
   * Construit l'index de recherche
   */
  async buildIndex() {
    console.log('🔧 Construction de l\'index de places...');
    const startTime = Date.now();

    // Indexer les arrêts GTFS
    this.indexer.indexStops(this.stops);

    // Ajouter les POI par défaut
    this.indexer.addDefaultPOIs();

    // Construire l'index de recherche floue
    this.indexer.rebuildFuzzyIndex();

    this.isReady = true;
    const elapsed = Date.now() - startTime;
    console.log(`✅ Index de places prêt en ${elapsed}ms`);

    this.indexer.logStats();
    return this;
  }

  /**
   * Recherche des lieux par texte
   * 
   * @param {string} query - Texte de recherche
   * @param {Object} options - Options
   * @param {Object} options.userContext - Contexte utilisateur (historique, favoris)
   * @param {Object} options.location - Position actuelle {lat, lon}
   * @returns {Array} Liste de suggestions
   */
  search(query, options = {}) {
    if (!this.isReady) {
      console.warn('PlacesEngine not ready');
      return [];
    }

    if (!query || query.length < this.options.minQueryLength) {
      return [];
    }

    const { userContext, location } = options;
    const normalizedQuery = normalizeText(query);
    const results = new Map(); // id -> {place, score, source}

    // 1. Recherche par préfixe (Trie) - très rapide
    const trieResults = this.indexer.trie.search(normalizedQuery, 20);
    trieResults.forEach(place => {
      results.set(place.id, {
        place,
        score: 1.0, // Score max pour match préfixe
        source: 'trie',
      });
    });

    // 2. Recherche floue si pas assez de résultats
    if (results.size < this.options.maxSuggestions) {
      const fuzzyResults = this.indexer.fuzzySearcher.search(query);
      fuzzyResults.forEach(({ item: place, score }) => {
        if (!results.has(place.id)) {
          results.set(place.id, {
            place,
            score: score * 0.9, // Légèrement moins bon que le préfixe
            source: 'fuzzy',
          });
        }
      });
    }

    // 3. Appliquer les boosts utilisateur
    if (userContext) {
      this.applyUserBoosts(results, userContext);
    }

    // 4. Appliquer le boost de proximité
    if (location) {
      this.applyProximityBoost(results, location);
    }

    // 5. Trier par score et limiter
    const sorted = Array.from(results.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, this.options.maxSuggestions);

    // 6. Formater les résultats
    return sorted.map(({ place, score }) => this.formatSuggestion(place, score));
  }

  /**
   * Applique les boosts basés sur l'historique utilisateur
   */
  applyUserBoosts(results, userContext) {
    const { recentSearches = [], favorites = [], frequentStops = {} } = userContext;

    results.forEach((result, id) => {
      // Boost pour les favoris
      if (favorites.includes(id)) {
        result.score *= 2.0;
        result.isFavorite = true;
      }

      // Boost pour les recherches récentes
      const recentIndex = recentSearches.findIndex(r => r.placeId === id);
      if (recentIndex !== -1) {
        // Plus récent = plus de boost
        const recencyBoost = this.options.recentBoost * (1 - recentIndex / recentSearches.length);
        result.score *= recencyBoost;
        result.isRecent = true;
      }

      // Boost pour les arrêts fréquemment utilisés
      if (frequentStops[id]) {
        const frequencyBoost = 1 + (Math.log(frequentStops[id]) / 10) * this.options.frequencyBoost;
        result.score *= frequencyBoost;
      }
    });
  }

  /**
   * Applique un boost basé sur la proximité géographique
   */
  applyProximityBoost(results, location) {
    results.forEach(result => {
      const distance = this.haversineDistance(
        location.lat, location.lon,
        result.place.lat, result.place.lon
      );

      // Boost inversement proportionnel à la distance
      // Max boost (1.3x) à 0m, pas de boost au-delà de 5km
      if (distance < 5000) {
        const proximityBoost = 1 + (0.3 * (1 - distance / 5000));
        result.score *= proximityBoost;
        result.distance = Math.round(distance);
      }
    });
  }

  /**
   * Formate une suggestion pour l'API
   */
  formatSuggestion(place, score) {
    const suggestion = {
      id: place.id,
      type: place.type,
      name: place.name,
      lat: place.lat,
      lon: place.lon,
      score: Math.round(score * 100) / 100,
    };

    // Ajouter des infos supplémentaires selon le type
    if (place.type === 'stop') {
      suggestion.stopId = place.metadata?.stopId;
      suggestion.icon = 'bus';
    } else if (place.type === 'poi') {
      suggestion.category = place.metadata?.category;
      suggestion.icon = this.getCategoryIcon(place.metadata?.category);
    }

    return suggestion;
  }

  /**
   * Retourne l'icône pour une catégorie de POI
   */
  getCategoryIcon(category) {
    const icons = {
      transport: 'train',
      education: 'school',
      sante: 'hospital',
      commerce: 'shopping_cart',
      loisirs: 'sports_soccer',
      administration: 'account_balance',
      tourisme: 'museum',
    };
    return icons[category] || 'place';
  }

  /**
   * Recherche les lieux à proximité d'une position
   * 
   * @param {number} lat
   * @param {number} lon
   * @param {Object} options
   * @returns {Array}
   */
  searchNearby(lat, lon, options = {}) {
    const { radius = 500, types = null, limit = 10 } = options;

    let results = this.indexer.findNearby(lat, lon, radius);

    // Filtrer par type si spécifié
    if (types && types.length > 0) {
      results = results.filter(r => types.includes(r.place.type));
    }

    // Limiter
    results = results.slice(0, limit);

    // Formater
    return results.map(({ place, distance }) => ({
      ...this.formatSuggestion(place, 1),
      distance,
    }));
  }

  /**
   * Obtient un lieu par son ID
   */
  getPlace(placeId) {
    return this.indexer.places.get(placeId);
  }

  /**
   * Ajoute un lieu personnalisé
   */
  addCustomPlace(place) {
    this.indexer.addPlace({
      id: place.id || `custom_${Date.now()}`,
      type: place.type || 'poi',
      name: place.name,
      lat: place.lat,
      lon: place.lon,
      metadata: place.metadata || {},
    });
    this.indexer.rebuildFuzzyIndex();
  }

  /**
   * Calcule la distance Haversine
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

  /**
   * Statistiques du moteur
   */
  getStats() {
    return {
      ready: this.isReady,
      ...this.indexer.stats,
      trieStats: this.indexer.trie.stats(),
    };
  }
}

// Exports
export { Trie } from './trie.js';
export { FuzzySearcher, fuzzyMatch, fuzzySearch, normalizeText } from './fuzzy.js';
export { PlacesIndexer } from './indexer.js';

export default PlacesEngine;
