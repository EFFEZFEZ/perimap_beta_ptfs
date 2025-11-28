/**
 * viewController.js - Contrôleur de navigation entre vues
 * 
 * Ce module gère la navigation entre les différentes vues de l'application :
 * - Hall (accueil)
 * - Carte
 * - Résultats d'itinéraire
 * - Détail d'itinéraire
 * - Sous-vues du dashboard (horaires, info-trafic)
 */

// === État de la vue ===

let currentView = 'hall';

// === Références DOM (initialisées par init()) ===

let dashboardContainer = null;
let dashboardHall = null;
let dashboardContentView = null;
let mapContainer = null;
let itineraryResultsContainer = null;
let itineraryDetailContainer = null;
let itineraryDetailBackdrop = null;
let resultsListContainer = null;

// === Callbacks (fournis par init()) ===

let onBeforeViewChange = null;
let onAfterViewChange = null;
let invalidateMapSize = null;

// === Constantes ===

const DETAIL_SHEET_TRANSITION_MS = 300;

// === Fonctions publiques ===

/**
 * Initialise le contrôleur de vue avec les références DOM et callbacks
 * @param {Object} config - Configuration
 * @param {Object} config.elements - Éléments DOM
 * @param {Object} config.callbacks - Callbacks
 */
export function init(config) {
    const { elements, callbacks = {} } = config;
    
    // Stocker les références DOM
    dashboardContainer = elements.dashboardContainer;
    dashboardHall = elements.dashboardHall;
    dashboardContentView = elements.dashboardContentView;
    mapContainer = elements.mapContainer;
    itineraryResultsContainer = elements.itineraryResultsContainer;
    itineraryDetailContainer = elements.itineraryDetailContainer;
    itineraryDetailBackdrop = elements.itineraryDetailBackdrop;
    resultsListContainer = elements.resultsListContainer;
    
    // Stocker les callbacks
    onBeforeViewChange = callbacks.onBeforeViewChange || (() => {});
    onAfterViewChange = callbacks.onAfterViewChange || (() => {});
    invalidateMapSize = callbacks.invalidateMapSize || (() => {});
}

/**
 * Récupère la vue actuelle
 * @returns {string}
 */
export function getCurrentView() {
    return currentView;
}

/**
 * Affiche la vue carte
 */
export function showMapView() {
    onBeforeViewChange('map');
    
    dashboardContainer?.classList.add('hidden');
    itineraryResultsContainer?.classList.add('hidden');
    resetDetailViewState();
    mapContainer?.classList.remove('hidden');
    document.body.classList.add('view-is-locked');
    
    currentView = 'map';
    
    // Invalider la taille de la carte après affichage
    invalidateMapSize('map');
    
    onAfterViewChange('map');
}

/**
 * Affiche le hall (accueil)
 */
export function showDashboardHall() {
    onBeforeViewChange('hall');
    
    dashboardContainer?.classList.remove('hidden');
    itineraryResultsContainer?.classList.add('hidden');
    resetDetailViewState();
    mapContainer?.classList.add('hidden');
    document.body.classList.remove('view-is-locked');
    
    currentView = 'hall';
    
    dashboardContentView?.classList.remove('view-is-active');
    dashboardHall?.classList.add('view-is-active');
    
    // Retirer les vues actives des cartes
    document.querySelectorAll('#dashboard-content-view .card').forEach(card => {
        card.classList.remove('view-active');
    });
    
    onAfterViewChange('hall');
}

/**
 * Affiche la vue des résultats d'itinéraire
 */
export function showResultsView() {
    onBeforeViewChange('results');
    
    dashboardContainer?.classList.add('hidden');
    itineraryResultsContainer?.classList.remove('hidden');
    resetDetailViewState();
    mapContainer?.classList.add('hidden');
    document.body.classList.add('view-is-locked');
    
    currentView = 'results';
    
    if (resultsListContainer) {
        resultsListContainer.innerHTML = '<p class="results-message">Recherche d\'itinéraire en cours...</p>';
    }
    
    // Invalider la taille de la carte des résultats après affichage
    setTimeout(() => invalidateMapSize('results'), 10);
    
    onAfterViewChange('results');
}

/**
 * Affiche une sous-vue du dashboard (horaires, info-trafic, etc.)
 * @param {string} viewName - Nom de la vue à afficher
 */
export function showDashboardView(viewName) {
    onBeforeViewChange(viewName);
    
    dashboardHall?.classList.remove('view-is-active');
    dashboardContentView?.classList.add('view-is-active');
    
    // Scroller vers le haut
    window.scrollTo({ top: 0, behavior: 'auto' });
    
    // Retirer le verrouillage du scroll pour les sous-vues
    document.body.classList.remove('view-is-locked');
    
    currentView = viewName;
    
    // Retirer la classe active de toutes les cartes
    document.querySelectorAll('#dashboard-content-view .card').forEach(card => {
        card.classList.remove('view-active');
    });
    
    // Activer la carte correspondante
    const activeCard = document.getElementById(viewName);
    if (activeCard) {
        setTimeout(() => {
            activeCard.classList.add('view-active');
        }, 50);
    }
    
    onAfterViewChange(viewName);
}

