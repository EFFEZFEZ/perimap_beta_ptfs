/**
 * middleware/rateLimit.js
 * Rate limiting pour protéger l'API
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 */

import { config } from '../config.js';

/**
 * Configure le rate limiting pour l'application Express
 * @param {Express} app
 */
export function setupRateLimit(app) {
  /*
  import rateLimit from 'express-rate-limit';

  // Limite générale
  const generalLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Trop de requêtes, veuillez réessayer plus tard.',
      retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
    },
    keyGenerator: (req) => {
      // Utiliser X-Device-ID si disponible, sinon IP
      return req.headers['x-device-id'] || req.ip;
    },
  });

  // Limite stricte pour le calcul d'itinéraires (plus coûteux)
  const routeLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRouteRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Trop de recherches d\'itinéraires, veuillez réessayer plus tard.',
      retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
    },
    keyGenerator: (req) => {
      return req.headers['x-device-id'] || req.ip;
    },
  });

  // Appliquer les limiteurs
  app.use('/api', generalLimiter);
  app.use('/api/routes/compute', routeLimiter);
  */

  console.log('🛡️ Rate limiting configuré');
}

/**
 * Middleware de rate limiting personnalisé (sans dépendance)
 * Pour les cas où express-rate-limit n'est pas disponible
 */
export class SimpleRateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000;
    this.maxRequests = options.maxRequests || 100;
    this.requests = new Map(); // key -> {count, resetTime}
  }

  /**
   * Middleware Express
   */
  middleware() {
    return (req, res, next) => {
      const key = req.headers['x-device-id'] || req.ip;
      const now = Date.now();

      let record = this.requests.get(key);
      
      if (!record || now > record.resetTime) {
        record = {
          count: 1,
          resetTime: now + this.windowMs,
        };
        this.requests.set(key, record);
        return next();
      }

      record.count++;

      if (record.count > this.maxRequests) {
        const retryAfter = Math.ceil((record.resetTime - now) / 1000);
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
          error: 'Trop de requêtes',
          retryAfter,
        });
      }

      next();
    };
  }

  /**
   * Nettoie les entrées expirées
   */
  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.requests.entries()) {
      if (now > record.resetTime) {
        this.requests.delete(key);
      }
    }
  }
}

export default setupRateLimit;
