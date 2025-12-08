// Copyright © 2025 Périmap - Tous droits réservés
/**
 * api/realtime.js
 * Expose un flux GTFS-RT simplifié au format JSON léger
 */

import { Router } from 'express';
import { fetchGtfsRt } from '../services/realtimeService.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const data = await fetchGtfsRt();
    res.setHeader('Cache-Control', 'public, max-age=5, stale-while-revalidate=20');
    res.json({ vehicles: data });
  } catch (error) {
    console.error('[realtime] error', error);
    res.status(502).json({ error: 'Realtime unavailable', details: error.message });
  }
});

export default router;
