/**
 * sqlite.js
 * Adaptateur SQLite pour la mémoire utilisateur
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 * 
 * SQLite est idéal pour:
 * - Déploiements simples (fichier unique)
 * - Pas de serveur de BDD séparé
 * - Performances excellentes en lecture
 * - Backup facile (copie du fichier)
 */

import { StorageInterface } from './store.js';

/**
 * Adaptateur SQLite avec better-sqlite3
 */
export class SQLiteStore extends StorageInterface {
  /**
   * @param {string} dbPath - Chemin vers le fichier SQLite
   * @param {Object} options - Options de configuration
   */
  constructor(dbPath, options = {}) {
    super(options);
    this.dbPath = dbPath;
    this.db = null;
    this.options = {
      maxRecentSearches: 50,
      maxFavorites: 20,
      ...options,
    };
  }

  /**
   * Connexion à la base de données
   */
  async connect() {
    // NOTE: En production, décommenter et installer better-sqlite3
    /*
    const Database = (await import('better-sqlite3')).default;
    this.db = new Database(this.dbPath);
    
    // Optimisations SQLite
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
    this.db.pragma('temp_store = MEMORY');
    */

    // Créer les tables
    await this.createTables();
    
    this.isConnected = true;
    console.log(`📦 SQLite connecté: ${this.dbPath}`);
    return true;
  }

