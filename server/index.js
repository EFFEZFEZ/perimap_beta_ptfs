// Copyright © 2025 Périmap - Tous droits réservés
/**
 * index.js
 * Point d'entrée du serveur Perimap (Express + OTP/Photon proxies)
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { config, validateConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import apiRouter from './api/index.js';

const logger = createLogger('server');

async function startServer() {
  try {
    validateConfig();
    logger.info('✅ Configuration validée');

    const app = express();

    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(compression());
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true }));

    app.use(cors({
      origin: config.server.corsOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    // Headers pour éviter le cache agressif du navigateur
    app.use((req, res, next) => {
      if (req.path.endsWith('.js') || req.path.endsWith('.css')) {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
      }
      next();
    });

    // Servir les fichiers statiques du frontend
    app.use(express.static(join(__dirname, 'public')));

    app.use('/api', apiRouter);

    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
    });

    app.use((err, _req, res, _next) => {
      logger.error('Erreur non gérée:', err);
      res.status(500).json({ error: 'Erreur interne du serveur' });
    });

    const server = app.listen(config.server.port, config.server.host, () => {
      logger.info(`🚀 Serveur Perimap sur http://${config.server.host}:${config.server.port}`);
    });

    process.on('SIGTERM', () => {
      logger.info('SIGTERM reçu, arrêt du serveur...');
      server.close(() => process.exit(0));
    });
  } catch (error) {
    logger.error('❌ Erreur au démarrage:', error);
    process.exit(1);
  }
}

startServer();
