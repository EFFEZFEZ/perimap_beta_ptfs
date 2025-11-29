/**
 * logger.js - Système de logging centralisé
 * 
 * Permet d'activer/désactiver les logs de debug facilement.
 * En production, seuls les erreurs et warnings sont affichés.
 */

// Mode debug activé par défaut en développement
const DEBUG = window.location.hostname === 'localhost' || 
              window.location.hostname === '127.0.0.1' ||
              localStorage.getItem('perimap_debug') === 'true';

// Niveaux de log
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

// Niveau actuel (en prod, on ne montre que WARN et ERROR)
const currentLevel = DEBUG ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN;

/**
 * Log de debug (uniquement en mode développement)
 */
export function debug(...args) {
    if (currentLevel <= LOG_LEVELS.DEBUG) {
        console.log('[DEBUG]', ...args);
    }
}

/**
 * Log d'information
 */
export function info(...args) {
    if (currentLevel <= LOG_LEVELS.INFO) {
        console.log('[INFO]', ...args);
    }
}

/**
 * Log d'avertissement
 */
export function warn(...args) {
    if (currentLevel <= LOG_LEVELS.WARN) {
        console.warn('[WARN]', ...args);
    }
}

/**
 * Log d'erreur
 */
export function error(...args) {
    if (currentLevel <= LOG_LEVELS.ERROR) {
        console.error('[ERROR]', ...args);
    }
}

/**
 * Log de performance (timing)
 */
export function timing(label, startTime) {
    if (currentLevel <= LOG_LEVELS.DEBUG) {
        const duration = performance.now() - startTime;
        console.log(`[TIMING] ${label}: ${duration.toFixed(2)}ms`);
    }
}

/**
 * Active/désactive le mode debug
 */
export function setDebug(enabled) {
    if (enabled) {
        localStorage.setItem('perimap_debug', 'true');
    } else {
        localStorage.removeItem('perimap_debug');
    }
    console.log(`[LOGGER] Mode debug ${enabled ? 'activé' : 'désactivé'}. Rechargez la page.`);
}

/**
 * Vérifie si le mode debug est actif
 */
export function isDebug() {
    return DEBUG;
}

// Export par défaut
export default {
    debug,
    info,
    warn,
    error,
    timing,
    setDebug,
    isDebug
};
