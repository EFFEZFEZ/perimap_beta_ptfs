// Copyright © 2025 Périmap - Tous droits réservés
/**
 * api/places.js
 * Recherche de lieux: Photon (si disponible) ou fallback GTFS local
 */

import { Router } from 'express';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createLogger } from '../utils/logger.js';
import { autocomplete as smartAutocomplete, loadAutocompleteCache } from '../utils/autocompleteProvider.js';

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

// Centre de Grand Périgueux (biais pour les recherches)
const GRAND_PERIGUEUX_CENTER = {
  lat: 45.1839,
  lon: 0.7212
};

// Initialiser le cache des suggestions au démarrage
await loadAutocompleteCache();

router.get('/autocomplete', async (req, res) => {
  const { q, lat, lon, limit = 10 } = req.query;

  if (!q || q.length < 1) {
    return res.status(400).json({ error: 'Requête trop courte (min 1 caractère)' });
  }

  try {
    // Essayer Photon d'abord (si disponible)
    const params = new URLSearchParams({ 
      q, 
      limit: String(Math.min(limit, 20))
    });

    const searchLat = lat ? Number(lat) : GRAND_PERIGUEUX_CENTER.lat;
    const searchLon = lon ? Number(lon) : GRAND_PERIGUEUX_CENTER.lon;
    params.set('lat', String(searchLat));
    params.set('lon', String(searchLon));

    const url = `${PHOTON_BASE_URL}/api?${params.toString()}`;
    
    let photonResults = null;
    try {
      const response = await Promise.race([
        fetch(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
      ]);
      
      if (response.ok) {
        const data = await response.json();
        photonResults = (data.features || [])
          .filter(f => {
            const lat = f.geometry.coordinates[1];
            const lon = f.geometry.coordinates[0];
            return lat >= DORDOGNE_BOUNDS.south && lat <= DORDOGNE_BOUNDS.north &&
                   lon >= DORDOGNE_BOUNDS.west && lon <= DORDOGNE_BOUNDS.east;
          })
          .map(f => ({
            lat: f.geometry.coordinates[1],
            lon: f.geometry.coordinates[0],
            description: f.properties.name || '',
            city: f.properties.city || '',
            type: f.properties.type || 'place',
            source: 'photon'
          }))
          .slice(0, limit);
        
        if (photonResults.length > 0) {
          return res.json({ suggestions: photonResults });
        }
      }
    } catch (err) {
      logger.debug(`[places] Photon unavailable: ${err.message}`);
    }

    // Fallback: autocomplete intelligente (TBM-like) avec cache local
    const smartResults = await smartAutocomplete(q, { 
      limit: Number(limit),
      lat: searchLat,
      lon: searchLon
    });
    
    res.json({ suggestions: smartResults });
    
  } catch (error) {
    logger.error('[places] autocomplete error', error);
    res.json({ suggestions: [] });
  }
});

/**
 * Trie les suggestions par catégorie (hiérarchie logique)
 * 1. Villes
 * 2. Noms de lieux / enseignes (POIs)
 * 3. Adresses (rues, bâtiments)
 * 4. Autres
 */
function sortByCategory(suggestions) {
  const cities = [];
  const pois = [];
  const addresses = [];
  const other = [];

  suggestions.forEach(s => {
    const t = (s.type || '').toLowerCase();
    
    // Catégorie 1: Villes et localités
    if (['city', 'town', 'village', 'hamlet', 'borough', 'suburb'].includes(t)) {
      cities.push(s);
    }
    // Catégorie 2: POIs et enseignes
    else if (['amenity', 'shop', 'leisure', 'tourism', 'historic', 'building', 'public_transport'].includes(t)) {
      pois.push(s);
    }
    // Catégorie 3: Adresses et rues
    else if (['street', 'road', 'way', 'house', 'residential'].includes(t)) {
      addresses.push(s);
    }
    // Catégorie 4: Autres
    else {
      other.push(s);
    }
  });

  // Retourner dans l'ordre de priorité
  return [...cities, ...pois, ...addresses, ...other];
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

// Haversine distance (meters)
function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  function toRad(v) { return v * Math.PI / 180; }
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export default router;