  /**
   * Fermeture de la connexion
   */
  async disconnect() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.isConnected = false;
  }

  /**
   * Vérification de santé
   */
  async healthCheck() {
    if (!this.db) {
      return { status: 'error', message: 'Not connected' };
    }
    
    try {
      const result = this.db.prepare('SELECT 1').get();
      return { status: 'ok', type: 'sqlite', path: this.dbPath };
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  }

  /**
   * Création des tables
   */
  async createTables() {
    const schema = `
      -- Utilisateurs
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        device_id TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        preferences TEXT DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_users_device ON users(device_id);

      -- Historique de recherche
      CREATE TABLE IF NOT EXISTS search_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        query TEXT,
        origin_name TEXT,
        origin_lat REAL,
        origin_lon REAL,
        origin_id TEXT,
        dest_name TEXT,
        dest_lat REAL,
        dest_lon REAL,
        dest_id TEXT,
        selected_result TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_search_user ON search_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_search_time ON search_history(timestamp DESC);

      -- Favoris
      CREATE TABLE IF NOT EXISTS favorites (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        place_id TEXT NOT NULL,
        name TEXT,
        type TEXT DEFAULT 'other',
        place_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_fav_user ON favorites(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_fav_user_place ON favorites(user_id, place_id);

      -- Statistiques d'utilisation des arrêts
      CREATE TABLE IF NOT EXISTS stop_usage (
        user_id TEXT NOT NULL,
        stop_id TEXT NOT NULL,
        count INTEGER DEFAULT 1,
        last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, stop_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `;

    // NOTE: En production, exécuter chaque statement
    /*
    const statements = schema.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      this.db.exec(stmt);
    }
    */
    
    console.log('📊 Tables SQLite créées');
  }

  // === UTILISATEURS ===

  async createUser(userData) {
    const id = userData.id || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    /*
    const stmt = this.db.prepare(`
      INSERT INTO users (id, device_id, preferences)
      VALUES (?, ?, ?)
    `);
    
    stmt.run(
      id,
      userData.deviceId || null,
      JSON.stringify(userData.preferences || {})
    );
    */

    return this.getUser(id);
  }

  async getUser(userId) {
    /*
    const stmt = this.db.prepare(`
      SELECT id, device_id, created_at, last_seen_at, preferences
      FROM users WHERE id = ?
    `);
    
    const row = stmt.get(userId);
    if (!row) return null;

    return {
      id: row.id,
      deviceId: row.device_id,
      createdAt: new Date(row.created_at),
      lastSeenAt: new Date(row.last_seen_at),
      preferences: JSON.parse(row.preferences || '{}'),
    };
    */
    return null;
  }

  async getUserByDevice(deviceId) {
    /*
    const stmt = this.db.prepare(`
      SELECT id, device_id, created_at, last_seen_at, preferences
      FROM users WHERE device_id = ?
    `);
    
    const row = stmt.get(deviceId);
    if (!row) return null;

    return {
      id: row.id,
      deviceId: row.device_id,
      createdAt: new Date(row.created_at),
      lastSeenAt: new Date(row.last_seen_at),
      preferences: JSON.parse(row.preferences || '{}'),
    };
    */
    return null;
  }

  async updateUser(userId, updates) {
    /*
    const sets = [];
    const values = [];

    if (updates.deviceId !== undefined) {
      sets.push('device_id = ?');
      values.push(updates.deviceId);
    }
    if (updates.preferences !== undefined) {
      sets.push('preferences = ?');
      values.push(JSON.stringify(updates.preferences));
    }

    sets.push('last_seen_at = CURRENT_TIMESTAMP');
    values.push(userId);

    const stmt = this.db.prepare(`
      UPDATE users SET ${sets.join(', ')} WHERE id = ?
    `);
    
    stmt.run(...values);
    */
    
    return this.getUser(userId);
  }

  async deleteUser(userId) {
    /*
    const stmt = this.db.prepare('DELETE FROM users WHERE id = ?');
    const result = stmt.run(userId);
    return result.changes > 0;
    */
    return true;
  }

  // === HISTORIQUE ===

  async addSearchHistory(userId, searchData) {
    const id = `search_${Date.now()}`;
    
    /*
    const stmt = this.db.prepare(`
      INSERT INTO search_history (
        id, user_id, query,
        origin_name, origin_lat, origin_lon, origin_id,
        dest_name, dest_lat, dest_lon, dest_id,
        selected_result
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      userId,
      searchData.query || null,
      searchData.origin?.name || null,
      searchData.origin?.lat || null,
      searchData.origin?.lon || null,
      searchData.origin?.id || null,
      searchData.destination?.name || null,
      searchData.destination?.lat || null,
      searchData.destination?.lon || null,
      searchData.destination?.id || null,
      searchData.selectedResult ? JSON.stringify(searchData.selectedResult) : null
    );

    // Nettoyer les anciennes entrées
    this.db.prepare(`
      DELETE FROM search_history
      WHERE user_id = ? AND id NOT IN (
        SELECT id FROM search_history
        WHERE user_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      )
    `).run(userId, userId, this.options.maxRecentSearches);
    */

    return { id, userId, ...searchData, timestamp: new Date() };
  }

  async getSearchHistory(userId, options = {}) {
    const { limit = 20, offset = 0 } = options;
    
    /*
    const stmt = this.db.prepare(`
      SELECT * FROM search_history
      WHERE user_id = ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(userId, limit, offset);
    
    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      query: row.query,
      origin: row.origin_name ? {
        name: row.origin_name,
        lat: row.origin_lat,
        lon: row.origin_lon,
        id: row.origin_id,
      } : null,
      destination: row.dest_name ? {
        name: row.dest_name,
        lat: row.dest_lat,
        lon: row.dest_lon,
        id: row.dest_id,
      } : null,
      selectedResult: row.selected_result ? JSON.parse(row.selected_result) : null,
      timestamp: new Date(row.timestamp),
    }));
    */
    
    return [];
  }

  async clearSearchHistory(userId) {
    /*
    const stmt = this.db.prepare('DELETE FROM search_history WHERE user_id = ?');
    stmt.run(userId);
    */
    return true;
  }

  // === FAVORIS ===

  async addFavorite(userId, favoriteData) {
    const id = `fav_${Date.now()}`;
    
    /*
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO favorites (id, user_id, place_id, name, type, place_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      userId,
      favoriteData.placeId,
      favoriteData.name || null,
      favoriteData.type || 'other',
      favoriteData.place ? JSON.stringify(favoriteData.place) : null
    );
    */

    return { id, userId, ...favoriteData, createdAt: new Date() };
  }

  async getFavorites(userId) {
    /*
    const stmt = this.db.prepare(`
      SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC
    `);

    const rows = stmt.all(userId);
    
    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      placeId: row.place_id,
      name: row.name,
      type: row.type,
      place: row.place_data ? JSON.parse(row.place_data) : null,
      createdAt: new Date(row.created_at),
    }));
    */
    
    return [];
  }

  async updateFavorite(favoriteId, updates) {
    /*
    const sets = [];
    const values = [];

    if (updates.name !== undefined) {
      sets.push('name = ?');
      values.push(updates.name);
    }
    if (updates.type !== undefined) {
      sets.push('type = ?');
      values.push(updates.type);
    }

    values.push(favoriteId);

    if (sets.length > 0) {
      const stmt = this.db.prepare(`
        UPDATE favorites SET ${sets.join(', ')} WHERE id = ?
      `);
      stmt.run(...values);
    }

    return this.db.prepare('SELECT * FROM favorites WHERE id = ?').get(favoriteId);
    */
    
    return null;
  }

  async deleteFavorite(favoriteId) {
    /*
    const stmt = this.db.prepare('DELETE FROM favorites WHERE id = ?');
    const result = stmt.run(favoriteId);
    return result.changes > 0;
    */
    return true;
  }

  // === PRÉFÉRENCES ===

  async getPreferences(userId) {
    const user = await this.getUser(userId);
    return user?.preferences || {};
  }

  async updatePreferences(userId, preferences) {
    /*
    const current = await this.getPreferences(userId);
    const merged = { ...current, ...preferences };
    
    const stmt = this.db.prepare(`
      UPDATE users SET preferences = ? WHERE id = ?
    `);
    stmt.run(JSON.stringify(merged), userId);
    
    return merged;
    */
    return preferences;
  }

  // === STATISTIQUES ===

  async recordStopUsage(userId, stopId) {
    /*
    const stmt = this.db.prepare(`
      INSERT INTO stop_usage (user_id, stop_id, count, last_used)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, stop_id) DO UPDATE SET
        count = count + 1,
        last_used = CURRENT_TIMESTAMP
    `);
    
    stmt.run(userId, stopId);
    
    const result = this.db.prepare(`
      SELECT count FROM stop_usage WHERE user_id = ? AND stop_id = ?
    `).get(userId, stopId);
    
    return result?.count || 1;
    */
    return 1;
  }

  async getFrequentStops(userId, limit = 10) {
    /*
    const stmt = this.db.prepare(`
      SELECT stop_id, count, last_used
      FROM stop_usage
      WHERE user_id = ?
      ORDER BY count DESC, last_used DESC
      LIMIT ?
    `);

    const rows = stmt.all(userId, limit);
    
    return rows.map(row => ({
      stopId: row.stop_id,
      count: row.count,
      lastUsed: new Date(row.last_used),
    }));
    */
    return [];
  }

  // === MAINTENANCE ===

  async cleanup(options = {}) {
    const { daysOld = 90 } = options;
    
    /*
    // Supprimer les recherches anciennes au-delà de la limite
    const deleted = this.db.prepare(`
      DELETE FROM search_history
      WHERE timestamp < datetime('now', '-' || ? || ' days')
    `).run(daysOld);

    // Vacuum la base
    this.db.exec('VACUUM');
    
    return { cleaned: deleted.changes };
    */
    return { cleaned: 0 };
  }

  async anonymizeOldData(daysOld) {
    /*
    const result = this.db.prepare(`
      UPDATE users
      SET device_id = NULL
      WHERE last_seen_at < datetime('now', '-' || ? || ' days')
        AND device_id IS NOT NULL
    `).run(daysOld);

    return { anonymized: result.changes };
    */
    return { anonymized: 0 };
  }
}

export default SQLiteStore;
