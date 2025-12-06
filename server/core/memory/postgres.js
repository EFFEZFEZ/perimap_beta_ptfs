/**
 * postgres.js
 * Adaptateur PostgreSQL pour la mémoire utilisateur
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 * 
 * PostgreSQL est recommandé pour:
 * - Production avec plusieurs serveurs
 * - Grandes quantités de données
 * - Requêtes complexes
 * - Extensions géographiques (PostGIS)
 */

import { StorageInterface } from './store.js';

/**
 * Adaptateur PostgreSQL
 * Utilise pg (node-postgres)
 */
export class PostgresStore extends StorageInterface {
  /**
   * @param {string} connectionString - URL de connexion PostgreSQL
   * @param {Object} options - Options de configuration
   */
  constructor(connectionString, options = {}) {
    super(options);
    this.connectionString = connectionString;
    this.pool = null;
    this.options = {
      maxRecentSearches: 50,
      maxFavorites: 20,
      poolMin: 2,
      poolMax: 10,
      ...options,
    };
  }

  /**
   * Connexion à la base de données
   */
  async connect() {
    // NOTE: En production, décommenter et installer pg
    /*
    const { Pool } = await import('pg');
    
    this.pool = new Pool({
      connectionString: this.connectionString,
      min: this.options.poolMin,
      max: this.options.poolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Tester la connexion
    const client = await this.pool.connect();
    client.release();
    */

    // Créer les tables
    await this.createTables();
    
    this.isConnected = true;
    console.log(`🐘 PostgreSQL connecté`);
    return true;
  }

