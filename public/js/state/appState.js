/**
 * appState.js - État centralisé de l'application
 * 
 * Ce module centralise toutes les variables d'état globales de l'application
 * pour une meilleure maintenabilité et traçabilité des changements d'état.
 */

/**
 * Configuration par défaut du bottom sheet
 */
export const BOTTOM_SHEET_CONFIG = {
    LEVELS: [0.4, 0.8], // Seulement 2 niveaux: peek (40%) et expanded (80%)
    DEFAULT_INDEX: 0,
    DRAG_ZONE_PX: 110,
    SCROLL_UNLOCK_THRESHOLD: 4, // px tolerance before locking drag
    EXPANDED_LEVEL_INDEX: 1, // Index du niveau expanded (80%)
    VELOCITY_THRESHOLD: 0.35, // px per ms
    MIN_DRAG_DISTANCE_PX: 45, // px delta before forcing next snap
    DRAG_BUFFER_PX: 20, // Zone au-dessus du sheet où on peut commencer le drag
    TRANSITION_MS: 300
};

/**
 * État global de l'application
 */
export const AppState = {
    // === État de la recherche ===
    search: {
        fromPlaceId: null,
        toPlaceId: null,
        lastSearchTime: null,
        lastSearchMode: null, // 'partir' | 'arriver'
        loadMoreOffset: 0,
        inProgress: false
    },

    // === État des itinéraires ===
    itineraries: {
        all: [],
        arrivalRankedAll: [],
        arrivalRenderedCount: 0,
        pageSize: 5
    },

    // === État du bottom sheet ===
    bottomSheet: {
        currentLevelIndex: BOTTOM_SHEET_CONFIG.DEFAULT_INDEX,
        dragState: null,
        controlsInitialized: false
    },

    // === État des lignes ===
    lines: {
        statuses: {}, // { route_id: { status: 'normal' | 'retard' | 'annulation', message: '' } }
        visible: new Set()
    },

    // === État des couches carte ===
    mapLayers: {
        detailRoute: null,
        resultsRoute: null,
        detailMarker: null,
        resultsMarker: null
    },

    // === Feature flags ===
    flags: {
        gtfsAvailable: true
    },

    // === Méthodes de mise à jour ===

    /**
     * Réinitialise l'état de recherche pour une nouvelle recherche
     */
    resetSearch() {
        this.search.lastSearchMode = null;
        this.search.loadMoreOffset = 0;
        this.itineraries.all = [];
        this.itineraries.arrivalRankedAll = [];
        this.itineraries.arrivalRenderedCount = 0;
    },

    /**
     * Met à jour l'état de recherche
     */
    setSearchState(key, value) {
        if (key in this.search) {
            this.search[key] = value;
        }
    },

    /**
     * Met à jour les itinéraires
     */
    setItineraries(itineraries) {
        this.itineraries.all = itineraries || [];
    },

    /**
     * Met à jour l'état de pagination mode "arriver"
     */
    setArrivalState(rankedAll, renderedCount) {
        this.itineraries.arrivalRankedAll = rankedAll || [];
        this.itineraries.arrivalRenderedCount = renderedCount || 0;
    },

    /**
     * Met à jour le statut d'une ligne
     */
    setLineStatus(routeId, status, message = '') {
        this.lines.statuses[routeId] = { status, message };
    },

    /**
     * Réinitialise tous les statuts de ligne à 'normal'
     */
    resetLineStatuses() {
        Object.keys(this.lines.statuses).forEach(routeId => {
            this.lines.statuses[routeId] = { status: 'normal', message: '' };
        });
    },

    /**
     * Vérifie si le sheet est au niveau minimum
     */
    isSheetAtMinLevel() {
        return this.bottomSheet.currentLevelIndex === 0;
    },

    /**
     * Vérifie si le sheet est au niveau maximum
     */
    isSheetAtMaxLevel() {
        return this.bottomSheet.currentLevelIndex === BOTTOM_SHEET_CONFIG.LEVELS.length - 1;
    },

    /**
     * Retourne l'index du niveau le plus proche d'une fraction donnée
     */
    getClosestSheetLevelIndex(fraction) {
        let bestIdx = 0;
        let bestDistance = Infinity;
        BOTTOM_SHEET_CONFIG.LEVELS.forEach((level, idx) => {
            const distance = Math.abs(level - fraction);
            if (distance < bestDistance) {
                bestIdx = idx;
                bestDistance = distance;
            }
        });
        return bestIdx;
    }
};

export default AppState;
