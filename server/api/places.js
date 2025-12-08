// Copyright © 2025 Périmap - Tous droits réservés
/**
 * api/places.js
 * Proxy Photon pour recherche et géocodage inverse
 */

import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

const PHOTON_BASE_URL = process.env.PHOTON_BASE_URL || 'http://localhost:2322';

router.get('/autocomplete', async (req, res) => {
  const { q, lat, lon, limit = 8 } = req.query;

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Requête trop courte (min 2 caractères)' });
  }

  try {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (lat && lon) {
      params.set('lat', lat);
      params.set('lon', lon);
    }

    const url = `${PHOTON_BASE_URL}/api?${params.toString()}`;
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(502).json({ error: 'Photon error', status: response.status });
    }
    const data = await response.json();
    const suggestions = (data.features || []).map(mapPhotonFeatureToSuggestion);
    res.json({ suggestions });
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
