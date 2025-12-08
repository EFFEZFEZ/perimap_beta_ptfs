// Copyright © 2025 Périmap - Tous droits réservés
/**
 * api/index.js
 * Router principal de l'API
 */

import { Router } from 'express';
import routesApi from './routes.js';
import placesApi from './places.js';
import realtimeApi from './realtime.js';

const router = Router();

router.use('/routes', routesApi);
router.use('/places', placesApi);
router.use('/realtime', realtimeApi);

router.get('/', (req, res) => {
  res.json({
    name: 'Perimap API',
    version: '1.0.0',
    endpoints: {
      routes: 'POST /api/routes',
      places: {
        autocomplete: 'GET /api/places/autocomplete?q=...',
        reverse: 'GET /api/places/reverse?lat=...&lon=...'
      },
      realtime: 'GET /api/realtime'
    },
  });
});

export default router;
