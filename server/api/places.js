// Copyright © 2025 Périmap - Tous droits réservés
/**
 * api/places.js
 * Recherche de lieux: Photon (si disponible) ou fallback GTFS local
 */

import { Router } from 'express';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createLogger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();
const logger = createLogger('places-api');

const PHOTON_BASE_URL = process.env.PHOTON_BASE_URL || 'http://localhost:2322';

// Limites géographiques de la Dordogne (département 24)
const DORDOGNE_BOUNDS = {
  south: 44.69,   // Sud de la Dordogne
  north: 45.68,   // Nord de la Dordogne
  west: 0.01,     // Ouest de la Dordogne
  east: 1.54      // Est de la Dordogne
};

// Centre de la Dordogne (Périgueux)
const DORDOGNE_CENTER = {
  lat: 45.184,
  lon: 0.716
};

// Cache local des arrêts GTFS
let stopsCache = [];
let stopsCacheLoaded = false;

/**
 * Charge les arrêts depuis stops.txt du GTFS
 */
async function loadStopsCache() {
  if (stopsCacheLoaded) return;
  
  // Chemins possibles pour stops.txt
  const possiblePaths = [
    path.join(__dirname, '../public/data/gtfs/stops.txt'),
    path.join(__dirname, '../../public/data/gtfs/stops.txt'),
    path.join('/app/public/data/gtfs/stops.txt'),
  ];
  
  for (const filePath of possiblePaths) {
    try {
      if (fs.existsSync(filePath)) {
        logger.info(`📍 Chargement des arrêts depuis: ${filePath}`);
        const stops = [];
        
        await new Promise((resolve, reject) => {
          fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
              stops.push({
                id: row.stop_id,
                name: row.stop_name || '',
                lat: parseFloat(row.stop_lat),
                lon: parseFloat(row.stop_lon),
                description: row.stop_desc || row.stop_name || '',
                code: row.stop_code || ''
              });
            })
            .on('end', () => {
              stopsCache = stops;
              stopsCacheLoaded = true;
              logger.info(`✅ ${stops.length} arrêts chargés en cache`);
              resolve();
            })
            .on('error', reject);
        });
        return;
      }
    } catch (err) {
      logger.warn(`⚠️ Could not load stops from ${filePath}: ${err.message}`);
    }
  }
  
  stopsCacheLoaded = true;
  logger.warn('⚠️ stops.txt non trouvé, recherche locale désactivée');
}

/**
 * Recherche floue simple dans les arrêts locaux
 */
function fuzzySearchStops(query, limit = 8) {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];
  
  const scored = stopsCache
    .map(stop => ({
      ...stop,
      score: fuzzyScore(q, stop.name.toLowerCase())
    }))
    .filter(s => s.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  
  return scored.map(s => ({
    lat: s.lat,
    lon: s.lon,
    description: s.name,
    city: 'Périgueux',
    type: 'stop'
  }));
}

/**
 * Calcul simple d'une score de correspondance floue
 */
function fuzzyScore(needle, haystack) {
  if (haystack.includes(needle)) return 1.0; // Correspondance exacte
  
  let score = 0;
  let needleIdx = 0;
  
  for (let i = 0; i < haystack.length && needleIdx < needle.length; i++) {
    if (haystack[i] === needle[needleIdx]) {
      score += (needle.length - needleIdx) / needle.length;
      needleIdx++;
    }
  }
  
  // Score basé sur le pourcentage de caractères trouvés
  return needleIdx === needle.length ? score / haystack.length : 0;
}

// Initialiser le cache au démarrage
await loadStopsCache();

router.get('/autocomplete', async (req, res) => {
  const { q, lat, lon, limit = 8 } = req.query;

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Requête trop courte (min 2 caractères)' });
  }

  try {
    // Essayer Photon d'abord
    const params = new URLSearchParams({ 
      q, 
      limit: String(Math.min(limit, 20))
    });
    
    const searchLat = lat || DORDOGNE_CENTER.lat;
    const searchLon = lon || DORDOGNE_CENTER.lon;
    params.set('lat', String(searchLat));
    params.set('lon', String(searchLon));

    const url = `${PHOTON_BASE_URL}/api?${params.toString()}`;
    try {
      const response = await Promise.race([
        fetch(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
      ]);
      
      if (response.ok) {
        const data = await response.json();
        const filtered = (data.features || [])
          .map(f => ({
            lat: f.geometry.coordinates[1],
            lon: f.geometry.coordinates[0],
            description: f.properties.name || '',
            city: f.properties.city || ''
          }))
          .filter(s => {
            if (s.lat >= DORDOGNE_BOUNDS.south && s.lat <= DORDOGNE_BOUNDS.north &&
                s.lon >= DORDOGNE_BOUNDS.west && s.lon <= DORDOGNE_BOUNDS.east) {
              return true;
            }
            if (s.description?.toLowerCase().includes('dordogne') || 
                s.description?.toLowerCase().includes('périgueux')) {
              return true;
            }
            return false;
          })
          .slice(0, limit);
        
        if (filtered.length > 0) {
          return res.json({ suggestions: filtered });
        }
      }
    } catch (err) {
      logger.debug(`[places] Photon unavailable: ${err.message}`);
    }
    
    // Fallback: recherche locale dans les arrêts GTFS
    const localResults = fuzzySearchStops(q, limit);
    res.json({ suggestions: localResults });
    
  } catch (error) {
    logger.error('[places] autocomplete error', error);
    res.json({ suggestions: [] });
  }
});

router.get('/reverse', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat et lon requis' });
  }
  try {
    const params = new URLSearchParams({ lat, lon, limit: '1' });
    const url = `${PHOTON_BASE_URL}/reverse?${params.toString()}`;
    try {
      const response = await Promise.race([
        fetch(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
      ]);
      
      if (response.ok) {
        const data = await response.json();
        const feature = data.features?.[0];
        if (feature) {
          return res.json({ 
            place: {
              lat: feature.geometry.coordinates[1],
              lon: feature.geometry.coordinates[0],
              description: feature.properties.name || 'Localisation',
              city: feature.properties.city || ''
            }
          });
        }
      }
    } catch (err) {
      logger.debug(`[places] Photon reverse unavailable: ${err.message}`);
    }
    
    // Fallback: retourner le point de départ
    res.json({ 
      place: {
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        description: 'Localisation',
        city: ''
      }
    });
  } catch (error) {
    logger.error('[places] reverse error', error);
    res.json({ place: { lat: parseFloat(lat), lon: parseFloat(lon), description: 'Localisation' } });
  }
});

function mapPhotonFeatureToSuggestion(feature) {
  return {
    lat: feature.geometry.coordinates[1],
    lon: feature.geometry.coordinates[0],
    description: feature.properties.name || '',
    city: feature.properties.city || ''
  };
}

export default router;
