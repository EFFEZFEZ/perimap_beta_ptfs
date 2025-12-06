/**
 * scripts/buildGraph.js
 * Script de pré-calcul du graphe de transport
 * 
 * 🔴 STATUT: DÉSACTIVÉ - Code préparé pour le futur
 * 
 * Usage: npm run build-graph
 * 
 * Ce script:
 * 1. Charge les données GTFS
 * 2. Construit le graphe de transport
 * 3. Pré-calcule les index nécessaires
 * 4. Sauvegarde le graphe en cache
 */

/*
import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { config } from '../config.js';
import { loadGtfsData } from '../utils/gtfsLoader.js';
import { PathfindingEngine } from '../core/pathfinding/index.js';
import { PlacesEngine } from '../core/places/index.js';
import { createLogger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = createLogger('build-graph');

async function main() {
  logger.info('🚀 Démarrage de la construction du graphe...');
  const startTime = Date.now();

  try {
    // 1. Charger les données GTFS
    logger.info('📂 Chargement des données GTFS...');
    const gtfsData = await loadGtfsData(config.paths.gtfs);
    logger.info(`   ✅ ${gtfsData.stops.length} arrêts, ${gtfsData.routes.length} lignes`);

    // 2. Construire le moteur de pathfinding
    logger.info('🔧 Construction du graphe de pathfinding...');
    const pathfinding = new PathfindingEngine(gtfsData, config.pathfinding);
    await pathfinding.buildGraph();
    logger.info('   ✅ Graphe de pathfinding prêt');

    // 3. Construire l'index des places
    logger.info('📍 Construction de l\'index des places...');
    const places = new PlacesEngine(gtfsData.stops, config.places);
    await places.buildIndex();
    logger.info('   ✅ Index des places prêt');

    // 4. Sauvegarder le cache
    logger.info('💾 Sauvegarde du cache...');
    
    // Créer le dossier de cache si nécessaire
    if (!existsSync(config.paths.cache)) {
      mkdirSync(config.paths.cache, { recursive: true });
    }

    // Sauvegarder le graphe
    const graphCache = pathfinding.graph.serialize();
    const graphCachePath = join(config.paths.cache, 'graph.json');
    writeFileSync(graphCachePath, JSON.stringify(graphCache));
    logger.info(`   ✅ Graphe sauvegardé: ${graphCachePath}`);

    // Sauvegarder les places
    const placesCache = places.indexer.export();
    const placesCachePath = join(config.paths.cache, 'places.json');
    writeFileSync(placesCachePath, JSON.stringify(placesCache));
    logger.info(`   ✅ Places sauvegardées: ${placesCachePath}`);

    // 5. Statistiques
    const elapsed = Date.now() - startTime;
    const graphStats = pathfinding.getStats();
    const placesStats = places.getStats();

    logger.info('');
    logger.info('📊 Statistiques:');
    logger.info(`   - Temps de construction: ${elapsed}ms`);
    logger.info(`   - Mémoire graphe: ${graphStats.memory.mb} MB`);
    logger.info(`   - Arrêts indexés: ${placesStats.stops}`);
    logger.info(`   - POI indexés: ${placesStats.pois}`);
    logger.info(`   - Entrées Trie: ${placesStats.trieStats.words}`);

    logger.info('');
    logger.info('✅ Construction terminée avec succès!');

  } catch (error) {
    logger.error('❌ Erreur lors de la construction:', error);
    process.exit(1);
  }
}

main();
*/

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   📊 BUILD GRAPH - Script de pré-calcul                       ║
║                                                               ║
║   🔴 STATUT: DÉSACTIVÉ                                        ║
║                                                               ║
║   Ce script construira le graphe de transport à partir        ║
║   des données GTFS pour optimiser les calculs d'itinéraires.  ║
║                                                               ║
║   Pour activer:                                               ║
║   1. Décommenter le code dans ce fichier                      ║
║   2. npm install                                              ║
║   3. npm run build-graph                                      ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);
