/**
 * utils/logger.js
 * Système de logging
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 */

/**
 * Niveaux de log
 */
export const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/**
 * Couleurs ANSI pour le terminal
 */
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

/**
 * Logger simple
 */
export class Logger {
  /**
   * @param {string} name - Nom du module
   * @param {Object} options - Options
   */
  constructor(name, options = {}) {
    this.name = name;
    this.level = LOG_LEVELS[options.level || 'info'];
    this.useColors = options.useColors !== false;
    this.timestamps = options.timestamps !== false;
  }

  /**
   * Formate un message de log
   */
  format(level, message, ...args) {
    const parts = [];

    // Timestamp
    if (this.timestamps) {
      const now = new Date().toISOString();
      parts.push(this.useColors ? `${COLORS.gray}${now}${COLORS.reset}` : now);
    }

    // Niveau
    const levelColors = {
      error: COLORS.red,
      warn: COLORS.yellow,
      info: COLORS.green,
      debug: COLORS.blue,
    };
    const levelStr = level.toUpperCase().padEnd(5);
    parts.push(this.useColors 
      ? `${levelColors[level]}${levelStr}${COLORS.reset}` 
      : levelStr
    );

    // Nom du module
    parts.push(this.useColors 
      ? `${COLORS.bold}[${this.name}]${COLORS.reset}` 
      : `[${this.name}]`
    );

    // Message
    parts.push(message);

    // Arguments supplémentaires
    if (args.length > 0) {
      for (const arg of args) {
        if (typeof arg === 'object') {
          parts.push(JSON.stringify(arg, null, 2));
        } else {
          parts.push(String(arg));
        }
      }
    }

    return parts.join(' ');
  }

  /**
   * Log un message d'erreur
   */
  error(message, ...args) {
    if (this.level >= LOG_LEVELS.error) {
      console.error(this.format('error', message, ...args));
    }
  }

  /**
   * Log un avertissement
   */
  warn(message, ...args) {
    if (this.level >= LOG_LEVELS.warn) {
      console.warn(this.format('warn', message, ...args));
    }
  }

  /**
   * Log une information
   */
  info(message, ...args) {
    if (this.level >= LOG_LEVELS.info) {
      console.info(this.format('info', message, ...args));
    }
  }

  /**
   * Log un message de debug
   */
  debug(message, ...args) {
    if (this.level >= LOG_LEVELS.debug) {
      console.debug(this.format('debug', message, ...args));
    }
  }

  /**
   * Crée un sous-logger avec un nom étendu
   */
  child(subName) {
    return new Logger(`${this.name}:${subName}`, {
      level: Object.keys(LOG_LEVELS)[this.level],
      useColors: this.useColors,
      timestamps: this.timestamps,
    });
  }
}

/**
 * Crée un logger
 * @param {string} name - Nom du module
 * @param {Object} options - Options
 * @returns {Logger}
 */
export function createLogger(name, options = {}) {
  const globalLevel = process.env.LOG_LEVEL || 'info';
  return new Logger(name, {
    level: globalLevel,
    ...options,
  });
}

/**
 * Logger par défaut
 */
export const defaultLogger = createLogger('app');

export default {
  Logger,
  createLogger,
  defaultLogger,
  LOG_LEVELS,
};
