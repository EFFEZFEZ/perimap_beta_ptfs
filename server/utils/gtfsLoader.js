// Copyright © 2025 Périmap - Tous droits réservés
/**
 * utils/gtfsLoader.js
 * Chargement intelligent des attributs GTFS (couleurs, noms)
 * 
 * ÉTAPE 1 : Gère les IDs préfixés d'OTP (ex: "GrandPerigueux:A" -> "A")
 * Algorithme de recherche "floue" en 3 étapes:
 * 1. Correspondance exacte
 * 2. Suppression du préfixe (après ":")
 * 3. Fallback gris si rien ne correspond
 */

import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { createLogger } from './logger.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = createLogger('gtfs-loader');

const routeAttributes = new Map();
let isLoaded = false;

/**
 * Charge les attributs (couleur, texte, nom court) depuis routes.txt au démarrage
 */
export async function loadRouteAttributes() {
    return new Promise((resolve, reject) => {
        // Chemin vers le fichier routes.txt
        // Dans Docker: __dirname = /app/utils, donc:
        // ../public/data/gtfs/routes.txt = /app/public/data/gtfs/routes.txt
        const routesPath = path.join(__dirname, '../public/data/gtfs/routes.txt');
        
        // Fallback si le fichier n'est pas trouvé dans public
        const alternativePath = path.join(__dirname, '../data/gtfs/routes.txt');
        
        let finalPath = routesPath;
        if (!fs.existsSync(routesPath)) {
            if (fs.existsSync(alternativePath)) {
                finalPath = alternativePath;
            } else {
                logger.warn(`⚠️ Fichier routes.txt introuvable. Chemins testés: ${routesPath}, ${alternativePath}`);
                resolve(); // On résout quand même pour ne pas bloquer le serveur
                return;
            }
        }

        logger.info(`🎨 Chargement des couleurs depuis: ${finalPath}`);

        fs.createReadStream(finalPath)
            .pipe(csv())
            .on('data', (data) => {
                // Nettoyage et sécurisation des couleurs
                let color = data.route_color || '000000';
                if (!color.startsWith('#')) color = '#' + color;

                let textColor = data.route_text_color || 'FFFFFF';
                if (!textColor.startsWith('#')) textColor = '#' + textColor;

                // On stocke l'ID exact
                routeAttributes.set(data.route_id, {
                    color: color,
                    textColor: textColor,
                    shortName: data.route_short_name || 'Bus',
                    longName: data.route_long_name || ''
                });
            })
            .on('end', () => {
                isLoaded = true;
                logger.info(`✅ ${routeAttributes.size} routes chargées en mémoire.`);
                resolve(routeAttributes);
            })
            .on('error', (err) => {
                logger.error('❌ Erreur lecture routes.txt:', err);
                reject(err);
            });
    });
}

/**
 * Trouve les infos d'une route avec une recherche "floue" (Fuzzy matching)
 * Gère les cas "GrandPerigueux:A" vs "A"
 * 
 * ÉTAPE 1 - Algorithme de matching:
 * 1. Essai Correspondance Exacte : "A" == "A"
 * 2. Essai Nettoyage de préfixe : "GrandPerigueux:A" -> "A"
 * 3. Essai Suffixe : "123_A" correspond à "A"
 * 4. Fallback : Gris #333333 + nom propre du routeId nettoyé
 */
export function getRouteAttributes(otpRouteId) {
    // Valeurs par défaut si le système n'est pas prêt ou ID vide
    const defaultAttrs = { 
        color: '#333333', 
        textColor: '#FFFFFF', 
        shortName: otpRouteId || 'Bus',
        longName: ''
    };
    
    if (!isLoaded || !otpRouteId) return defaultAttrs;

    // ÉTAPE 1: Essai Correspondance Exacte
    if (routeAttributes.has(otpRouteId)) {
        logger.debug(`[Route] Match exact: ${otpRouteId}`);
        return routeAttributes.get(otpRouteId);
    }

    // ÉTAPE 2: Essai Nettoyage de préfixe (ex: "GrandPerigueux:A" -> "A")
    // On prend tout ce qui est après le dernier ":"
    const parts = otpRouteId.split(':');
    const cleanId = parts[parts.length - 1]; // Prend le dernier élément

    if (routeAttributes.has(cleanId)) {
        logger.debug(`[Route] Match avec préfixe nettoyé: ${otpRouteId} -> ${cleanId}`);
        return routeAttributes.get(cleanId);
    }

    // ÉTAPE 3: Essai Suffixe (ex: ID "123_A" correspond à "A")
    for (const [storedId, attrs] of routeAttributes.entries()) {
        if (otpRouteId.endsWith(`:${storedId}`) || storedId === cleanId) {
            logger.debug(`[Route] Match suffixe: ${otpRouteId} -> ${storedId}`);
            return attrs;
        }
    }

    // Fallback : Si on a nettoyé l'ID, on renvoie au moins l'ID propre comme nom court
    logger.warn(`[Route] Pas de match pour ${otpRouteId}, utilisation du fallback gris`);
    return { 
        ...defaultAttrs, 
        shortName: cleanId 
    };
}

export default {
    loadRouteAttributes,
    getRouteAttributes
};