  /**
   * Fermeture de la connexion
   */
  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.isConnected = false;
  }

  /**
   * Vérification de santé
   */
  async healthCheck() {
    if (!this.pool) {
      return { status: 'error', message: 'Not connected' };
    }
    
    try {
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW()');
      client.release();
      return { 
        status: 'ok', 
        type: 'postgresql',
        serverTime: result.rows[0].now 
      };
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  }

  /**
   * Création des tables
   */
  async createTables() {
    const schema = `
      -- Extension pour UUID si nécessaire
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      -- Utilisateurs
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
        device_id TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ DEFAULT NOW(),
        preferences JSONB DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_users_device ON users(device_id);
      CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);

      -- Historique de recherche
      CREATE TABLE IF NOT EXISTS search_history (
        id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        query TEXT,
        origin JSONB,
        destination JSONB,
        selected_result JSONB,
        timestamp TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_search_user ON search_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_search_time ON search_history(timestamp DESC);

      -- Favoris
      CREATE TABLE IF NOT EXISTS favorites (
        id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        place_id TEXT NOT NULL,
        name TEXT,
        type TEXT DEFAULT 'other',
        place_data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, place_id)
      );
      CREATE INDEX IF NOT EXISTS idx_fav_user ON favorites(user_id);

      -- Statistiques d'utilisation des arrêts
      CREATE TABLE IF NOT EXISTS stop_usage (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stop_id TEXT NOT NULL,
        count INTEGER DEFAULT 1,
        last_used TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, stop_id)
      );
      CREATE INDEX IF NOT EXISTS idx_stop_usage_count ON stop_usage(user_id, count DESC);

      -- Sessions (optionnel, pour auth JWT)
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        last_used_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `;

    // NOTE: En production, exécuter le schema
    /*
    await this.pool.query(schema);
    */
    
    console.log('📊 Tables PostgreSQL créées');
  }

  /**
   * Helper pour exécuter des requêtes
   */
  async query(text, params = []) {
    /*
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result;
    } finally {
      client.release();
    }
    */
    return { rows: [], rowCount: 0 };
  }

  // === UTILISATEURS ===

  async createUser(userData) {
    const id = userData.id || null; // Laisser PostgreSQL générer si null
    
    /*
    const result = await this.query(`
      INSERT INTO users (${id ? 'id, ' : ''}device_id, preferences)
      VALUES (${id ? '$1, $2, $3' : '$1, $2'})
      RETURNING *
    `, id ? [id, userData.deviceId, userData.preferences || {}] 
         : [userData.deviceId, userData.preferences || {}]);

    const row = result.rows[0];
    return {
      id: row.id,
      deviceId: row.device_id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      preferences: row.preferences,
    };
    */
    return { id: 'test', ...userData, createdAt: new Date(), lastSeenAt: new Date() };
  }

  async getUser(userId) {
    /*
    const result = await this.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      id: row.id,
      deviceId: row.device_id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      preferences: row.preferences,
    };
    */
    return null;
  }

  async getUserByDevice(deviceId) {
    /*
    const result = await this.query(
      'SELECT * FROM users WHERE device_id = $1',
      [deviceId]
    );

    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      id: row.id,
      deviceId: row.device_id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      preferences: row.preferences,
    };
    */
    return null;
  }

  async updateUser(userId, updates) {
    /*
    const sets = ['last_seen_at = NOW()'];
    const values = [];
    let paramIndex = 1;

    if (updates.deviceId !== undefined) {
      sets.push(`device_id = $${paramIndex++}`);
      values.push(updates.deviceId);
    }
    if (updates.preferences !== undefined) {
      sets.push(`preferences = $${paramIndex++}`);
      values.push(updates.preferences);
    }

    values.push(userId);

    await this.query(`
      UPDATE users SET ${sets.join(', ')} WHERE id = $${paramIndex}
    `, values);
    */
    
    return this.getUser(userId);
  }

  async deleteUser(userId) {
    /*
    const result = await this.query('DELETE FROM users WHERE id = $1', [userId]);
    return result.rowCount > 0;
    */
    return true;
  }

  // === HISTORIQUE ===

  async addSearchHistory(userId, searchData) {
    /*
    const result = await this.query(`
      INSERT INTO search_history (user_id, query, origin, destination, selected_result)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      userId,
      searchData.query,
      searchData.origin,
      searchData.destination,
      searchData.selectedResult,
    ]);

    // Nettoyer les anciennes entrées
    await this.query(`
      DELETE FROM search_history
      WHERE user_id = $1 AND id NOT IN (
        SELECT id FROM search_history
        WHERE user_id = $1
        ORDER BY timestamp DESC
        LIMIT $2
      )
    `, [userId, this.options.maxRecentSearches]);

    return result.rows[0];
    */
    return { id: 'test', userId, ...searchData, timestamp: new Date() };
  }

  async getSearchHistory(userId, options = {}) {
    const { limit = 20, offset = 0 } = options;
    
    /*
    const result = await this.query(`
      SELECT * FROM search_history
      WHERE user_id = $1
      ORDER BY timestamp DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);

    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      query: row.query,
      origin: row.origin,
      destination: row.destination,
      selectedResult: row.selected_result,
      timestamp: row.timestamp,
    }));
    */
    
    return [];
  }

  async clearSearchHistory(userId) {
    /*
    await this.query('DELETE FROM search_history WHERE user_id = $1', [userId]);
    */
    return true;
  }

  // === FAVORIS ===

  async addFavorite(userId, favoriteData) {
    /*
    const result = await this.query(`
      INSERT INTO favorites (user_id, place_id, name, type, place_data)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, place_id) DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        place_data = EXCLUDED.place_data
      RETURNING *
    `, [
      userId,
      favoriteData.placeId,
      favoriteData.name,
      favoriteData.type || 'other',
      favoriteData.place,
    ]);

    return result.rows[0];
    */
    return { id: 'test', userId, ...favoriteData, createdAt: new Date() };
  }

  async getFavorites(userId) {
    /*
    const result = await this.query(`
      SELECT * FROM favorites WHERE user_id = $1 ORDER BY created_at DESC
    `, [userId]);

    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      placeId: row.place_id,
      name: row.name,
      type: row.type,
      place: row.place_data,
      createdAt: row.created_at,
    }));
    */
    
    return [];
  }

  async updateFavorite(favoriteId, updates) {
    /*
    const sets = [];
    const values = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      sets.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.type !== undefined) {
      sets.push(`type = $${paramIndex++}`);
      values.push(updates.type);
    }

    values.push(favoriteId);

    if (sets.length > 0) {
      await this.query(`
        UPDATE favorites SET ${sets.join(', ')} WHERE id = $${paramIndex}
      `, values);
    }

    const result = await this.query('SELECT * FROM favorites WHERE id = $1', [favoriteId]);
    return result.rows[0];
    */
    
    return null;
  }

  async deleteFavorite(favoriteId) {
    /*
    const result = await this.query('DELETE FROM favorites WHERE id = $1', [favoriteId]);
    return result.rowCount > 0;
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
    await this.query(`
      UPDATE users SET preferences = preferences || $1 WHERE id = $2
    `, [preferences, userId]);
    
    return this.getPreferences(userId);
    */
    return preferences;
  }

  // === STATISTIQUES ===

  async recordStopUsage(userId, stopId) {
    /*
    const result = await this.query(`
      INSERT INTO stop_usage (user_id, stop_id, count, last_used)
      VALUES ($1, $2, 1, NOW())
      ON CONFLICT (user_id, stop_id) DO UPDATE SET
        count = stop_usage.count + 1,
        last_used = NOW()
      RETURNING count
    `, [userId, stopId]);

    return result.rows[0].count;
    */
    return 1;
  }

  async getFrequentStops(userId, limit = 10) {
    /*
    const result = await this.query(`
      SELECT stop_id, count, last_used
      FROM stop_usage
      WHERE user_id = $1
      ORDER BY count DESC, last_used DESC
      LIMIT $2
    `, [userId, limit]);

    return result.rows.map(row => ({
      stopId: row.stop_id,
      count: row.count,
      lastUsed: row.last_used,
    }));
    */
    return [];
  }

  // === MAINTENANCE ===

  async cleanup(options = {}) {
    const { daysOld = 90 } = options;
    
    /*
    const result = await this.query(`
      DELETE FROM search_history
      WHERE timestamp < NOW() - INTERVAL '${daysOld} days'
    `);

    // Vacuum analyze pour optimiser
    await this.query('VACUUM ANALYZE search_history');
    await this.query('VACUUM ANALYZE stop_usage');
    
    return { cleaned: result.rowCount };
    */
    return { cleaned: 0 };
  }

  async anonymizeOldData(daysOld) {
    /*
    const result = await this.query(`
      UPDATE users
      SET device_id = NULL
      WHERE last_seen_at < NOW() - INTERVAL '${daysOld} days'
        AND device_id IS NOT NULL
    `);

    return { anonymized: result.rowCount };
    */
    return { anonymized: 0 };
  }

  /**
   * Statistiques de la base de données
   */
  async getDbStats() {
    /*
    const result = await this.query(`
      SELECT
        (SELECT COUNT(*) FROM users) as users_count,
        (SELECT COUNT(*) FROM search_history) as searches_count,
        (SELECT COUNT(*) FROM favorites) as favorites_count,
        (SELECT COUNT(*) FROM stop_usage) as stop_usage_count,
        pg_database_size(current_database()) as db_size
    `);

    return result.rows[0];
    */
    return {};
  }
}

export default PostgresStore;
