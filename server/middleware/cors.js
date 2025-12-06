/**
 * middleware/cors.js
 * Configuration CORS
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 */

import { config } from '../config.js';

/**
 * Configure CORS pour l'application Express
 * @param {Express} app
 */
export function setupCors(app) {
  /*
  import cors from 'cors';

  const corsOptions = {
    origin: (origin, callback) => {
      // Autoriser les requêtes sans origin (ex: mobile apps)
      if (!origin) {
        return callback(null, true);
      }

      // Vérifier si l'origin est autorisée
      const allowedOrigins = config.server.corsOrigins;
      
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }

      // En développement, autoriser localhost
      if (config.server.env === 'development' && origin.includes('localhost')) {
        return callback(null, true);
      }

      callback(new Error('Not allowed by CORS'));
    },
    
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Device-ID',
      'X-Request-ID',
    ],
    
    exposedHeaders: [
      'X-Request-ID',
      'X-Response-Time',
    ],
    
    credentials: true,
    
    maxAge: 86400, // 24 heures
  };

  app.use(cors(corsOptions));
  */

  console.log('🔒 CORS configuré');
}

export default setupCors;
