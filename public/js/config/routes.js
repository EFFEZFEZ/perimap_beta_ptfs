/**
 * routes.js - Configuration des lignes et catégories de routes
 * 
 * Ce module contient les mappages des noms de lignes,
 * les catégories de lignes et les chemins vers les fiches horaires.
 */

// === Catégories de lignes ===

/**
 * Catégories de lignes du réseau Péribus
 * Chaque catégorie contient un nom, une liste de lignes et une couleur
 */
export const LINE_CATEGORIES = {
    'majeures': { 
        name: 'Lignes majeures', 
        lines: ['A', 'B', 'C', 'D'], 
        color: '#2563eb' 
    },
    'express': { 
        name: 'Lignes express', 
        lines: ['e1', 'e2', 'e4', 'e5', 'e6', 'e7'], 
        color: '#dc2626' 
    },
    'quartier': { 
        name: 'Lignes de quartier', 
        lines: ['K1A', 'K1B', 'K2', 'K3A', 'K3B', 'K4A', 'K4B', 'K5', 'K6'], 
        color: '#059669' 
    },
    'rabattement': { 
        name: 'Lignes de rabattement', 
        lines: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13', 'R14', 'R15'], 
        color: '#7c3aed' 
    },
    'navettes': { 
        name: 'Navettes', 
        lines: ['N', 'N1'], 
        color: '#f59e0b' 
    }
};

// === Mappage des noms de fichiers PDF ===

/**
 * Mappage des noms courts de ligne vers les noms de fichiers PDF des fiches horaires
 */
export const PDF_FILENAME_MAP = {
    'A': 'grandperigueux_fiche_horaires_ligne_A_sept_2025.pdf',
    'B': 'grandperigueux_fiche_horaires_ligne_B_sept_2025.pdf',
    'C': 'grandperigueux_fiche_horaires_ligne_C_sept_2025.pdf',
    'D': 'grandperigueux_fiche_horaires_ligne_D_sept_2025.pdf',
    'e1': 'grandperigueux_fiche_horaires_ligne_e1_sept_2025.pdf',
    'e2': 'grandperigueux_fiche_horaires_ligne_e2_sept_2025.pdf',
    'e4': 'grandperigueux_fiche_horaires_ligne_e4_sept_2025.pdf',
    'e5': 'grandperigueux_fiche_horaires_ligne_e5_sept_2025.pdf',
    'e6': 'grandperigueux_fiche_horaires_ligne_e6_sept_2025.pdf',
    'e7': 'grandperigueux_fiche_horaires_ligne_e7_sept_2025.pdf',
    'K1A': 'grandperigueux_fiche_horaires_ligne_K1A_sept_2025.pdf',
    'K1B': 'grandperigueux_fiche_horaires_ligne_K1B_sept_2025.pdf',
    'K2': 'grandperigueux_fiche_horaires_ligne_K2_sept_2025.pdf',
    'K3A': 'grandperigueux_fiche_horaires_ligne_K3A_sept_2025.pdf',
    'K3B': 'grandperigueux_fiche_horaires_ligne_K3B_sept_2025.pdf',
    'K4A': 'grandperigueux_fiche_horaires_ligne_K4A_sept_2025.pdf',
    'K4B': 'grandperigueux_fiche_horaires_ligne_K4B_sept_2025.pdf',
    'K5': 'grandperigueux_fiche_horaires_ligne_K5_sept_2025.pdf',
    'K6': 'grandperigueux_fiche_horaires_ligne_K6_sept_2025.pdf',
    'N': 'grandperigueux_fiche_horaires_ligne_N_sept_2025.pdf',
    'N1': 'grandperigueux_fiche_horaires_ligne_N1_sept_2025.pdf',
};

// === Mappage des noms longs de lignes ===

/**
 * Mappage des noms courts de ligne vers les descriptions longues (terminus)
 */
export const ROUTE_LONG_NAME_MAP = {
    'A': 'ZAE Marsac <> Centre Hospitalier',
    'B': 'Les Tournesols <> Gare SNCF',
    'C': 'ZAE Marsac <> P+R Aquacap',
    'D': 'P+R Charrieras <> Tourny',
    'e1': 'ZAE Marsac <> P+R Aquacap',
    'e2': 'Talleyrand Périgord <> Fromarsac',
    'e4': 'Charrieras <> La Feuilleraie <> Tourny',
    'e5': 'Les Tournesols <> PEM',
    'e6': 'Créavallée <> Trésorerie municipale',
    'e7': 'Notre-Dame de Sanilhac poste <> Les Lilas hôpital',
    'K1A': 'Maison Rouge <> Tourny / La Rudeille <> Tourny',
    'K1B': 'Le Lac <> Pôle universitaire Grenadière <> Taillefer',
    'K2': 'Champcevinel bourg <> Tourny',
    'K3A': 'La Feuilleraie <> Place du 8 mai',
    'K3B': 'Pépinière <> Place du 8 mai',
    'K4A': 'Sarrazi <> Dojo départemental <> Tourny',
    'K4B': 'Coulounieix bourg <> Tourny',
    'K5': 'Halte ferroviaire Boulazac <> La Feuilleraie',
    'K6': 'Halte ferroviaire Marsac sur l\'Isle',
    'N': 'Tourny <> PEM',
    'N1': 'Gare SNCF <> 8 mai <> Tourny <> Gare SNCF',
};

// === Fonctions utilitaires ===

/**
 * Récupère la catégorie d'une ligne à partir de son nom court
 * @param {string} routeShortName - Nom court de la ligne (ex: 'A', 'e1', 'K2')
 * @returns {string} - Identifiant de la catégorie ou 'autres'
 */
export function getCategoryForRoute(routeShortName) {
    for (const [categoryId, category] of Object.entries(LINE_CATEGORIES)) {
        if (category.lines.includes(routeShortName)) {
            return categoryId;
        }
    }
    return 'autres';
}

/**
 * Récupère les informations d'une catégorie
 * @param {string} categoryId - Identifiant de la catégorie
 * @returns {Object|null} - Informations de la catégorie ou null
 */
export function getCategoryInfo(categoryId) {
    return LINE_CATEGORIES[categoryId] || null;
}

/**
 * Récupère le chemin vers le PDF d'une fiche horaire
 * @param {string} routeShortName - Nom court de la ligne
 * @returns {string} - Chemin vers le PDF ou '#' si non trouvé
 */
export function getPdfPath(routeShortName) {
    const filename = PDF_FILENAME_MAP[routeShortName];
    return filename ? `/data/fichehoraire/${filename}` : '#';
}

/**
 * Récupère le nom long d'une ligne
 * @param {string} routeShortName - Nom court de la ligne
 * @param {string} fallback - Valeur par défaut si non trouvé
 * @returns {string} - Nom long de la ligne
 */
export function getRouteLongName(routeShortName, fallback = '') {
    return ROUTE_LONG_NAME_MAP[routeShortName] || fallback;
}

/**
 * Vérifie si une ligne appartient à une catégorie affichée dans le trafic
 * @param {string} routeShortName - Nom court de la ligne
 * @returns {boolean} - true si la ligne doit être affichée
 */
export function isDisplayableInTraffic(routeShortName) {
    const allowedCategories = ['majeures', 'express', 'quartier', 'navettes'];
    const category = getCategoryForRoute(routeShortName);
    return allowedCategories.includes(category);
}

export default {
    LINE_CATEGORIES,
    PDF_FILENAME_MAP,
    ROUTE_LONG_NAME_MAP,
    getCategoryForRoute,
    getCategoryInfo,
    getPdfPath,
    getRouteLongName,
    isDisplayableInTraffic
};
