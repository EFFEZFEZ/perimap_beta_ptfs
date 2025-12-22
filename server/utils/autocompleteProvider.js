// server/utils/autocompleteProvider.js
// Autocomplete logique inspirée de TBM/SNCF Connect/IDF Mobilités
// Tri intelligent : Villes → POIs → Adresses → Arrêts

import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createLogger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const logger = createLogger('autocomplete');

// Données en mémoire
let stopsCache = [];
let stopsCacheLoaded = false;

function normalizeText(value) {
  return (value || '').toString().toLowerCase().trim();
}

function splitWords(textLower) {
  return textLower.split(/[\s\-_]/);
}

/**
 * Charge les arrêts GTFS et les POIs
 */
async function loadAutocompleteCache() {
  if (stopsCacheLoaded) return;

  // Vérifier plusieurs chemins possibles (selon exécution: dev, container, package)
  const possiblePaths = [
    path.join(__dirname, '../../public/data/gtfs/stops.txt'),
    path.join(__dirname, '../public/data/gtfs/stops.txt'),
    path.join(process.cwd(), 'public/data/gtfs/stops.txt'),
    '/app/public/data/gtfs/stops.txt'
  ];

  for (const stopsPath of possiblePaths) {
    try {
      if (fs.existsSync(stopsPath)) {
        logger.info(`📍 Chargement des suggestions depuis: ${stopsPath}`);
        const stops = [];

        await new Promise((resolve, reject) => {
          fs.createReadStream(stopsPath)
            .pipe(csv())
            .on('data', (row) => {
              const name = row.stop_name || '';
              const nameLower = normalizeText(name);
              stops.push({
                id: row.stop_id,
                name,
                _nameLower: nameLower,
                _words: splitWords(nameLower),
                lat: parseFloat(row.stop_lat),
                lon: parseFloat(row.stop_lon),
                type: 'stop',           // Catégorie basse priorité
                priority: 4,            // 1=ville, 2=POI, 3=adresse, 4=arrêt
                category: 'transport'
              });
            })
            .on('end', () => {
              stopsCache = stops;
              stopsCacheLoaded = true;
              logger.info(`✅ ${stops.length} suggestions chargées`);
              resolve();
            })
            .on('error', (e) => { logger.warn(`CSV read error: ${e.message}`); reject(e); });
        });
        return;
      }
    } catch (err) {
      logger.warn(`⚠️ Could not load stops from ${stopsPath}: ${err.message}`);
    }
  }

  // Aucun fichier stops trouvé — marquer comme chargé pour éviter réessais répétés
  stopsCacheLoaded = true;
  logger.warn('⚠️ stops.txt non trouvé dans les chemins attendus, recherche locale désactivée');
}

/**
 * Autocomplete inspirée de TBM / SNCF Connect
 * Tri logique local : villes d'abord, puis POIs, puis adresses, puis arrêts
 */
export async function autocomplete(query, options = {}) {
  await loadAutocompleteCache();
  
  const {
    limit = 10,
    lat = 45.1839,  // Grand Périgueux par défaut
    lon = 0.7212
  } = options;

  if (!query || query.length < 1) {
    return [];
  }

  const q = query.toLowerCase().trim();

  // Récupérer les résultats bruts depuis le cache
  const results = [];

  // Chercher dans les arrêts GTFS
  stopsCache.forEach(stop => {
    const score = calculateScorePrepared(q, stop);
    if (score > 0) {
      results.push({
        ...stop,
        score
      });
    }
  });

  // Trier par priorité catégorie puis par score
  results.sort((a, b) => {
    // D'abord, par catégorie (priorité)
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // Ensuite, par score (relevance)
    return b.score - a.score;
  });

  // Formater et retourner
  return results.slice(0, limit).map(r => ({
    lat: r.lat,
    lon: r.lon,
    description: r.name,
    city: 'Périgueux',
    type: r.type,
    category: r.category
  }));
}

/**
 * Calcule un score de pertinence (0-1)
 * Récompense les correspondances au début du mot et les correspondances exactes
 */
function calculateScore(query, text, item) {
  const textLower = text.toLowerCase();
  
  // Correspondance exacte (complète)
  if (textLower === query) return 1.0;
  
  // Correspondance au début
  if (textLower.startsWith(query)) return 0.9;
  
  // Correspondance dans le texte (préfixe de mot)
  const words = textLower.split(/[\s\-_]/);
  if (words.some(w => w.startsWith(query))) return 0.8;
  
  // Fuzzy matching (chercher les caractères dans l'ordre)
  let score = 0;
  let queryIdx = 0;
  let consecutiveMatches = 0;
  
  for (let i = 0; i < textLower.length && queryIdx < query.length; i++) {
    if (textLower[i] === query[queryIdx]) {
      score += 0.1 * (query.length - queryIdx) / query.length;
      consecutiveMatches++;
      queryIdx++;
    } else {
      consecutiveMatches = 0;
    }
  }
  
  // Bonus pour les correspondances consécutives
  score *= (1 + consecutiveMatches * 0.1);
  
  // Retourner un score normalisé (0-0.7 max pour fuzzy)
  return queryIdx === query.length ? Math.min(score / textLower.length, 0.7) : 0;
}

// Version optimisée: utilise des champs pré-calculés, sans modifier l'algorithme
function calculateScorePrepared(query, item) {
  const textLower = item?._nameLower ?? normalizeText(item?.name);

  // Correspondance exacte (complète)
  if (textLower === query) return 1.0;

  // Correspondance au début
  if (textLower.startsWith(query)) return 0.9;

  // Correspondance dans le texte (préfixe de mot)
  const words = Array.isArray(item?._words) ? item._words : splitWords(textLower);
  if (words.some(w => w.startsWith(query))) return 0.8;

  // Fuzzy matching (chercher les caractères dans l'ordre)
  let score = 0;
  let queryIdx = 0;
  let consecutiveMatches = 0;

  for (let i = 0; i < textLower.length && queryIdx < query.length; i++) {
    if (textLower[i] === query[queryIdx]) {
      score += 0.1 * (query.length - queryIdx) / query.length;
      consecutiveMatches++;
      queryIdx++;
    } else {
      consecutiveMatches = 0;
    }
  }

  // Bonus pour les correspondances consécutives
  score *= (1 + consecutiveMatches * 0.1);

  // Retourner un score normalisé (0-0.7 max pour fuzzy)
  return queryIdx === query.length ? Math.min(score / textLower.length, 0.7) : 0;
}

export { loadAutocompleteCache };
