/**
 * store.js
 * Interface de stockage pour la mémoire utilisateur
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 * 
 * Définit l'interface commune pour les différents backends
 * de stockage (SQLite, PostgreSQL, Redis, etc.)
 */

/**
 * @typedef {Object} UserData
 * @property {string} id - ID unique de l'utilisateur
 * @property {string} [deviceId] - ID de l'appareil
 * @property {Date} createdAt - Date de création
 * @property {Date} lastSeenAt - Dernière activité
 * @property {Object} preferences - Préférences utilisateur
 */

/**
 * @typedef {Object} SearchHistory
 * @property {string} id - ID unique
 * @property {string} userId - ID utilisateur
 * @property {string} query - Texte de recherche
 * @property {Object} origin - Lieu de départ
 * @property {Object} destination - Lieu d'arrivée
 * @property {Date} timestamp - Date/heure de la recherche
 * @property {Object} [selectedResult] - Résultat sélectionné
 */

/**
 * @typedef {Object} Favorite
 * @property {string} id - ID unique
 * @property {string} userId - ID utilisateur
 * @property {string} placeId - ID du lieu
 * @property {string} name - Nom personnalisé
 * @property {string} type - Type (home, work, other)
 * @property {Object} place - Données du lieu
 * @property {Date} createdAt - Date d'ajout
 */

/**
 * Interface abstraite pour le stockage
 * À implémenter par les adaptateurs concrets (SQLite, PostgreSQL, etc.)
 */
export class StorageInterface {
  constructor(options = {}) {
    this.options = options;
    this.isConnected = false;
  }

  // === CONNEXION ===

  async connect() {
    throw new Error('Not implemented');
  }

  async disconnect() {
    throw new Error('Not implemented');
  }

  async healthCheck() {
    throw new Error('Not implemented');
  }

  // === UTILISATEURS ===

  async createUser(userData) {
    throw new Error('Not implemented');
  }

  async getUser(userId) {
    throw new Error('Not implemented');
  }

  async getUserByDevice(deviceId) {
    throw new Error('Not implemented');
  }

  async updateUser(userId, updates) {
    throw new Error('Not implemented');
  }

  async deleteUser(userId) {
    throw new Error('Not implemented');
  }

  // === HISTORIQUE ===

  async addSearchHistory(userId, searchData) {
    throw new Error('Not implemented');
  }

  async getSearchHistory(userId, options = {}) {
    throw new Error('Not implemented');
  }

  async clearSearchHistory(userId) {
    throw new Error('Not implemented');
  }

  // === FAVORIS ===

  async addFavorite(userId, favorite) {
    throw new Error('Not implemented');
  }

  async getFavorites(userId) {
    throw new Error('Not implemented');
  }

  async updateFavorite(favoriteId, updates) {
    throw new Error('Not implemented');
  }

  async deleteFavorite(favoriteId) {
    throw new Error('Not implemented');
  }

  // === PRÉFÉRENCES ===

  async getPreferences(userId) {
    throw new Error('Not implemented');
  }

  async updatePreferences(userId, preferences) {
    throw new Error('Not implemented');
  }

  // === STATISTIQUES ===

  async getFrequentStops(userId, limit = 10) {
    throw new Error('Not implemented');
  }

  async recordStopUsage(userId, stopId) {
    throw new Error('Not implemented');
  }

  // === MAINTENANCE ===

  async cleanup(options = {}) {
    throw new Error('Not implemented');
  }

  async anonymizeOldData(daysOld) {
    throw new Error('Not implemented');
  }
}

/**
 * Stockage en mémoire (pour les tests ou environnements sans BDD)
 */
export class InMemoryStore extends StorageInterface {
  constructor(options = {}) {
    super(options);
    this.users = new Map();
    this.searchHistory = new Map(); // userId -> SearchHistory[]
    this.favorites = new Map(); // favoriteId -> Favorite
    this.userFavorites = new Map(); // userId -> Set<favoriteId>
    this.stopUsage = new Map(); // `${userId}_${stopId}` -> count
    this.isConnected = true;
  }

  async connect() {
    this.isConnected = true;
    return true;
  }

  async disconnect() {
    this.isConnected = false;
  }

  async healthCheck() {
    return { status: 'ok', type: 'memory' };
  }

  // === UTILISATEURS ===

  async createUser(userData) {
    const id = userData.id || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const user = {
      id,
      deviceId: userData.deviceId,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      preferences: userData.preferences || {},
    };
    this.users.set(id, user);
    this.searchHistory.set(id, []);
    this.userFavorites.set(id, new Set());
    return user;
  }

