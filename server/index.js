// Copyright © 2025 Périmap - Tous droits réservés
/**
 * index.js
 * Point d'entrée du serveur Perimap (Express + OTP/Photon proxies)
 * 
 * Architecture serveur-centralisée:
 * - Chargement des couleurs GTFS au démarrage (routes.txt)
 * - Enrichissement des réponses OTP avec les données GTFS
 * - Le client ne fait plus de parsing GTFS
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { config, validateConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import apiRouter from './api/index.js';
import { loadRouteAttributes } from './utils/gtfsLoader.js';
import { checkOtpHealth } from './services/otpService.js';

const logger = createLogger('server');

async function startServer() {
  try {
    validateConfig();
    logger.info('✅ Configuration validée');

    // ✅ NOUVEAU: Charger les couleurs GTFS au démarrage
    logger.info(`📂 Chargement des données GTFS...`);
    const routeColors = await loadRouteAttributes();
    logger.info(`✅ ${routeColors.size} routes chargées avec leurs couleurs`);
    
    // Vérifier la connectivité OTP (non bloquant)
    checkOtpHealth().then(health => {
      if (health.ok) {
        logger.info(`✅ OTP connecté (version: ${health.version})`);
      } else {
        logger.warn(`⚠️ OTP non accessible: ${health.error}`);
      }
    });

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

    // Servir les fichiers statiques du frontend (chemin robuste)
    const candidates = [
      join(__dirname, 'public'),           // Dockerfile: COPY public ./public → __dirname=/app
      join(__dirname, '..', 'public')      // Exécution locale: /server → ../public
    ];
    const publicDir = candidates.find(p => existsSync(p)) || candidates[0];
    app.use(express.static(publicDir));

    app.use('/api', apiRouter);

    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
    });

    // Servir index.html pour la route racine
    app.get('/', (_req, res) => {
      res.sendFile(join(publicDir, 'index.html'));
    });

    // Fallback SPA: toutes les routes non-API renvoient index.html
    app.get(/^\/(?!api).+/, (_req, res) => {
      res.sendFile(join(publicDir, 'index.html'));
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
