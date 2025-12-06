/**
 * utils/cache.js
 * Système de cache en mémoire
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 */

/**
 * Cache LRU (Least Recently Used) simple
 */
export class LRUCache {
  /**
   * @param {number} maxSize - Nombre max d'entrées
   * @param {number} ttlMs - Durée de vie des entrées (ms)
   */
  constructor(maxSize = 1000, ttlMs = 3600000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  /**
   * Obtient une valeur du cache
   * @param {string} key
   * @returns {*} Valeur ou undefined
   */
  get(key) {
    const entry = this.cache.get(key);
    
    if (!entry) return undefined;

    // Vérifier l'expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // LRU: déplacer à la fin (le plus récent)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Stocke une valeur dans le cache
   * @param {string} key
   * @param {*} value
   * @param {number} [customTtlMs] - TTL personnalisé
   */
  set(key, value, customTtlMs = null) {
    // Supprimer si déjà existant
    this.cache.delete(key);

    // Éviction si plein (supprimer le plus ancien)
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (customTtlMs || this.ttlMs),
    });
  }

  /**
   * Supprime une entrée
   * @param {string} key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Vérifie si une clé existe (et n'est pas expirée)
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== undefined;
  }

  /**
   * Vide le cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Nettoie les entrées expirées
   * @returns {number} Nombre d'entrées supprimées
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Taille actuelle du cache
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Statistiques du cache
   */
  stats() {
    let expired = 0;
    const now = Date.now();

    for (const entry of this.cache.values()) {
      if (now > entry.expiresAt) expired++;
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      expired,
      ttlMs: this.ttlMs,
    };
  }
}

/**
 * Cache pour les itinéraires
 * Clé basée sur origine, destination, et heure arrondie
 */
export class RouteCache extends LRUCache {
  constructor(options = {}) {
    super(
      options.maxSize || 500,
      options.ttlMs || 5 * 60 * 1000 // 5 minutes par défaut
    );
    this.roundMinutes = options.roundMinutes || 5;
  }

  /**
   * Génère une clé de cache pour un itinéraire
   */
  generateKey(origin, destination, time) {
    // Arrondir l'heure aux X minutes
    const roundedTime = new Date(time);
    roundedTime.setMinutes(
      Math.floor(roundedTime.getMinutes() / this.roundMinutes) * this.roundMinutes,
      0, 0
    );

    const parts = [
      origin.lat.toFixed(4),
      origin.lon.toFixed(4),
      destination.lat.toFixed(4),
      destination.lon.toFixed(4),
      roundedTime.getTime(),
    ];

    return parts.join('_');
  }

  /**
   * Obtient un itinéraire en cache
   */
  getRoute(origin, destination, time) {
    const key = this.generateKey(origin, destination, time);
    return this.get(key);
  }

  /**
   * Stocke un itinéraire
   */
  setRoute(origin, destination, time, itineraries) {
    const key = this.generateKey(origin, destination, time);
    this.set(key, itineraries);
  }
}

/**
 * Cache pour les suggestions de lieux
 */
export class PlacesCache extends LRUCache {
  constructor(options = {}) {
    super(
      options.maxSize || 1000,
      options.ttlMs || 60 * 60 * 1000 // 1 heure par défaut
    );
  }

  /**
   * Génère une clé normalisée pour une requête
   */
  normalizeQuery(query) {
    return query
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Obtient les suggestions en cache
   */
  getSuggestions(query) {
    const key = this.normalizeQuery(query);
    return this.get(key);
  }

  /**
   * Stocke les suggestions
   */
  setSuggestions(query, suggestions) {
    const key = this.normalizeQuery(query);
    this.set(key, suggestions);
  }
}

/**
 * Gestionnaire de cache global
 */
export class CacheManager {
  constructor(options = {}) {
    this.options = {
      routeCacheSize: 500,
      routeTtl: 5 * 60 * 1000,
      placesCacheSize: 1000,
      placesTtl: 60 * 60 * 1000,
      cleanupInterval: 5 * 60 * 1000,
      ...options,
    };

    this.routeCache = new RouteCache({
      maxSize: this.options.routeCacheSize,
      ttlMs: this.options.routeTtl,
    });

    this.placesCache = new PlacesCache({
      maxSize: this.options.placesCacheSize,
      ttlMs: this.options.placesTtl,
    });

    // Nettoyage périodique
    this.cleanupTimer = setInterval(
      () => this.cleanup(),
      this.options.cleanupInterval
    );
  }

  /**
   * Nettoie tous les caches
   */
  cleanup() {
    const routeCleaned = this.routeCache.cleanup();
    const placesCleaned = this.placesCache.cleanup();
    
    if (routeCleaned > 0 || placesCleaned > 0) {
      console.log(`🧹 Cache cleanup: ${routeCleaned} routes, ${placesCleaned} places`);
    }
  }

  /**
   * Vide tous les caches
   */
  clearAll() {
    this.routeCache.clear();
    this.placesCache.clear();
  }

  /**
   * Arrête le nettoyage périodique
   */
  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Statistiques de tous les caches
   */
  stats() {
    return {
      routes: this.routeCache.stats(),
      places: this.placesCache.stats(),
    };
  }
}

export default {
  LRUCache,
  RouteCache,
  PlacesCache,
  CacheManager,
};
