// Copyright © 2025 Périmap - Tous droits réservés
/**
 * services/realtimeService.js
 * Récupère et décode le flux GTFS-RT véhicules
 */

import { createRequire } from 'module';
import fetch from 'node-fetch';

const require = createRequire(import.meta.url);
const gtfsRealtimeBindings = require('gtfs-realtime-bindings');

const GTFS_RT_URL = process.env.GTFS_RT_URL || '';
const DEFAULT_MAX_AGE_MS = 15 * 1000;
let cached = { timestamp: 0, data: [] };

export async function fetchGtfsRt() {
  // Si GTFS_RT_URL n'est pas configuré, retourner un tableau vide (pas d'erreur)
  if (!GTFS_RT_URL) {
    console.warn('[realtime] GTFS_RT_URL non configuré - retour de données vides');
    return [];
  }

  const now = Date.now();
  if (now - cached.timestamp < DEFAULT_MAX_AGE_MS && cached.data.length) {
    return cached.data;
  }

  try {
    const response = await fetch(GTFS_RT_URL);
    if (!response.ok) {
      console.warn(`[realtime] GTFS-RT HTTP ${response.status}`);
      return cached.data || [];
    }
  const buffer = Buffer.from(await response.arrayBuffer());
  const feed = gtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);

  const vehicles = [];
  feed.entity.forEach((entity) => {
    if (!entity.vehicle || !entity.vehicle.position) return;
    const v = entity.vehicle;
    vehicles.push({
      id: v.vehicle?.id || entity.id,
      tripId: v.trip?.tripId || null,
      routeId: v.trip?.routeId || null,
      latitude: v.position.latitude,
      longitude: v.position.longitude,
      bearing: v.position.bearing || null,
      speed: v.position.speed || null,
      currentStopSequence: v.currentStopSequence || null,
      currentStatus: v.currentStatus || null,
      timestamp: v.timestamp ? v.timestamp * 1000 : null,
      stopId: v.stopId || null,
    });
  });

  cached = { timestamp: now, data: vehicles };
  return vehicles;
  } catch (error) {
    console.warn('[realtime] Erreur lors du fetch GTFS-RT:', error.message);
    return cached.data || [];
  }
}
