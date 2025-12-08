// Copyright © 2025 Périmap - Tous droits réservés
/**
 * api/places.js
 * Proxy Photon pour recherche et géocodage inverse
 */

import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

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

router.get('/autocomplete', async (req, res) => {
  const { q, lat, lon, limit = 8 } = req.query;

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Requête trop courte (min 2 caractères)' });
  }

  try {
    const params = new URLSearchParams({ 
      q, 
      limit: String(Math.min(limit, 20)) // Demander plus pour filtrer ensuite
    });
    
    // Prioriser les résultats autour de la Dordogne
    const searchLat = lat || DORDOGNE_CENTER.lat;
    const searchLon = lon || DORDOGNE_CENTER.lon;
    params.set('lat', String(searchLat));
    params.set('lon', String(searchLon));

    const url = `${PHOTON_BASE_URL}/api?${params.toString()}`;
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(502).json({ error: 'Photon error', status: response.status });
    }
    const data = await response.json();
    
    // Filtrer les résultats pour ne garder que la Dordogne et environs
    const filtered = (data.features || [])
      .map(mapPhotonFeatureToSuggestion)
      .filter(s => {
        // Garder si c'est dans les limites de la Dordogne
        if (s.lat >= DORDOGNE_BOUNDS.south && s.lat <= DORDOGNE_BOUNDS.north &&
            s.lon >= DORDOGNE_BOUNDS.west && s.lon <= DORDOGNE_BOUNDS.east) {
          return true;
        }
        // Ou si c'est mentionné "Dordogne" dans la description
        if (s.description?.toLowerCase().includes('dordogne') || 
            s.description?.toLowerCase().includes('périgueux') ||
            s.description?.toLowerCase().includes('perigueux')) {
          return true;
        }
        return false;
      })
      .slice(0, limit);
    
    res.json({ suggestions: filtered });
  } catch (error) {
    console.error('[places] autocomplete error', error);
    res.status(502).json({ error: 'Autocomplete error', details: error.message });
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
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(502).json({ error: 'Photon reverse error', status: response.status });
    }
    const data = await response.json();
    const feature = data.features?.[0];
    if (!feature) {
      return res.status(404).json({ error: 'Aucun résultat' });
    }
    res.json({ place: mapPhotonFeatureToSuggestion(feature) });
  } catch (error) {
    console.error('[places] reverse error', error);
    res.status(502).json({ error: 'Reverse error', details: error.message });
  }
});

function mapPhotonFeatureToSuggestion(feature) {
  const props = feature.properties || {};
  const coord = feature.geometry?.coordinates || [];
  return {
    id: buildPhotonId(props),
    description: props.name || props.label || 'Lieu',
    lat: coord[1],
    lon: coord[0],
    city: props.city || props.town || props.village,
    country: props.country,
    type: props.osm_value,
  };
}

function buildPhotonId(props) {
  if (props.osm_type && props.osm_id) {
    return `${props.osm_type}:${props.osm_id}`;
  }
  return props.osm_id ? String(props.osm_id) : 'photon';
}

export default router;