/**
 * Affiche la vue détail d'itinéraire (mobile)
 * @param {Object} options - Options
 * @param {Object} options.routeLayer - Couche Leaflet du tracé
 * @param {Function} options.initBottomSheet - Fonction d'initialisation du bottom sheet
 * @param {Function} options.prepareBottomSheet - Fonction de préparation du bottom sheet
 * @param {number} options.defaultLevelIndex - Index du niveau par défaut
 */
export function showDetailView(options = {}) {
    const { routeLayer, initBottomSheet, prepareBottomSheet, defaultLevelIndex = 0 } = options;
    
    if (!itineraryDetailContainer) return;
    
    onBeforeViewChange('detail');
    
    // Initialiser le bottom sheet si fourni
    if (initBottomSheet) initBottomSheet();
    if (prepareBottomSheet) prepareBottomSheet(true);
    
    itineraryDetailContainer.classList.remove('hidden');
    itineraryDetailContainer.classList.remove('is-scrolled');
    
    if (itineraryDetailBackdrop) {
        itineraryDetailBackdrop.classList.remove('hidden');
        requestAnimationFrame(() => itineraryDetailBackdrop.classList.add('is-active'));
    }
    
    currentView = 'detail';
    
    // Invalider la taille de la carte détail
    invalidateMapSize('detail');
    
    // Activer après un court délai pour l'animation CSS
    setTimeout(() => {
        itineraryDetailContainer?.classList.add('is-active');
        
        // Zoomer sur le tracé si fourni
        if (routeLayer && options.map) {
            try {
                const bounds = routeLayer.getBounds();
                if (bounds.isValid()) {
                    options.map.fitBounds(bounds, { padding: [20, 20] });
                }
            } catch (e) {
                console.error("Erreur lors du fitBounds sur la carte détail:", e);
            }
        }
        
        onAfterViewChange('detail');
    }, 10);
}

/**
 * Masque la vue détail d'itinéraire
 * @param {Function} cancelDrag - Fonction pour annuler le drag du bottom sheet
 */
export function hideDetailView(cancelDrag) {
    if (!itineraryDetailContainer) return;
    
    onBeforeViewChange('results');
    
    if (cancelDrag) cancelDrag();
    
    itineraryDetailContainer.classList.remove('is-active');
    itineraryDetailContainer.classList.remove('is-scrolled');
    
    if (itineraryDetailBackdrop) {
        itineraryDetailBackdrop.classList.remove('is-active');
    }
    
    currentView = 'results';
    
    // Masquer après la transition
    setTimeout(() => {
        resetDetailViewState();
        onAfterViewChange('results');
    }, DETAIL_SHEET_TRANSITION_MS);
}

/**
 * Réinitialise l'état de la vue détail
 * @param {Object} options - Options de nettoyage
 */
export function resetDetailViewState(options = {}) {
    const { 
        detailBottomSheet,
        detailPanelContent,
        detailPanelWrapper,
        currentDetailRouteLayer,
        currentDetailMarkerLayer,
        detailMapRenderer
    } = options;
    
    if (!itineraryDetailContainer) return;
    
    itineraryDetailContainer.classList.add('hidden');
    itineraryDetailContainer.classList.remove('is-active');
    itineraryDetailContainer.classList.remove('is-scrolled');
    
    if (detailBottomSheet) {
        detailBottomSheet.classList.remove('is-dragging');
        itineraryDetailContainer.classList.remove('sheet-is-dragging');
        detailBottomSheet.classList.remove('sheet-height-no-transition');
        detailBottomSheet.style.removeProperty('--sheet-height');
    }
    
    // Reset scroll
    if (detailPanelWrapper) {
        detailPanelWrapper.scrollTop = 0;
        detailPanelWrapper.scrollLeft = 0;
    }
    
    // Vider le contenu
    if (detailPanelContent) {
        detailPanelContent.innerHTML = '';
    }
    
    // Supprimer les couches de la carte
    if (currentDetailRouteLayer && detailMapRenderer?.map) {
        detailMapRenderer.map.removeLayer(currentDetailRouteLayer);
    }
    
    if (currentDetailMarkerLayer) {
        currentDetailMarkerLayer.clearLayers();
    }
    
    // Masquer le backdrop
    if (itineraryDetailBackdrop) {
        itineraryDetailBackdrop.classList.remove('is-active');
        itineraryDetailBackdrop.classList.add('hidden');
    }
}

/**
 * Vérifie si on est sur mobile
 * @returns {boolean}
 */
export function isMobileViewport() {
    return window.innerWidth <= 768;
}

/**
 * Vérifie si une vue est actuellement affichée
 * @param {string} viewName - Nom de la vue
 * @returns {boolean}
 */
export function isViewActive(viewName) {
    return currentView === viewName;
}

export default {
    init,
    getCurrentView,
    showMapView,
    showDashboardHall,
    showResultsView,
    showDashboardView,
    showDetailView,
    hideDetailView,
    resetDetailViewState,
    isMobileViewport,
    isViewActive
};