  async getUser(userId) {
    return this.users.get(userId) || null;
  }

  async getUserByDevice(deviceId) {
    for (const user of this.users.values()) {
      if (user.deviceId === deviceId) {
        return user;
      }
    }
    return null;
  }

  async updateUser(userId, updates) {
    const user = this.users.get(userId);
    if (!user) return null;
    
    Object.assign(user, updates, { lastSeenAt: new Date() });
    return user;
  }

  async deleteUser(userId) {
    // Supprimer les favoris
    const favIds = this.userFavorites.get(userId) || new Set();
    for (const favId of favIds) {
      this.favorites.delete(favId);
    }
    
    this.users.delete(userId);
    this.searchHistory.delete(userId);
    this.userFavorites.delete(userId);
    
    // Supprimer les stats de stops
    for (const key of this.stopUsage.keys()) {
      if (key.startsWith(`${userId}_`)) {
        this.stopUsage.delete(key);
      }
    }
    
    return true;
  }

  // === HISTORIQUE ===

  async addSearchHistory(userId, searchData) {
    const history = this.searchHistory.get(userId);
    if (!history) return null;

    const entry = {
      id: `search_${Date.now()}`,
      userId,
      ...searchData,
      timestamp: new Date(),
    };

    history.unshift(entry);

    // Limiter la taille
    const maxHistory = this.options.maxRecentSearches || 50;
    if (history.length > maxHistory) {
      history.splice(maxHistory);
    }

    return entry;
  }

  async getSearchHistory(userId, options = {}) {
    const history = this.searchHistory.get(userId) || [];
    const { limit = 20, offset = 0 } = options;
    return history.slice(offset, offset + limit);
  }

  async clearSearchHistory(userId) {
    this.searchHistory.set(userId, []);
    return true;
  }

  // === FAVORIS ===

  async addFavorite(userId, favoriteData) {
    const id = `fav_${Date.now()}`;
    const favorite = {
      id,
      userId,
      ...favoriteData,
      createdAt: new Date(),
    };

    this.favorites.set(id, favorite);
    
    const userFavs = this.userFavorites.get(userId);
    if (userFavs) {
      userFavs.add(id);
    }

    return favorite;
  }

  async getFavorites(userId) {
    const favIds = this.userFavorites.get(userId) || new Set();
    const favorites = [];
    
    for (const favId of favIds) {
      const fav = this.favorites.get(favId);
      if (fav) favorites.push(fav);
    }

    return favorites;
  }

  async updateFavorite(favoriteId, updates) {
    const favorite = this.favorites.get(favoriteId);
    if (!favorite) return null;
    
    Object.assign(favorite, updates);
    return favorite;
  }

  async deleteFavorite(favoriteId) {
    const favorite = this.favorites.get(favoriteId);
    if (!favorite) return false;

    const userFavs = this.userFavorites.get(favorite.userId);
    if (userFavs) {
      userFavs.delete(favoriteId);
    }

    this.favorites.delete(favoriteId);
    return true;
  }

  // === PRÉFÉRENCES ===

  async getPreferences(userId) {
    const user = this.users.get(userId);
    return user?.preferences || {};
  }

  async updatePreferences(userId, preferences) {
    const user = this.users.get(userId);
    if (!user) return null;
    
    user.preferences = { ...user.preferences, ...preferences };
    return user.preferences;
  }

  // === STATISTIQUES ===

  async recordStopUsage(userId, stopId) {
    const key = `${userId}_${stopId}`;
    const current = this.stopUsage.get(key) || 0;
    this.stopUsage.set(key, current + 1);
    return current + 1;
  }

  async getFrequentStops(userId, limit = 10) {
    const stats = [];
    
    for (const [key, count] of this.stopUsage.entries()) {
      if (key.startsWith(`${userId}_`)) {
        const stopId = key.replace(`${userId}_`, '');
        stats.push({ stopId, count });
      }
    }

    return stats
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  // === MAINTENANCE ===

  async cleanup(options = {}) {
    // Pas grand chose à faire en mémoire
    return { cleaned: 0 };
  }

  async anonymizeOldData(daysOld) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    let anonymized = 0;

    for (const user of this.users.values()) {
      if (user.lastSeenAt < cutoff) {
        user.deviceId = null;
        anonymized++;
      }
    }

    return { anonymized };
  }

  /**
   * Export des données pour debug/sauvegarde
   */
  export() {
    return {
      users: Array.from(this.users.values()),
      favorites: Array.from(this.favorites.values()),
      searchHistory: Object.fromEntries(this.searchHistory),
      stopUsage: Object.fromEntries(this.stopUsage),
    };
  }
}

export default StorageInterface;
