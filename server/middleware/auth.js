/**
 * middleware/auth.js
 * Authentification et identification des utilisateurs
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 * 
 * Stratégies d'authentification:
 * 1. Device ID (anonyme) - Par défaut
 * 2. JWT Token (optionnel pour fonctionnalités avancées)
 */

/**
 * Middleware d'identification par Device ID
 * Crée ou récupère un utilisateur basé sur le header X-Device-ID
 */
export function deviceIdAuth(userMemory) {
  return async (req, res, next) => {
    const deviceId = req.headers['x-device-id'];

    if (!deviceId) {
      // Pas de device ID, continuer sans utilisateur
      req.userId = null;
      req.user = null;
      return next();
    }

    try {
      const user = await userMemory.getOrCreateUser(deviceId);
      req.userId = user.id;
      req.user = user;
      next();
    } catch (error) {
      console.error('Erreur auth:', error);
      next(error);
    }
  };
}

/**
 * Middleware qui requiert une identification
 * À utiliser sur les routes qui nécessitent un utilisateur
 */
export function requireAuth() {
  return (req, res, next) => {
    if (!req.userId) {
      return res.status(401).json({
        error: 'Authentification requise',
        message: 'Le header X-Device-ID est requis pour cette action',
      });
    }
    next();
  };
}

/**
 * Génère un Device ID unique
 * À utiliser côté client si pas de device ID existant
 */
export function generateDeviceId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return `dev_${timestamp}_${random}`;
}

/**
 * Middleware JWT (optionnel, pour fonctionnalités avancées)
 * À implémenter si besoin d'authentification plus forte
 */
export function jwtAuth(secret) {
  return async (req, res, next) => {
    /*
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // Pas de token, continuer
    }

    const token = authHeader.substring(7);

    try {
      const jwt = await import('jsonwebtoken');
      const decoded = jwt.verify(token, secret);
      
      req.jwtPayload = decoded;
      req.userId = decoded.userId;
      
      next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Token expiré',
          code: 'TOKEN_EXPIRED',
        });
      }
      
      return res.status(401).json({
        error: 'Token invalide',
        code: 'INVALID_TOKEN',
      });
    }
    */
    next();
  };
}

/**
 * Génère un JWT token
 */
export function generateJwtToken(payload, secret, expiresIn = '7d') {
  /*
  const jwt = require('jsonwebtoken');
  return jwt.sign(payload, secret, { expiresIn });
  */
  return '';
}

/**
 * Valide un Device ID
 */
export function isValidDeviceId(deviceId) {
  if (!deviceId || typeof deviceId !== 'string') {
    return false;
  }

  // Format attendu: dev_xxxxx_xxxxxxxxx
  if (deviceId.startsWith('dev_')) {
    return deviceId.length >= 15 && deviceId.length <= 50;
  }

  // Accepter aussi les UUIDs
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(deviceId)) {
    return true;
  }

  // Accepter les strings alphanumériques de longueur raisonnable
  return /^[a-zA-Z0-9_-]{8,64}$/.test(deviceId);
}

export default {
  deviceIdAuth,
  requireAuth,
  generateDeviceId,
  jwtAuth,
  generateJwtToken,
  isValidDeviceId,
};
