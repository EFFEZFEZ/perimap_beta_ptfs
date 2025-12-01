/**
 * main.js - V61 (Refactoring modulaire)
 *
 * Version refactorisée avec modules séparés pour:
 * - État centralisé (state/appState.js)
 * - Formatage (utils/formatters.js)
 * - Configuration (config/icons.js, config/routes.js)
 * - Controllers (controllers/)
 * - UI (ui/)
 */

// === Imports des managers ===
import { DataManager } from './dataManager.js';
import { TimeManager } from './timeManager.js';
import { TripScheduler } from './tripScheduler.js';
import { BusPositionCalculator } from './busPositionCalculator.js';
import { MapRenderer } from './mapRenderer.js';
import { ApiManager } from './apiManager.js';
import { createRouterContext, encodePolyline, decodePolyline } from './router.js';
import { RouterWorkerClient } from './routerWorkerClient.js';
import { UIManager } from './uiManager.js';
import { createGeolocationManager } from './geolocationManager.js';
import { loadBaseLayout } from './viewLoader.js';

// === Imports des modules refactorisés ===
import { 
    isMeaningfulTime, 
    isMissingTextValue,
    getSafeStopLabel, 
    getSafeTimeLabel, 
    getSafeRouteBadgeLabel,
    hasStopMetadata,
    parseTimeStringToMinutes,
    formatMinutesToTimeString,
    addSecondsToTimeString,
    subtractSecondsFromTimeString,
    computeTimeDifferenceMinutes,
    formatGoogleTime,
    formatGoogleDuration,
    parseGoogleDuration
} from './utils/formatters.js';

import { getCategoryForRoute, LINE_CATEGORIES, PDF_FILENAME_MAP, ROUTE_LONG_NAME_MAP } from './config/routes.js';
import { ICONS, getManeuverIcon, getAlertBannerIcon } from './config/icons.js';

// Modules
let dataManager;
let timeManager;
let tripScheduler;
let busPositionCalculator;
let mapRenderer; // Carte temps réel
let detailMapRenderer; // Carte détail mobile
let resultsMapRenderer; // Carte résultats PC
let visibleRoutes = new Set();
let apiManager; 
let routerContext = null;
let routerWorkerClient = null;
let uiManager = null;
let resultsRenderer = null; // instance du renderer des résultats

// Feature flags
let gtfsAvailable = true; // set to false if GTFS loading fails -> degraded API-only mode

// ⚠️ V60: GTFS Router désactivé temporairement (performances insuffisantes)
// TODO: Améliorer l'algorithme de pathfinding avant de réactiver
const ENABLE_GTFS_ROUTER = false; // Mettre à true pour réactiver le routeur GTFS local

// État global
let lineStatuses = {}; 
let currentDetailRouteLayer = null; // Tracé sur la carte détail mobile
let currentResultsRouteLayer = null; // Tracé sur la carte PC
let currentDetailMarkerLayer = null; // ✅ NOUVEAU V46.1
let currentResultsMarkerLayer = null; // ✅ NOUVEAU V46.1
let allFetchedItineraries = []; // Stocke tous les itinéraires (bus/vélo/marche)
// Pagination / tri spécifique mode "arriver"
let lastSearchMode = null; // 'partir' | 'arriver'
let arrivalRankedAll = []; // Liste complète triée (arriver)
let arrivalRenderedCount = 0; // Combien affichés actuellement
let ARRIVAL_PAGE_SIZE = 5; // Limite initiale / pagination (surchargée par config runtime)

// V60: État pour charger plus de départs
let lastSearchTime = null; // Dernier searchTime utilisé
let loadMoreOffset = 0; // Décalage en minutes pour charger plus

let geolocationManager = null;

const BOTTOM_SHEET_LEVELS = [0.4, 0.8]; // Seulement 2 niveaux: peek (40%) et expanded (80%)
import { getAppConfig } from './config.js';
import { deduplicateItineraries, rankArrivalItineraries, rankDepartureItineraries, filterExpiredDepartures, filterLateArrivals, limitBikeWalkItineraries } from './itinerary/ranking.js';
import { normalizeStopNameForLookup, resolveStopCoordinates } from './utils/geo.js';
import { createResultsRenderer } from './ui/resultsRenderer.js';
const BOTTOM_SHEET_DEFAULT_INDEX = 0;
const BOTTOM_SHEET_DRAG_ZONE_PX = 110;
const APP_CONFIG = getAppConfig();
const GOOGLE_API_KEY = APP_CONFIG.googleApiKey; // dynamique (config.js), jamais hardcodé ici
ARRIVAL_PAGE_SIZE = APP_CONFIG.arrivalPageSize || ARRIVAL_PAGE_SIZE; // surcharge si fourni
const BOTTOM_SHEET_SCROLL_UNLOCK_THRESHOLD = 4; // px tolerance before locking drag
const BOTTOM_SHEET_EXPANDED_LEVEL_INDEX = 1; // Index du niveau expanded (80%)
const BOTTOM_SHEET_VELOCITY_THRESHOLD = 0.35; // px per ms
const BOTTOM_SHEET_MIN_DRAG_DISTANCE_PX = 45; // px delta before forcing next snap
const BOTTOM_SHEET_DRAG_BUFFER_PX = 20; // Zone au-dessus du sheet où on peut commencer le drag
let currentBottomSheetLevelIndex = BOTTOM_SHEET_DEFAULT_INDEX;
let bottomSheetDragState = null;
let bottomSheetControlsInitialized = false;

const isSheetAtMinLevel = () => currentBottomSheetLevelIndex === 0;
const isSheetAtMaxLevel = () => currentBottomSheetLevelIndex === BOTTOM_SHEET_LEVELS.length - 1;

// ICONS, ALERT_BANNER_ICONS, getManeuverIcon et getAlertBannerIcon sont importés depuis config/icons.js

// normalizeStopNameForLookup & resolveStopCoordinates importés depuis utils/geo.js

const STOP_ROLE_PRIORITY = {
    boarding: 4,
    alighting: 4,
    transfer: 3,
    intermediate: 1
};

function createStopDivIcon(role) {
    if (typeof L === 'undefined' || !L.divIcon) return null;
    const sizeMap = {
        boarding: 22,
        alighting: 22,
        transfer: 16,
        intermediate: 12
    };
    const size = sizeMap[role] || 12;
    return L.divIcon({
        className: `itinerary-stop-marker ${role}`,
        html: '<span></span>',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
    });
}

// ALERT_BANNER_ICONS et getAlertBannerIcon sont importés depuis config/icons.js

// isMissingTextValue, getSafeStopLabel, getSafeTimeLabel, getSafeRouteBadgeLabel, hasStopMetadata sont importées depuis utils/formatters.js

const shouldSuppressBusStep = (step) => {
    if (!step || step.type !== 'BUS') return false;
    const hasRoute = !isMissingTextValue(step.routeShortName);
    const hasBoardingInfo = hasStopMetadata(step.departureStop, step.departureTime);
    const hasAlightingInfo = hasStopMetadata(step.arrivalStop, step.arrivalTime);
    if (hasBoardingInfo || hasAlightingInfo) {
        return false;
    }
    if (!hasRoute) return true;
    const lacksIntermediateStops = !Array.isArray(step.intermediateStops) || step.intermediateStops.length === 0;
    return lacksIntermediateStops;
};

// computeTimeDifferenceMinutes est maintenant importée depuis utils/formatters.js

function getWaitStepPresentation(steps, index) {
    const step = steps?.[index] || {};
    const previousStep = index > 0 ? steps[index - 1] : null;
    const nextStep = index < steps.length - 1 ? steps[index + 1] : null;

    const fallbackTime = previousStep?.arrivalTime || step.time || step.arrivalTime || step.departureTime || nextStep?.departureTime;
    const diffFromNeighbors = computeTimeDifferenceMinutes(previousStep?.arrivalTime, nextStep?.departureTime);

    let waitMinutes = diffFromNeighbors;
    if (waitMinutes === null && typeof step._durationSeconds === 'number') {
        waitMinutes = Math.max(0, Math.round(step._durationSeconds / 60));
    }
    if (waitMinutes === null && typeof step.duration === 'string') {
        const match = step.duration.match(/(\d+)/);
        if (match) waitMinutes = parseInt(match[1], 10);
    }
    if (waitMinutes !== null && waitMinutes <= 0 && typeof step._durationSeconds === 'number' && step._durationSeconds > 0) {
        waitMinutes = 1;
    }

    const durationLabel = (waitMinutes !== null)
        ? `${waitMinutes} min`
        : (step.duration || 'Attente en cours');

    return {
        timeLabel: getSafeTimeLabel(fallbackTime),
        durationLabel
    };
}

/**
 * Fonction appelée lors du clic sur une carte d'itinéraire.
 * Affiche/masque les détails de l'itinéraire et met à jour la carte.
 * V59: Gère le cas mobile (vue overlay) vs desktop (accordéon inline)
 */
function onSelectItinerary(itinerary, cardEl) {
    if (!itinerary || !cardEl) return;

    // V59: Sur mobile, on affiche la vue détail overlay
    if (isMobileDetailViewport()) {
        // Marquer cette carte comme active visuellement
        document.querySelectorAll('.route-option').forEach(c => c.classList.remove('is-active'));
        cardEl.classList.add('is-active');
        
        // Rendre le détail dans la vue mobile et afficher l'overlay
        const routeLayer = renderItineraryDetail(itinerary);
        showDetailView(routeLayer);
        return;
    }

    // Desktop: comportement accordéon existant
    const wrapper = cardEl.closest('.route-option-wrapper');
    if (!wrapper) return;

    const detailsDiv = wrapper.querySelector('.route-details');
    if (!detailsDiv) return;

    const wasExpanded = !detailsDiv.classList.contains('hidden');

    // Fermer tous les autres détails ouverts
    document.querySelectorAll('.route-option-wrapper .route-details').forEach(d => {
        if (d !== detailsDiv) d.classList.add('hidden');
    });
    document.querySelectorAll('.route-option-wrapper .route-option').forEach(c => {
        if (c !== cardEl) c.classList.remove('is-active');
    });

    // Toggle l'état de cette carte
    if (wasExpanded) {
        detailsDiv.classList.add('hidden');
        cardEl.classList.remove('is-active');
    } else {
        // Générer le HTML des détails si pas encore fait
        if (!detailsDiv.innerHTML.trim()) {
            detailsDiv.innerHTML = renderItineraryDetailHTML(itinerary);
        }
        detailsDiv.classList.remove('hidden');
        cardEl.classList.add('is-active');

        // Mettre à jour la carte avec l'itinéraire sélectionné
        if (resultsMapRenderer) {
            drawRouteOnResultsMap(itinerary);
        }

        // Scroll vers la carte
        setTimeout(() => {
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
    }
}

uiManager = new UIManager({ icons: ICONS, geolocationManager: null });

/* ======================
 * UI Theme (Dark Mode)
 * - Persists user choice in localStorage ('ui-theme')
 * - Respects prefers-color-scheme when no saved choice
 * - Toggle button in header with id `theme-toggle-btn`
 * ======================
 */
function applyThemeState(useDarkParam) {
    if (!uiManager) return;
    uiManager.applyThemeState(useDarkParam, [mapRenderer, detailMapRenderer, resultsMapRenderer]);
}

function initTheme() {
    if (!uiManager) return;
    uiManager.initTheme([mapRenderer, detailMapRenderer, resultsMapRenderer]);
}

document.addEventListener('DOMContentLoaded', () => {
    // Wire theme toggle
    const tbtn = document.getElementById('theme-toggle-btn');
    if (tbtn) {
        tbtn.addEventListener('click', () => {
            const nextIsDark = !document.body.classList.contains('dark-theme');
            applyThemeState(nextIsDark);
            try { localStorage.setItem('ui-theme', nextIsDark ? 'dark' : 'light'); } catch (e) { /* ignore */ }
        }, { passive: true });
    }

    // Initialize UI theme immediately (no preloader)
    initTheme();
});

// Service Worker est enregistré dans app.js

// PDF_FILENAME_MAP et ROUTE_LONG_NAME_MAP sont maintenant importées depuis config/routes.js
// getManeuverIcon est maintenant importée depuis config/icons.js

// ÉLÉMENTS DOM
let dashboardContainer, dashboardHall, dashboardContentView, btnBackToHall;
let infoTraficList, infoTraficAvenir, infoTraficCount;
let alertBanner, alertBannerContent, alertBannerClose;
let ficheHoraireContainer;
let searchBar, searchResultsContainer;
let mapContainer, btnShowMap, btnBackToDashboardFromMap;
let itineraryResultsContainer, btnBackToDashboardFromResults, resultsListContainer;
let resultsMap, resultsModeTabs;
let resultsFromInput, resultsToInput, resultsFromSuggestions, resultsToSuggestions;
let resultsSwapBtn, resultsWhenBtn, resultsPopover, resultsDate, resultsHour, resultsMinute;
let resultsPopoverSubmitBtn, resultsPlannerSubmitBtn, resultsGeolocateBtn;
let itineraryDetailBackdrop, itineraryDetailContainer, btnBackToResults, detailMapHeader, detailMapSummary, detailBottomSheet;
let detailPanelWrapper, detailPanelContent;
let hallPlannerSubmitBtn, hallFromInput, hallToInput, hallFromSuggestions, hallToSuggestions;
let hallWhenBtn, hallPopover, hallDate, hallHour, hallMinute, hallPopoverSubmitBtn, hallSwapBtn, hallGeolocateBtn;
let installTipContainer, installTipCloseBtn;

let fromPlaceId = null;
let toPlaceId = null;

// LINE_CATEGORIES est maintenant importée depuis config/routes.js

const DETAIL_SHEET_TRANSITION_MS = 380; // Doit être >= à la transition CSS (350ms + marge)

// getCategoryForRoute est maintenant importée depuis config/routes.js

// Initialise toutes les références DOM
function initializeDomElements() {
    dashboardContainer = document.getElementById('dashboard-container');
    dashboardHall = document.getElementById('dashboard-hall');
    dashboardContentView = document.getElementById('dashboard-content-view');
    btnBackToHall = document.getElementById('btn-back-to-hall');
    infoTraficList = document.getElementById('info-trafic-list');
    infoTraficAvenir = document.getElementById('info-trafic-avenir');
    infoTraficCount = document.getElementById('info-trafic-count');
    alertBanner = document.getElementById('alert-banner');
    alertBannerContent = document.getElementById('alert-banner-content');
    alertBannerClose = document.getElementById('alert-banner-close');
    ficheHoraireContainer = document.getElementById('fiche-horaire-container');
    searchBar = document.getElementById('horaires-search-bar');
    searchResultsContainer = document.getElementById('horaires-search-results');
    mapContainer = document.getElementById('map-container');
    btnShowMap = document.getElementById('btn-show-map');
    btnBackToDashboardFromMap = document.getElementById('btn-back-to-dashboard-from-map');
    itineraryResultsContainer = document.getElementById('itinerary-results-container');
    btnBackToDashboardFromResults = document.getElementById('btn-back-to-dashboard-from-results');
    resultsListContainer = document.querySelector('#itinerary-results-container .results-list');
    resultsMap = document.getElementById('results-map'); 
    resultsModeTabs = document.getElementById('results-mode-tabs');
    resultsFromInput = document.getElementById('results-planner-from');
    resultsToInput = document.getElementById('results-planner-to');
    resultsFromSuggestions = document.getElementById('results-from-suggestions');
    resultsToSuggestions = document.getElementById('results-to-suggestions');
    resultsSwapBtn = document.getElementById('results-btn-swap-direction');
    resultsWhenBtn = document.getElementById('results-planner-when-btn');
    resultsPopover = document.getElementById('results-planner-options-popover');
    resultsDate = document.getElementById('results-popover-date');
    resultsHour = document.getElementById('results-popover-hour');
    resultsMinute = document.getElementById('results-popover-minute');
    resultsPopoverSubmitBtn = document.getElementById('results-popover-submit-btn');
    resultsPlannerSubmitBtn = document.getElementById('results-planner-submit-btn');
    resultsGeolocateBtn = document.getElementById('results-geolocate-btn');
    itineraryDetailBackdrop = document.getElementById('itinerary-detail-backdrop');
    itineraryDetailContainer = document.getElementById('itinerary-detail-container');
    detailBottomSheet = document.getElementById('detail-bottom-sheet');
    btnBackToResults = document.getElementById('btn-back-to-results');
    detailMapHeader = document.getElementById('detail-map-header');
    detailMapSummary = document.getElementById('detail-map-summary');
    detailPanelWrapper = document.getElementById('detail-panel-wrapper');
    detailPanelContent = document.getElementById('detail-panel-content');
    hallPlannerSubmitBtn = document.getElementById('planner-submit-btn');
    hallFromInput = document.getElementById('hall-planner-from');
    hallToInput = document.getElementById('hall-planner-to');
    hallFromSuggestions = document.getElementById('from-suggestions');
    hallToSuggestions = document.getElementById('to-suggestions');
    hallSwapBtn = document.getElementById('hall-btn-swap-direction');
    hallWhenBtn = document.getElementById('planner-when-btn');
    hallPopover = document.getElementById('planner-options-popover');
    hallDate = document.getElementById('popover-date');
    hallHour = document.getElementById('popover-hour');
    hallMinute = document.getElementById('popover-minute');
    hallPopoverSubmitBtn = document.getElementById('popover-submit-btn');
    hallGeolocateBtn = document.getElementById('hall-geolocate-btn');
    installTipContainer = document.getElementById('install-tip');
    installTipCloseBtn = document.getElementById('install-tip-close');
}

async function initializeApp() {
    // Initialise les références DOM
    initializeDomElements();

    // Instanciation du renderer (après sélection des éléments DOM)
    resultsRenderer = createResultsRenderer({
        resultsListContainer,
        resultsModeTabs,
        getAllItineraries: () => allFetchedItineraries,
        getArrivalState: () => ({ lastSearchMode, arrivalRankedAll, arrivalRenderedCount, pageSize: ARRIVAL_PAGE_SIZE }),
        setArrivalRenderedCount: (val) => { arrivalRenderedCount = val; },
        onSelectItinerary: (itinerary, cardEl) => onSelectItinerary(itinerary, cardEl),
        onLoadMoreDepartures: () => loadMoreDepartures(), // V60: Charger plus de départs
        getDataManager: () => dataManager // V64: Accès aux données GTFS pour prochains départs
    });

    apiManager = new ApiManager(GOOGLE_API_KEY);
    dataManager = new DataManager();
    routerContext = createRouterContext({ dataManager, apiManager, icons: ICONS });

    geolocationManager = createGeolocationManager({
        apiManager,
        icons: ICONS,
        onUserLocationUpdate: (coords) => {
            if (mapRenderer) mapRenderer.updateUserLocation(coords);
            if (resultsMapRenderer) resultsMapRenderer.updateUserLocation(coords);
            if (detailMapRenderer) detailMapRenderer.updateUserLocation(coords);
        },
        onUserLocationError: () => {
            if (mapRenderer) mapRenderer.onLocateError();
            if (resultsMapRenderer) resultsMapRenderer.onLocateError();
            if (detailMapRenderer) detailMapRenderer.onLocateError();
        }
    });

    uiManager = new UIManager({ icons: ICONS, geolocationManager });

    setupStaticEventListeners();
    if (geolocationManager) {
        geolocationManager.startWatching({
            hallButton: hallGeolocateBtn,
            resultsButton: resultsGeolocateBtn
        });
    }
    updateDataStatus('Chargement des données...', 'loading');

    try {
        await dataManager.loadAllData((message) => updateDataStatus(message, 'loading'));
        timeManager = new TimeManager();
        
        mapRenderer = new MapRenderer('map', dataManager, timeManager);
        mapRenderer.initializeMap();
        const locateSuccess = geolocationManager?.handleGeolocationSuccess || (() => {});
        const locateError = geolocationManager?.handleGeolocationError || (() => {});
        mapRenderer.addLocateControl(locateSuccess, locateError);

        // Exposer mapRenderer et dataManager globalement pour le système de retards et crowdsourcing
        window.mapRenderer = mapRenderer;
        window.dataManager = dataManager;
        
        // Injecter dataManager dans le CrowdsourcingManager
        if (typeof CrowdsourcingManager !== 'undefined' && CrowdsourcingManager.setDataManager) {
            CrowdsourcingManager.setDataManager(dataManager);
        }
        
        window.addDelayedBusMarker = (delayInfo) => {
            if (mapRenderer && typeof mapRenderer.addDelayedBusMarker === 'function') {
                mapRenderer.addDelayedBusMarker(delayInfo);
            }
        };

        detailMapRenderer = new MapRenderer('detail-map', dataManager, timeManager);
        detailMapRenderer.initializeMap(false);
        currentDetailMarkerLayer = L.layerGroup().addTo(detailMapRenderer.map);
        detailMapRenderer.addLocateControl(locateSuccess, locateError);
        
        resultsMapRenderer = new MapRenderer('results-map', dataManager, timeManager);
        resultsMapRenderer.initializeMap(false);
        currentResultsMarkerLayer = L.layerGroup().addTo(resultsMapRenderer.map);
        resultsMapRenderer.addLocateControl(locateSuccess, locateError);
        
        tripScheduler = new TripScheduler(dataManager);
        busPositionCalculator = new BusPositionCalculator(dataManager);
        
        initializeRouteFilter();

        // ⚠️ V60: Router GTFS désactivé temporairement pour performances
        // TODO: Réactiver quand l'algorithme sera optimisé
        if (ENABLE_GTFS_ROUTER) {
            try {
                const geocodeProxyUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/geocode` : '/api/geocode';
                routerWorkerClient = new RouterWorkerClient({
                    dataManager,
                    icons: ICONS,
                    googleApiKey: GOOGLE_API_KEY,
                    geocodeProxyUrl
                });
                console.log('🔧 Router GTFS local activé');
            } catch (error) {
                console.warn('Router worker indisponible, fallback main thread.', error);
                routerWorkerClient = null;
            }
        } else {
            console.log('⏸️ Router GTFS local désactivé (ENABLE_GTFS_ROUTER=false)');
            routerWorkerClient = null;
            routerContext = null;
        }

        try {
            await dataManager.optimizeStopTimesStorage();
        } catch (error) {
            console.warn('Impossible d’optimiser le stockage des stop_times:', error);
        }
        
        if (dataManager.geoJson) {
            mapRenderer.displayMultiColorRoutes(dataManager.geoJson, dataManager, visibleRoutes);
        }

        mapRenderer.displayStops();
        setupDashboardContent(); 
        setupDataDependentEventListeners();

        if (localStorage.getItem('gtfsInstructionsShown') !== 'true') {
            document.getElementById('instructions').classList.add('hidden');
        }
        
        updateDataStatus('Données chargées', 'loaded');
        checkAndSetupTimeMode();
        updateData(); 
        
    } catch (error) {
        console.error('Erreur lors de l\'initialisation GTFS:', error);
        gtfsAvailable = false;
        updateDataStatus('GTFS indisponible. Mode dégradé (API seule).', 'warning');
    }

    // Attach robust handlers for back buttons and condensed nav (extra safety)
    try {
        attachRobustBackHandlers();
    } catch (e) { console.debug('attachRobustBackHandlers failed', e); }
}

function attachRobustBackHandlers() {
    const backIds = ['btn-back-to-hall', 'btn-back-to-dashboard-from-map', 'btn-back-to-dashboard-from-results'];
    backIds.forEach(id => {
        // fix duplicate ids: if multiple elements share the same id, rename extras
        const duplicates = Array.from(document.querySelectorAll(`#${id}`));
        if (duplicates.length > 1) {
            console.warn('attachRobustBackHandlers: duplicate id detected', id, duplicates.length);
            duplicates.forEach((el, idx) => {
                if (idx === 0) return; // keep first
                const newId = `${id}-dup-${idx}`;
                el.id = newId;
                console.warn('attachRobustBackHandlers: renamed duplicate id', id, '->', newId, el);
            });
        }

        const el = document.getElementById(id);
        if (!el) {
            console.debug('attachRobustBackHandlers: missing element', id);
            return;
        }
        // remove duplicate handlers if any
        try { el.removeEventListener('click', showDashboardHall); } catch (e) {}
        el.disabled = false;
        el.style.pointerEvents = 'auto';
        el.style.zIndex = el.style.zIndex || 2000;
        el.addEventListener('click', (ev) => {
            ev.preventDefault();
            console.debug('robust-back-click:', id);
            showDashboardHall();
        });
    });

    // Ensure service cards are clickable (new IDFM-style design)
    document.querySelectorAll('.service-card[data-view]').forEach(btn => {
        btn.style.pointerEvents = 'auto';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const view = btn.dataset.view;
            console.debug('robust-nav-click', view);
            if (view) showDashboardView(view);
        });
    });

    // Temporary pointer diagnostics to help debug covered/blocked buttons.
    // Active for 25 seconds after initialization; logs element at pointer location.
    try {
        const DEBUG_DURATION_MS = 25000;
        const start = Date.now();
        const pd = (ev) => {
            try {
                if ((Date.now() - start) > DEBUG_DURATION_MS) {
                    document.removeEventListener('pointerdown', pd, true);
                    return;
                }
                const x = ev.clientX, y = ev.clientY;
                const elAt = document.elementFromPoint(x, y);
                console.debug('pointerdown-debug', { x, y, target: ev.target && ev.target.id, elementAtPoint: elAt && (elAt.id || elAt.className || elAt.tagName) });
            } catch (err) { /* ignore */ }
        };
        document.addEventListener('pointerdown', pd, true);
        console.info('Back-button pointer diagnostics active for 25s. Click the problematic area and check console for `pointerdown-debug`.');
    } catch (e) { /* ignore */ }
}

function setupDashboardContent() {
    dataManager.routes.forEach(route => {
        lineStatuses[route.route_id] = { status: 'normal', message: '' };
    });
    renderInfoTraficCard();
    buildFicheHoraireList();
}

// Fonction d'animation générique (DÉPLACÉE EN DEHORS)
function animateValue(obj, start, end, duration, suffix = "") {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        
        // Easing function (pour que ça ralentisse à la fin)
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);
        
        const value = Math.floor(easeOutQuart * (end - start) + start);
        
        // Gestion spéciale pour les nombres à virgule (comme 2.1M)
        if (suffix === "M" && end === 2.1) {
             obj.innerHTML = (easeOutQuart * 2.1).toFixed(1) + suffix;
        } else {
             obj.innerHTML = value + suffix;
        }

        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
             // S'assurer que la valeur finale est exacte
             obj.innerHTML = end + suffix;
        }
    };
    window.requestAnimationFrame(step);
}

function populateTimeSelects() {
    if (!uiManager) return;
    uiManager.populateTimeSelects({
        hall: { dateEl: hallDate, hourEl: hallHour, minEl: hallMinute },
        results: { dateEl: resultsDate, hourEl: resultsHour, minEl: resultsMinute }
    });
}

const isInstallTipVisible = () => installTipContainer && !installTipContainer.classList.contains('hidden');

function hideInstallTip() {
    if (!installTipContainer) return;
    installTipContainer.classList.add('hidden');
    installTipContainer.setAttribute('aria-hidden', 'true');
    installTipContainer.removeAttribute('aria-modal');
}

function showInstallTip() {
    if (!installTipContainer) return;
    installTipContainer.classList.remove('hidden');
    installTipContainer.setAttribute('aria-hidden', 'false');
    installTipContainer.setAttribute('aria-modal', 'true');
    if (installTipCloseBtn) {
        installTipCloseBtn.focus();
    }
}

function handleInstallTipKeydown(event) {
    if (event.key === 'Escape' && isInstallTipVisible()) {
        hideInstallTip();
    }
}

function isMobileDetailViewport() {
    return window.innerWidth <= 768;
}

function getViewportHeight() {
    return Math.max(window.innerHeight, document.documentElement?.clientHeight || 0);
}

function getCurrentSheetHeightPx() {
    if (!detailBottomSheet) return 0;
    const inlineValue = parseFloat(detailBottomSheet.style.getPropertyValue('--sheet-height'));
    if (Number.isFinite(inlineValue)) {
        return inlineValue;
    }
    const viewportHeight = getViewportHeight();
    return viewportHeight * BOTTOM_SHEET_LEVELS[currentBottomSheetLevelIndex];
}

function applyBottomSheetLevel(index, { immediate = false } = {}) {
    if (!detailBottomSheet || !isMobileDetailViewport()) return;
    const targetIndex = Math.max(0, Math.min(BOTTOM_SHEET_LEVELS.length - 1, index));
    currentBottomSheetLevelIndex = targetIndex;
    const viewportHeight = getViewportHeight();
    if (!viewportHeight) return;
    const targetPx = Math.round(viewportHeight * BOTTOM_SHEET_LEVELS[targetIndex]);
    if (immediate) {
        detailBottomSheet.classList.add('sheet-height-no-transition');
    }
    detailBottomSheet.style.setProperty('--sheet-height', `${targetPx}px`);
    
    // V60: Ajouter/retirer la classe is-expanded selon le niveau
    if (targetIndex >= BOTTOM_SHEET_EXPANDED_LEVEL_INDEX) {
        detailBottomSheet.classList.add('is-expanded');
    } else {
        detailBottomSheet.classList.remove('is-expanded');
        // Reset le scroll quand on réduit le sheet
        if (detailPanelWrapper) {
            detailPanelWrapper.scrollTop = 0;
        }
    }
    
    if (immediate) {
        requestAnimationFrame(() => detailBottomSheet?.classList.remove('sheet-height-no-transition'));
    }
}

function prepareBottomSheetForViewport(immediate = false) {
    if (!detailBottomSheet) return;
    if (!isMobileDetailViewport()) {
        detailBottomSheet.style.removeProperty('--sheet-height');
        return;
    }
    applyBottomSheetLevel(currentBottomSheetLevelIndex, { immediate });
}

function handleBottomSheetResize() {
    if (!detailBottomSheet) return;
    if (!isMobileDetailViewport()) {
        detailBottomSheet.style.removeProperty('--sheet-height');
        cancelBottomSheetDrag();
        return;
    }
    applyBottomSheetLevel(currentBottomSheetLevelIndex, { immediate: true });
}

function getClosestSheetLevelIndex(fraction) {
    let bestIdx = 0;
    let bestDistance = Infinity;
    BOTTOM_SHEET_LEVELS.forEach((level, idx) => {
        const distance = Math.abs(level - fraction);
        if (distance < bestDistance) {
            bestIdx = idx;
            bestDistance = distance;
        }
    });
    return bestIdx;
}

function isPointerWithinBottomSheetDragRegion(event) {
    if (!detailBottomSheet) return false;
    const rect = detailBottomSheet.getBoundingClientRect();
    const topBoundary = rect.top - BOTTOM_SHEET_DRAG_BUFFER_PX;
    const bottomBoundary = rect.top + BOTTOM_SHEET_DRAG_ZONE_PX;
    return event.clientY >= topBoundary && event.clientY <= bottomBoundary;
}

function cancelBottomSheetDrag() {
    if (!bottomSheetDragState) return;
    window.removeEventListener('pointermove', onBottomSheetPointerMove);
    window.removeEventListener('pointerup', onBottomSheetPointerUp);
    window.removeEventListener('pointercancel', onBottomSheetPointerUp);
    if (detailBottomSheet && bottomSheetDragState.pointerId !== undefined) {
        try { detailBottomSheet.releasePointerCapture(bottomSheetDragState.pointerId); } catch (_) { /* ignore */ }
    }
    detailBottomSheet?.classList.remove('is-dragging');
    bottomSheetDragState = null;
}

function onBottomSheetPointerDown(event) {
    if (!isMobileDetailViewport() || !detailBottomSheet || !itineraryDetailContainer?.classList.contains('is-active')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    
    const isHandle = Boolean(event.target.closest('.panel-handle'));
    const inDragRegion = isPointerWithinBottomSheetDragRegion(event);
    const inSheetContent = Boolean(event.target.closest('#detail-panel-wrapper'));
    const isExpanded = currentBottomSheetLevelIndex >= BOTTOM_SHEET_EXPANDED_LEVEL_INDEX;
    const wrapperScroll = detailPanelWrapper ? detailPanelWrapper.scrollTop : 0;
    
    // V60: Si pas expanded, on peut drag depuis n'importe où sur le sheet
    if (!isExpanded) {
        // Permettre le drag depuis la handle, la zone de drag, ou le contenu
        if (!isHandle && !inDragRegion && !inSheetContent) return;
    } else {
        // Si expanded, on ne peut drag que depuis la handle ou si on est au top du scroll
        const canUseContentDrag = inSheetContent && wrapperScroll <= BOTTOM_SHEET_SCROLL_UNLOCK_THRESHOLD;
        if (!isHandle && !inDragRegion && !canUseContentDrag) return;
    }
    
    event.preventDefault();
    bottomSheetDragState = {
        pointerId: event.pointerId,
        startY: event.clientY,
        lastClientY: event.clientY,
        startHeight: getCurrentSheetHeightPx(),
        lastHeight: null,
        lastEventTime: performance.now(),
        velocity: 0,
        startIndex: currentBottomSheetLevelIndex
    };
    detailBottomSheet.classList.add('is-dragging');
    itineraryDetailContainer?.classList.add('sheet-is-dragging');
    try { detailBottomSheet.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
    window.addEventListener('pointermove', onBottomSheetPointerMove, { passive: false });
    window.addEventListener('pointerup', onBottomSheetPointerUp);
    window.addEventListener('pointercancel', onBottomSheetPointerUp);
}

function onBottomSheetPointerMove(event) {
    if (!bottomSheetDragState || !detailBottomSheet) return;
    event.preventDefault();
    const viewportHeight = getViewportHeight();
    if (!viewportHeight) return;
    const deltaY = bottomSheetDragState.startY - event.clientY;
    const minHeight = viewportHeight * BOTTOM_SHEET_LEVELS[0];
    const maxHeight = viewportHeight * BOTTOM_SHEET_LEVELS[BOTTOM_SHEET_LEVELS.length - 1];
    let nextHeight = bottomSheetDragState.startHeight + deltaY;
    nextHeight = Math.max(minHeight, Math.min(maxHeight, nextHeight));
    const now = performance.now();
    if (bottomSheetDragState.lastHeight !== null) {
        const deltaHeight = nextHeight - bottomSheetDragState.lastHeight;
        const elapsed = now - (bottomSheetDragState.lastEventTime || now);
        if (elapsed > 0) {
            bottomSheetDragState.velocity = deltaHeight / elapsed;
        }
    }
    bottomSheetDragState.lastHeight = nextHeight;
    bottomSheetDragState.lastClientY = event.clientY;
    bottomSheetDragState.lastEventTime = now;
    detailBottomSheet.style.setProperty('--sheet-height', `${nextHeight}px`);
}

function onBottomSheetPointerUp() {
    if (!bottomSheetDragState) return;
    const viewportHeight = getViewportHeight();
    let targetIndex = currentBottomSheetLevelIndex;
    
    if (viewportHeight) {
        const appliedHeight = bottomSheetDragState.lastHeight ?? bottomSheetDragState.startHeight;
        const fraction = appliedHeight / viewportHeight;
        const closestIndex = getClosestSheetLevelIndex(fraction);
        targetIndex = closestIndex;
        const velocity = bottomSheetDragState.velocity || 0;
        const deltaFromStart = appliedHeight - bottomSheetDragState.startHeight;
        const biasNeeded = closestIndex === bottomSheetDragState.startIndex;
        if (biasNeeded && Math.abs(velocity) > BOTTOM_SHEET_VELOCITY_THRESHOLD) {
            const direction = velocity > 0 ? 1 : -1;
            targetIndex = Math.max(0, Math.min(BOTTOM_SHEET_LEVELS.length - 1, bottomSheetDragState.startIndex + direction));
        } else if (biasNeeded && Math.abs(deltaFromStart) > BOTTOM_SHEET_MIN_DRAG_DISTANCE_PX) {
            const direction = deltaFromStart > 0 ? 1 : -1;
            targetIndex = Math.max(0, Math.min(BOTTOM_SHEET_LEVELS.length - 1, bottomSheetDragState.startIndex + direction));
        }
    }
    
    // 1. D'abord retirer is-dragging pour réactiver les transitions CSS
    window.removeEventListener('pointermove', onBottomSheetPointerMove);
    window.removeEventListener('pointerup', onBottomSheetPointerUp);
    window.removeEventListener('pointercancel', onBottomSheetPointerUp);
    if (detailBottomSheet && bottomSheetDragState.pointerId !== undefined) {
        try { detailBottomSheet.releasePointerCapture(bottomSheetDragState.pointerId); } catch (_) { /* ignore */ }
    }
    detailBottomSheet?.classList.remove('is-dragging');
    itineraryDetailContainer?.classList.remove('sheet-is-dragging');
    bottomSheetDragState = null;
    
    // 2. Attendre un frame pour que le navigateur réactive les transitions
    requestAnimationFrame(() => {
        applyBottomSheetLevel(targetIndex);
    });
}

function handleDetailPanelWheel(event) {
    if (!isMobileDetailViewport() || !detailPanelWrapper || !detailBottomSheet) return;
    const nearTop = detailPanelWrapper.scrollTop <= BOTTOM_SHEET_SCROLL_UNLOCK_THRESHOLD;
    if (!nearTop) return; // let content scroll when not at the top
    const direction = Math.sign(event.deltaY);
    if (direction < 0 && !isSheetAtMaxLevel()) {
        event.preventDefault();
        applyBottomSheetLevel(currentBottomSheetLevelIndex + 1);
    } else if (direction > 0 && !isSheetAtMinLevel()) {
        event.preventDefault();
        applyBottomSheetLevel(currentBottomSheetLevelIndex - 1);
    }
}

function initBottomSheetControls() {
    if (bottomSheetControlsInitialized || !detailBottomSheet || !itineraryDetailContainer) return;
    detailBottomSheet.addEventListener('pointerdown', onBottomSheetPointerDown, { passive: false });
    window.addEventListener('resize', handleBottomSheetResize);
    bottomSheetControlsInitialized = true;
    prepareBottomSheetForViewport(true);
}

function setupStaticEventListeners() {
    try { apiManager.loadGoogleMapsAPI(); } catch (error) { console.error("Impossible de charger l'API Google:", error); }
    populateTimeSelects();

    // Gérer les liens hash (#horaires, #trafic, etc.)
    function handleHashNavigation() {
        const hash = window.location.hash.replace('#', '');
        if (hash) {
            switch(hash) {
                case 'horaires':
                    showDashboardView('horaires');
                    break;
                case 'trafic':
                case 'info-trafic':
                    showDashboardView('info-trafic');
                    break;
                case 'carte':
                    showMapView();
                    break;
                case 'tarifs':
                case 'tarifs-grille':
                    showTarifsView('tarifs-grille');
                    break;
            }
            // Nettoyer le hash après navigation
            history.replaceState(null, '', window.location.pathname);
        }
    }
    
    // Écouter les changements de hash
    window.addEventListener('hashchange', handleHashNavigation);
    
    // Gérer le hash initial au chargement
    if (window.location.hash) {
        setTimeout(handleHashNavigation, 100);
    }

    document.querySelectorAll('.service-card[data-view]').forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const view = button.dataset.view;
            showDashboardView(view);
        });
    });

    if (btnShowMap) btnShowMap.addEventListener('click', showMapView); 
    if (btnBackToDashboardFromMap) btnBackToDashboardFromMap.addEventListener('click', showDashboardHall);
    if (btnBackToDashboardFromResults) btnBackToDashboardFromResults.addEventListener('click', showDashboardHall); 
    if (btnBackToHall) btnBackToHall.addEventListener('click', showDashboardHall);
    if (btnBackToResults) btnBackToResults.addEventListener('click', hideDetailView);
    if (itineraryDetailBackdrop) {
        itineraryDetailBackdrop.addEventListener('click', hideDetailView);
    }

    if (detailPanelWrapper && itineraryDetailContainer) {
        let touchStartY = 0;
        
        // V60: Bloquer le scroll du contenu tant qu'on n'est pas au niveau expanded (80%)
        detailPanelWrapper.addEventListener('touchstart', (e) => { 
            touchStartY = e.touches[0].clientY; 
        }, { passive: true }); 
        
        detailPanelWrapper.addEventListener('touchmove', (e) => {
            // V60: Si on n'est pas au niveau max, bloquer le scroll et permettre le drag
            if (currentBottomSheetLevelIndex < BOTTOM_SHEET_EXPANDED_LEVEL_INDEX) {
                // Vérifier si l'événement est cancelable avant d'appeler preventDefault
                if (e.cancelable) {
                    e.preventDefault();
                }
                return;
            }
            
            const currentTouchY = e.touches[0].clientY;
            const currentScrollTop = detailPanelWrapper.scrollTop;
            const deltaY = currentTouchY - touchStartY;
            if (currentScrollTop === 0 && deltaY > 0 && itineraryDetailContainer.classList.contains('is-scrolled')) {
                if (e.cancelable) {
                    e.preventDefault(); 
                }
                itineraryDetailContainer.classList.remove('is-scrolled');
            }
            if (deltaY < 0 && !itineraryDetailContainer.classList.contains('is-scrolled')) {
                itineraryDetailContainer.classList.add('is-scrolled');
            }
        }, { passive: false }); 
        
        detailPanelWrapper.addEventListener('wheel', handleDetailPanelWheel, { passive: false });
        
        detailPanelWrapper.addEventListener('scroll', () => {
            // V60: Ne pas gérer le scroll si on n'est pas au niveau max
            if (currentBottomSheetLevelIndex < BOTTOM_SHEET_EXPANDED_LEVEL_INDEX) {
                detailPanelWrapper.scrollTop = 0;
                return;
            }
            
            const currentScrollTop = detailPanelWrapper.scrollTop;
            if (currentScrollTop > 10 && !itineraryDetailContainer.classList.contains('is-scrolled')) {
                itineraryDetailContainer.classList.add('is-scrolled');
            } else if (currentScrollTop <= 10 && itineraryDetailContainer.classList.contains('is-scrolled')) {
                itineraryDetailContainer.classList.remove('is-scrolled');
            }
        });
    }

    if (alertBannerClose && alertBanner) {
        alertBannerClose.addEventListener('click', () => alertBanner.classList.add('hidden'));
    }
    
    document.querySelectorAll('.tabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabContent = tab.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.toggle('hidden', content.dataset.content !== tabContent);
            });
        });
    });

    const closeInstructionsBtn = document.getElementById('close-instructions');
    if (closeInstructionsBtn) {
        closeInstructionsBtn.addEventListener('click', () => {
            const instructions = document.getElementById('instructions');
            if (instructions) instructions.classList.add('hidden');
            localStorage.setItem('gtfsInstructionsShown', 'true');
        });
    }
    
    const btnToggleFilter = document.getElementById('btn-toggle-filter');
    const routeFilterPanel = document.getElementById('route-filter-panel');
    if (btnToggleFilter && routeFilterPanel) {
        btnToggleFilter.addEventListener('click', () => {
            routeFilterPanel.classList.toggle('hidden');
        });
    }
    
    const closeFilterBtn = document.getElementById('close-filter');
    if (closeFilterBtn && routeFilterPanel) {
        closeFilterBtn.addEventListener('click', () => {
            routeFilterPanel.classList.add('hidden');
        });
    }
    
    const panelHandle = document.querySelector('#route-filter-panel .panel-handle');
    if (panelHandle && routeFilterPanel) {
        panelHandle.addEventListener('click', () => {
            routeFilterPanel.classList.add('hidden');
        });
    }
    
    const selectAllRoutesBtn = document.getElementById('select-all-routes');
    if (selectAllRoutesBtn) {
        selectAllRoutesBtn.addEventListener('click', () => {
            if (dataManager) {
                dataManager.routes.forEach(route => {
                    const checkbox = document.getElementById(`route-${route.route_id}`);
                    if (checkbox) checkbox.checked = true;
                });
                handleRouteFilterChange();
            }
        });
    }
    
    const deselectAllRoutesBtn = document.getElementById('deselect-all-routes');
    if (deselectAllRoutesBtn) {
        deselectAllRoutesBtn.addEventListener('click', () => {
            if (dataManager) {
                dataManager.routes.forEach(route => {
                    const checkbox = document.getElementById(`route-${route.route_id}`);
                    if (checkbox) checkbox.checked = false;
                });
                handleRouteFilterChange();
            }
        });
    }

    if (installTipCloseBtn) {
        installTipCloseBtn.addEventListener('click', hideInstallTip);
    }
    if (installTipContainer) {
        installTipContainer.addEventListener('click', (event) => {
            if (event.target === installTipContainer) {
                hideInstallTip();
            }
        });
    }
    document.addEventListener('keydown', handleInstallTipKeydown);

    document.getElementById('btn-horaires-search-focus').addEventListener('click', () => {
        const horairesCard = document.getElementById('horaires');
        if (horairesCard) {
            window.scrollTo({ top: horairesCard.offsetTop - 80, behavior: 'smooth' });
        }
        searchBar.focus();
    });
    searchBar.addEventListener('input', handleSearchInput);
    searchBar.addEventListener('focus', handleSearchInput);

    setupPlannerListeners('hall', {
        submitBtn: hallPlannerSubmitBtn,
        fromInput: hallFromInput,
        toInput: hallToInput,
        fromSuggestions: hallFromSuggestions,
        toSuggestions: hallToSuggestions,
        swapBtn: hallSwapBtn,
        whenBtn: hallWhenBtn,
        popover: hallPopover,
        dateSelect: hallDate,
        hourSelect: hallHour,
        minuteSelect: hallMinute,
        popoverSubmitBtn: hallPopoverSubmitBtn,
        geolocateBtn: hallGeolocateBtn
    });

    setupPlannerListeners('results', {
        submitBtn: resultsPlannerSubmitBtn,
        fromInput: resultsFromInput,
        toInput: resultsToInput,
        fromSuggestions: resultsFromSuggestions,
        toSuggestions: resultsToSuggestions,
        swapBtn: resultsSwapBtn,
        whenBtn: resultsWhenBtn,
        popover: resultsPopover,
        dateSelect: resultsDate,
        hourSelect: resultsHour,
        minuteSelect: resultsMinute,
        popoverSubmitBtn: resultsPopoverSubmitBtn,
        geolocateBtn: resultsGeolocateBtn
    });

    document.addEventListener('click', (e) => {
        if (searchResultsContainer && !e.target.closest('#horaires-search-container')) {
            searchResultsContainer.classList.add('hidden');
        }
        if (hallPopover && !e.target.closest('#hall-planner-from') && !e.target.closest('#hall-planner-to') && !e.target.closest('.form-group-when')) {
            if (!hallPopover.classList.contains('hidden')) {
                hallPopover.classList.add('hidden');
                hallWhenBtn.classList.remove('popover-active');
            }
        }
        if (resultsPopover && !e.target.closest('#results-planner-from') && !e.target.closest('#results-planner-to') && !e.target.closest('.form-group-when')) {
            if (!resultsPopover.classList.contains('hidden')) {
                resultsPopover.classList.add('hidden');
                resultsWhenBtn.classList.remove('popover-active');
            }
        }
        if (!e.target.closest('.form-group')) {
            if (hallFromSuggestions) hallFromSuggestions.style.display = 'none';
            if (hallToSuggestions) hallToSuggestions.style.display = 'none';
            if (resultsFromSuggestions) resultsFromSuggestions.style.display = 'none';
            if (resultsToSuggestions) resultsToSuggestions.style.display = 'none';
        }
    });

    // === NAVIGATION DROPDOWN IDFM-STYLE ===
    setupNavigationDropdowns();
    
    initBottomSheetControls();
}

// Nouvelle fonction pour gérer les menus dropdown
function setupNavigationDropdowns() {
    // Mobile menu toggle
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const mobileMenu = document.getElementById('mobile-menu');
    
    if (mobileMenuToggle && mobileMenu) {
        mobileMenuToggle.addEventListener('click', () => {
            const isOpening = mobileMenu.classList.contains('hidden');
            mobileMenuToggle.classList.toggle('is-active');
            mobileMenu.classList.toggle('hidden');
            
            // Bloquer/débloquer le scroll de la page
            if (isOpening) {
                document.body.classList.add('mobile-menu-open');
            } else {
                document.body.classList.remove('mobile-menu-open');
            }
        });
        
        // Gestion des catégories dépliables (accordéon)
        mobileMenu.querySelectorAll('.mobile-menu-category').forEach(category => {
            category.addEventListener('click', () => {
                const isExpanded = category.getAttribute('aria-expanded') === 'true';
                const itemsContainer = category.nextElementSibling;
                
                // Toggle l'état
                category.setAttribute('aria-expanded', !isExpanded);
                itemsContainer.classList.toggle('is-expanded', !isExpanded);
            });
        });
    }
    
    // Gestion des actions de navigation (desktop dropdown items)
    document.querySelectorAll('.nav-dropdown-item[data-action]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const action = item.dataset.action;
            handleNavigationAction(action);
        });
    });
    
    // Gestion des actions de navigation (mobile menu items)
    document.querySelectorAll('.mobile-menu-item[data-action]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const action = item.dataset.action;
            // Fermer le menu mobile
            if (mobileMenuToggle) mobileMenuToggle.classList.remove('is-active');
            if (mobileMenu) mobileMenu.classList.add('hidden');
            document.body.classList.remove('mobile-menu-open');
            handleNavigationAction(action);
        });
    });
    
    // Fermer les menus au clic ailleurs
    document.addEventListener('click', (e) => {
        // Fermer le menu mobile si on clique ailleurs
        if (mobileMenu && !mobileMenu.classList.contains('hidden')) {
            if (!e.target.closest('#mobile-menu') && !e.target.closest('#mobile-menu-toggle')) {
                mobileMenuToggle.classList.remove('is-active');
                mobileMenu.classList.add('hidden');
                document.body.classList.remove('mobile-menu-open');
            }
        }
    });
}

// Gérer les actions de navigation
function handleNavigationAction(action) {
    switch(action) {
        case 'itineraire':
            // Aller à la vue résultats d'itinéraire (sans recherche préalable)
            showItineraryResultsView();
            break;
        case 'horaires':
            showDashboardView('horaires');
            break;
        case 'info-trafic':
            showDashboardView('info-trafic');
            break;
        case 'carte':
            showMapView();
            break;
        case 'tarifs':
        case 'tarifs-grille':
            showTarifsView('tarifs-grille');
            break;
        case 'tarifs-achat':
            showTarifsView('tarifs-achat');
            break;
        case 'tarifs-billettique':
            showTarifsView('tarifs-billettique');
            break;
        case 'tarifs-amendes':
            showTarifsView('tarifs-amendes');
            break;
        default:
            console.log('Action non gérée:', action);
    }
}

// Afficher la vue Tarifs
async function showTarifsView(page = 'tarifs-grille') {
    try {
        const response = await fetch(`/views/${page}.html`);
        const html = await response.text();
        
        const appViewRoot = document.getElementById('app-view-root');
        appViewRoot.innerHTML = html;
        
        // Bouton retour - recharge le dashboard complet
        const backBtn = document.getElementById('btn-back-to-hall-tarifs');
        if (backBtn) {
            backBtn.addEventListener('click', async () => {
                await reloadDashboardFromTarifs();
            });
        }
        
        // Liens de navigation entre pages tarifs
        document.querySelectorAll('.tarifs-nav-card[data-action]').forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                const action = card.dataset.action;
                handleNavigationAction(action);
            });
        });
        
        // Scroll en haut
        window.scrollTo(0, 0);
        
    } catch (error) {
        console.error('Erreur chargement vue Tarifs:', error);
    }
}

// Recharger le dashboard depuis les pages tarifs
async function reloadDashboardFromTarifs() {
    try {
        // Recharger le layout de base
        await loadBaseLayout();
        
        // Réinitialiser les références DOM
        initializeDomElements();
        
        // Réattacher les event listeners statiques
        setupStaticEventListeners();
        attachRobustBackHandlers();
        
        // Réafficher les fiches horaires
        if (dataManager && ficheHoraireContainer) {
            renderFicheHoraire();
        }
        
        // Afficher le hall
        if (dashboardContainer) {
            dashboardContainer.classList.remove('hidden');
        }
        if (mapContainer) {
            mapContainer.classList.add('hidden');
        }
        if (itineraryResultsContainer) {
            itineraryResultsContainer.classList.add('hidden');
        }
        if (dashboardHall) {
            dashboardHall.classList.add('view-is-active');
        }
        if (dashboardContentView) {
            dashboardContentView.classList.remove('view-is-active');
        }
        
        document.body.classList.remove('view-is-locked');
        
        // Réafficher les alertes et infos trafic
        if (dataManager) {
            renderAlertBanner();
            renderInfoTrafic();
        }
        
        window.scrollTo(0, 0);
        console.log('[main] Dashboard rechargé depuis tarifs');
        
    } catch (error) {
        console.error('Erreur rechargement dashboard:', error);
        // Fallback: recharger la page
        window.location.reload();
    }
}

function setupDataDependentEventListeners() {
    if (timeManager) {
        timeManager.addListener(updateData);
    }
    if (mapRenderer && mapRenderer.map) {
        mapRenderer.map.on('zoomend', () => {
            if (dataManager) {
                mapRenderer.displayStops();
            }
        });
    }
}

function setupPlannerListeners(source, elements) {
    if (!uiManager) return;
    uiManager.setupPlannerListeners(source, elements, {
        onExecuteSearch: (ctxSource, ctxElements) => executeItinerarySearch(ctxSource, ctxElements),
        handleAutocomplete,
        getFromPlaceId: () => fromPlaceId,
        setFromPlaceId: (value) => { fromPlaceId = value; },
        getToPlaceId: () => toPlaceId,
        setToPlaceId: (value) => { toPlaceId = value; }
    });
}

async function executeItinerarySearch(source, sourceElements) {
    const { fromInput, toInput, dateSelect, hourSelect, minuteSelect, popover } = sourceElements;
    
    // V59: Reset complet pour nouvelle recherche
    console.log('🔄 === NOUVELLE RECHERCHE ===');
    
    if (!fromPlaceId || !toPlaceId) {
        alert("Veuillez sélectionner un point de départ et d'arrivée depuis les suggestions.");
        return;
    }
    const searchTime = {
        type: popover.querySelector('.popover-tab.active').dataset.tab, 
        date: dateSelect.value,
        hour: hourSelect.value,
        minute: minuteSelect.value
    };
    
    // Debug: vérifier l'heure réellement sélectionnée
    console.log('🕐 Heure sélectionnée:', {
        date: searchTime.date,
        heure: `${searchTime.hour}:${String(searchTime.minute).padStart(2,'0')}`,
        mode: searchTime.type,
        hourSelectValue: hourSelect.value,
        hourSelectIndex: hourSelect.selectedIndex,
        minuteSelectValue: minuteSelect.value,
        minuteSelectIndex: minuteSelect.selectedIndex,
        // Debug supplémentaire
        hourOptions: hourSelect.options?.length,
        selectedHourText: hourSelect.options?.[hourSelect.selectedIndex]?.textContent
    });
    lastSearchMode = searchTime.type; // Mémoriser le mode pour le rendu/pagination
    lastSearchTime = { ...searchTime }; // V60: Mémoriser pour charger plus
    loadMoreOffset = 0; // V60: Reset l'offset
    // V59: Reset complet de l'état de recherche
    arrivalRankedAll = [];
    arrivalRenderedCount = 0;
    allFetchedItineraries = [];
    
    prefillOtherPlanner(source, sourceElements);
    console.log(`Recherche Google API (source: ${source}):`, { from: fromPlaceId, to: toPlaceId, time: searchTime });
    if (source === 'hall') {
        showResultsView(); 
    } else {
        resultsListContainer.innerHTML = '<p class="results-message">Mise à jour de l\'itinéraire...</p>';
    }
    resultsModeTabs.classList.add('hidden');
    try {
        let fromCoords = null;
        let toCoords = null;
        let fromGtfsStops = null; // V49: Arrêts GTFS forcés pour les pôles multimodaux (tableau de stop_id)
        let toGtfsStops = null;
        
        // 🚀 V60: Résolution des coordonnées EN PARALLÈLE
        const coordsStart = performance.now();
        const [fromResult, toResult] = await Promise.all([
            apiManager.getPlaceCoords(fromPlaceId).catch(e => { console.warn('Coords départ:', e); return null; }),
            apiManager.getPlaceCoords(toPlaceId).catch(e => { console.warn('Coords arrivée:', e); return null; })
        ]);
        
        if (fromResult) {
            fromCoords = { lat: fromResult.lat, lng: fromResult.lng };
            if (fromResult.isMultiStop && fromResult.gtfsStops) {
                fromGtfsStops = fromResult.gtfsStops.map(s => s.stopId);
                console.log(`🎓 Pôle multimodal origine: ${fromGtfsStops.length} arrêts`);
            }
        }
        if (toResult) {
            toCoords = { lat: toResult.lat, lng: toResult.lng };
            if (toResult.isMultiStop && toResult.gtfsStops) {
                toGtfsStops = toResult.gtfsStops.map(s => s.stopId);
                console.log(`🎓 Pôle multimodal destination: ${toGtfsStops.length} arrêts`);
            }
        }
        console.log(`⚡ Coords résolues en ${Math.round(performance.now() - coordsStart)}ms`);

        const fromLabel = sourceElements.fromInput?.value || '';
        const toLabel = sourceElements.toInput?.value || '';

        // 🚀 V60: Routage optimisé - API Google uniquement
        // ⚠️ Router GTFS local désactivé (ENABLE_GTFS_ROUTER=false)
        const routingStart = performance.now();
        
        let hybridItins = [];
        
        // GTFS Router (désactivé par défaut pour performances)
        if (ENABLE_GTFS_ROUTER && routerWorkerClient) {
            try {
                hybridItins = await routerWorkerClient.computeHybridItinerary({
                    fromCoords, toCoords, searchTime,
                    labels: { fromLabel, toLabel },
                    forcedStops: { from: fromGtfsStops, to: toGtfsStops }
                });
                console.log('🔍 GTFS local:', hybridItins?.length || 0, 'itinéraires');
            } catch (e) {
                console.warn('GTFS router error:', e);
            }
        }

        // API Google (source principale)
        const intelligentResults = await apiManager.fetchItinerary(fromPlaceId, toPlaceId, searchTime)
            .catch(e => { console.error('API Google error:', e); return null; });
        
        console.log(`⚡ Routage terminé en ${Math.round(performance.now() - routingStart)}ms`);

        // Traiter les résultats Google
        if (intelligentResults) {
            allFetchedItineraries = processIntelligentResults(intelligentResults, searchTime);
            console.log('✅ API Google:', allFetchedItineraries?.length || 0, 'itinéraires');
            
            // Fusionner avec GTFS si disponible
            if (hybridItins?.length) {
                for (const gtfsIt of hybridItins) {
                    const isDuplicate = allFetchedItineraries.some(googleIt => 
                        googleIt.departureTime === gtfsIt.departureTime && 
                        googleIt.arrivalTime === gtfsIt.arrivalTime
                    );
                    if (!isDuplicate) allFetchedItineraries.push(gtfsIt);
                }
            }
        } else if (hybridItins?.length) {
            console.log('🔄 Fallback GTFS:', hybridItins.length, 'itinéraires');
            allFetchedItineraries = hybridItins;
        } else {
            allFetchedItineraries = [];
        }

        // Debug: vérifier si l'heure demandée correspond
        const heureDemandeMin = parseInt(searchTime.hour) * 60 + parseInt(searchTime.minute);
        console.log('📊 Heure demandée:', `${searchTime.hour}:${String(searchTime.minute).padStart(2,'0')}`);

        // Ensure every BUS step has a polyline (GTFS constructed or fallback)
        try {
            await ensureItineraryPolylines(allFetchedItineraries);
        } catch (e) {
            console.warn('Erreur lors de l\'assurance des polylines:', e);
        }

        // TOUJOURS filtrer les trajets dont le départ est passé (même en mode "arriver")
        // Mais seulement si la recherche est pour aujourd'hui
        allFetchedItineraries = filterExpiredDepartures(allFetchedItineraries, searchTime);
        
        // En mode "arriver", filtrer aussi les trajets qui arrivent APRÈS l'heure demandée
        if (searchTime.type === 'arriver') {
            const targetHour = parseInt(searchTime.hour) || 0;
            const targetMinute = parseInt(searchTime.minute) || 0;
            allFetchedItineraries = filterLateArrivals(allFetchedItineraries, targetHour, targetMinute);
        }
        
        // V64: Limiter vélo et piéton à un seul trajet de chaque
        // Ces modes n'ont pas d'horaires, un seul résultat suffit
        allFetchedItineraries = limitBikeWalkItineraries(allFetchedItineraries);

        // Debug: après filtrage
        console.log('📋 Après filtrage:', {
            mode: searchTime.type || 'partir',
            restants: allFetchedItineraries?.length || 0
        });

        // V63: On ne déduplique PLUS - Google gère le ranking, on garde tous les horaires
        // const searchMode = searchTime.type || 'partir';
        // allFetchedItineraries = deduplicateItineraries(allFetchedItineraries, searchMode);
        
        console.log('📊 Itinéraires disponibles:', allFetchedItineraries?.length || 0);

        // V63: On garde l'ordre de Google qui est déjà optimisé
        // Le re-tri manuel causait des sauts d'horaires (8h → 9h en sautant 8h15, 8h30...)
        const heureDemandee = `${searchTime.hour}:${String(searchTime.minute).padStart(2,'0')}`;
        
        if (searchTime.type === 'arriver') {
            console.log(`🎯 Mode ARRIVER: Google a trié pour arriver avant ${heureDemandee}`);
            // Garder l'ordre de Google, juste initialiser pour la pagination
            arrivalRankedAll = [...allFetchedItineraries];
            arrivalRenderedCount = Math.min(ARRIVAL_PAGE_SIZE, arrivalRankedAll.length);
        } else {
            console.log(`🎯 Mode PARTIR: Google a trié à partir de ${heureDemandee}`);
            // Garder l'ordre de Google tel quel
            arrivalRankedAll = [];
            arrivalRenderedCount = 0;
        }
        
        console.log('📊 Itinéraires (ordre Google conservé):', 
            allFetchedItineraries.slice(0, 5).map(it => ({
                dep: it.departureTime,
                arr: it.arrivalTime,
                dur: it.duration
            })));
        
        setupResultTabs(allFetchedItineraries);
        if (resultsRenderer) resultsRenderer.render('ALL');
        if (allFetchedItineraries.length > 0) {
            drawRouteOnResultsMap(allFetchedItineraries[0]);
            // V60: Le bouton GO est maintenant intégré dans le bottom sheet de chaque itinéraire
        }
    } catch (error) {
        console.error("Échec de la recherche d'itinéraire:", error);
        if (resultsListContainer) {
            resultsListContainer.innerHTML = `<p class="results-message error">Impossible de calculer l'itinéraire. ${error.message}</p>`;
        }
        resultsModeTabs.classList.add('hidden');
    }
}

/**
 * V60: Charge plus de départs en décalant l'heure de recherche
 * Ajoute les nouveaux itinéraires à la liste existante
 */
async function loadMoreDepartures() {
    if (!lastSearchTime || !fromPlaceId || !toPlaceId) {
        console.warn('loadMoreDepartures: pas de recherche précédente');
        return;
    }

    // Trouver le dernier départ bus pour commencer après
    const busItineraries = allFetchedItineraries.filter(it => it.type === 'BUS' || it.type === 'TRANSIT');
    let startHour, startMinute;
    
    if (busItineraries.length > 0) {
        // Prendre le dernier départ + 1 minute
        const lastDep = busItineraries[busItineraries.length - 1].departureTime;
        const match = lastDep?.match(/(\d{1,2}):(\d{2})/);
        if (match) {
            startHour = parseInt(match[1], 10);
            startMinute = parseInt(match[2], 10) + 1;
            if (startMinute >= 60) {
                startMinute = 0;
                startHour = (startHour + 1) % 24;
            }
        }
    }
    
    if (startHour === undefined) {
        // Fallback: décaler de 30 minutes
        loadMoreOffset += 30;
        startHour = parseInt(lastSearchTime.hour) + Math.floor((parseInt(lastSearchTime.minute) + loadMoreOffset) / 60);
        startMinute = (parseInt(lastSearchTime.minute) + loadMoreOffset) % 60;
        startHour = startHour % 24;
    }

    const offsetSearchTime = {
        ...lastSearchTime,
        hour: String(startHour).padStart(2, '0'),
        minute: String(startMinute).padStart(2, '0')
    };

    console.log(`🔄 Chargement + de départs à partir de ${offsetSearchTime.hour}:${offsetSearchTime.minute}`);

    try {
        // Appeler l'API avec le nouvel horaire
        const intelligentResults = await apiManager.fetchItinerary(fromPlaceId, toPlaceId, offsetSearchTime);
        let newItineraries = processIntelligentResults(intelligentResults, offsetSearchTime);
        
        // Filtrer les doublons (même heure de départ)
        const existingDepartures = new Set(allFetchedItineraries.map(it => it.departureTime));
        newItineraries = newItineraries.filter(it => !existingDepartures.has(it.departureTime));
        
        if (newItineraries.length === 0) {
            console.log('Aucun nouveau départ trouvé');
            // Afficher un message
            const btn = document.querySelector('.load-more-departures button');
            if (btn) {
                btn.innerHTML = 'Plus de départs disponibles';
                btn.disabled = true;
            }
            return;
        }

        console.log(`✅ ${newItineraries.length} nouveaux départs ajoutés`);
        
        // Ajouter les nouveaux itinéraires
        allFetchedItineraries = [...allFetchedItineraries, ...newItineraries];
        
        // V63: NE PAS re-trier, garder l'ordre chronologique naturel
        // Les nouveaux départs sont déjà plus tardifs
        
        // Re-rendre
        setupResultTabs(allFetchedItineraries);
        if (resultsRenderer) resultsRenderer.render('ALL');
        
    } catch (error) {
        console.error('Erreur chargement + de départs:', error);
        const btn = document.querySelector('.load-more-departures button');
        if (btn) {
            btn.innerHTML = 'Erreur - Réessayer';
            btn.disabled = false;
        }
    }
}

function prefillOtherPlanner(sourceFormName, sourceElements) {
    let targetElements;
    if (sourceFormName === 'hall') {
        targetElements = {
            fromInput: resultsFromInput, toInput: resultsToInput,
            dateSelect: resultsDate, hourSelect: resultsHour, minuteSelect: resultsMinute,
            whenBtn: resultsWhenBtn, popover: resultsPopover, popoverSubmitBtn: resultsPopoverSubmitBtn
        };
    } else {
        targetElements = {
            fromInput: hallFromInput, toInput: hallToInput,
            dateSelect: hallDate, hourSelect: hallHour, minuteSelect: hallMinute,
            whenBtn: hallWhenBtn, popover: hallPopover, popoverSubmitBtn: hallPopoverSubmitBtn
        };
    }
    targetElements.fromInput.value = sourceElements.fromInput.value;
    targetElements.toInput.value = sourceElements.toInput.value;
    targetElements.dateSelect.value = sourceElements.dateSelect.value;
    targetElements.hourSelect.value = sourceElements.hourSelect.value;
    targetElements.minuteSelect.value = sourceElements.minuteSelect.value;
    if (uiManager && typeof uiManager.syncEnhancedTimeSelect === 'function') {
        uiManager.syncEnhancedTimeSelect(targetElements.hourSelect);
        uiManager.syncEnhancedTimeSelect(targetElements.minuteSelect);
    }
    const sourceActiveTab = sourceElements.popover.querySelector('.popover-tab.active').dataset.tab;
    targetElements.popover.querySelectorAll('.popover-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === sourceActiveTab);
    });
    targetElements.whenBtn.querySelector('span').textContent = sourceElements.whenBtn.querySelector('span').textContent;
    targetElements.popoverSubmitBtn.textContent = (sourceActiveTab === 'arriver') ? "Valider l'arrivée" : 'Partir maintenant';
}

async function handleAutocomplete(query, container, onSelect) {
    if (query.length < 3) {
        container.innerHTML = '';
        container.style.display = 'none';
        onSelect(null); 
        return;
    }
    try {
        const suggestions = await apiManager.getPlaceAutocomplete(query);
        renderSuggestions(suggestions, container, onSelect);
    } catch (error) {
        console.warn("Erreur d'autocomplétion:", error);
        container.style.display = 'none';
    }
}

function renderSuggestions(suggestions, container, onSelect) {
    container.innerHTML = '';
    if (suggestions.length === 0) {
        container.style.display = 'none';
        return;
    }

    const resolveInputElement = () => {
        if (!container) return null;
        let sibling = container.previousElementSibling;
        while (sibling) {
            if (sibling.tagName === 'INPUT') return sibling;
            if (typeof sibling.querySelector === 'function') {
                const nested = sibling.querySelector('input');
                if (nested) return nested;
            }
            sibling = sibling.previousElementSibling;
        }
        let parent = container.parentElement;
        while (parent) {
            const nested = parent.querySelector('input');
            if (nested) return nested;
            parent = parent.parentElement;
        }
        return null;
    };

    const inputElement = resolveInputElement();

    suggestions.forEach(suggestion => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        const mainText = suggestion.description.split(',')[0];
        const secondaryText = suggestion.description.substring(mainText.length);
        item.innerHTML = `<strong>${mainText}</strong>${secondaryText}`;
        item.addEventListener('click', () => {
            if (inputElement) {
                inputElement.value = suggestion.description;
            }
            onSelect(suggestion.placeId); 
            container.innerHTML = ''; 
            container.style.display = 'none';
        });
        container.appendChild(item);
    });
    container.style.display = 'block';
}

function processGoogleRoutesResponse(data) {
    if (!data || !data.routes || data.routes.length === 0) {
        console.warn("Réponse de l'API Routes (BUS) vide ou invalide.");
        return [];
    }
    return data.routes.map(route => {
        const leg = route.legs[0];
        let isRegionalRoute = false; 
        const itinerary = {
            type: 'BUS', 
            priority: 1, 
            departureTime: "--:--", 
            arrivalTime: "--:--",
            duration: formatGoogleDuration(route.duration),
            durationRaw: parseGoogleDuration(route.duration), 
            polyline: route.polyline,
            summarySegments: [], 
            steps: []
        };
        let currentWalkStep = null;

        for (const step of leg.steps) {
            const duration = formatGoogleDuration(step.staticDuration);
            const rawDuration = parseGoogleDuration(step.staticDuration);
            const distanceMeters = step.distanceMeters || 0;
            const distanceText = step.localizedValues?.distance?.text || '';
            const instruction = step.navigationInstruction?.instructions || step.localizedValues?.instruction || "Marcher";
            const maneuver = step.navigationInstruction?.maneuver || 'DEFAULT';

            if (step.travelMode === 'WALK') {
                if (!currentWalkStep) {
                    currentWalkStep = {
                        type: 'WALK', icon: ICONS.WALK, instruction: "Marche",
                        subSteps: [], polylines: [], totalDuration: 0, totalDistanceMeters: 0,
                        departureTime: "--:--", arrivalTime: "--:--"
                    };
                }
                currentWalkStep.subSteps.push({ instruction, distance: distanceText, duration, maneuver });
                currentWalkStep.polylines.push(step.polyline);
                currentWalkStep.totalDuration += rawDuration;
                currentWalkStep.totalDistanceMeters += distanceMeters;

            } else if (step.travelMode === 'TRANSIT' && step.transitDetails) {
                const transit = step.transitDetails;
                const stopDetails = transit.stopDetails || {};

                if (currentWalkStep) {
                    currentWalkStep.duration = formatGoogleDuration(currentWalkStep.totalDuration + 's');
                    if (currentWalkStep.totalDistanceMeters > 1000) {
                        currentWalkStep.distance = `${(currentWalkStep.totalDistanceMeters / 1000).toFixed(1)} km`;
                    } else {
                        currentWalkStep.distance = `${currentWalkStep.totalDistanceMeters} m`;
                    }
                    const nextDepTime = transit.localizedValues?.departureTime?.time?.text || formatGoogleTime(stopDetails.departureTime);
                    currentWalkStep.arrivalTime = nextDepTime;
                    currentWalkStep.durationRaw = currentWalkStep.totalDuration;
                    itinerary.steps.push(currentWalkStep);
                    currentWalkStep = null;
                }
                
                const line = transit.transitLine;
                if (line) {
                    const shortName = line.nameShort || 'BUS';
                    if (dataManager && dataManager.isLoaded && !dataManager.routesByShortName[shortName]) {
                        console.warn(`[Filtre] Trajet rejeté: Ligne non-locale ("${shortName}") détectée.`);
                        isRegionalRoute = true;
                    }
                    const color = line.color || '#3388ff';
                    const textColor = line.textColor || '#ffffff';
                    const departureStop = stopDetails.departureStop || {};
                    const arrivalStop = stopDetails.arrivalStop || {};
                    let intermediateStops = (stopDetails.intermediateStops || []).map(stop => stop.name || 'Arrêt inconnu');
                    
                    if (intermediateStops.length === 0 && dataManager && dataManager.isLoaded) {
                        const apiDepName = departureStop.name;
                        const apiArrName = arrivalStop.name;
                        const apiHeadsign = transit.headsign;
                        if (apiDepName && apiArrName && apiHeadsign) {
                            const gtfsStops = dataManager.getIntermediateStops(shortName, apiHeadsign, apiDepName, apiArrName);
                            if (gtfsStops && gtfsStops.length > 0) {
                                intermediateStops = gtfsStops;
                            }
                        }
                    }
                    const depTime = transit.localizedValues?.departureTime?.time?.text || formatGoogleTime(stopDetails.departureTime);
                    const arrTime = transit.localizedValues?.arrivalTime?.time?.text || formatGoogleTime(stopDetails.arrivalTime);
                    itinerary.steps.push({
                        type: 'BUS', icon: ICONS.BUS, routeShortName: shortName, routeColor: color, routeTextColor: textColor,
                        instruction: `Prendre le <b>${shortName}</b> direction <b>${transit.headsign || 'destination'}</b>`,
                        departureStop: departureStop.name || 'Arrêt de départ', departureTime: depTime,
                        arrivalStop: arrivalStop.name || 'Arrêt d\'arrivée', arrivalTime: arrTime,
                        numStops: transit.stopCount || 0, intermediateStops: intermediateStops,
                        duration: formatGoogleDuration(step.staticDuration), polyline: step.polyline
                        , durationRaw: rawDuration
                    });
                }
            }
        }
        
        if (isRegionalRoute) return null;

        if (currentWalkStep) {
            currentWalkStep.duration = formatGoogleDuration(currentWalkStep.totalDuration + 's');
            if (currentWalkStep.totalDistanceMeters > 1000) {
                currentWalkStep.distance = `${(currentWalkStep.totalDistanceMeters / 1000).toFixed(1)} km`;
            } else {
                currentWalkStep.distance = `${currentWalkStep.totalDistanceMeters} m`;
            }
            const legArrivalTime = leg.localizedValues?.arrivalTime?.time?.text || "--:--";
            currentWalkStep.arrivalTime = legArrivalTime;
            currentWalkStep.durationRaw = currentWalkStep.totalDuration;
            itinerary.steps.push(currentWalkStep);
        }
        
        if (itinerary.steps.length > 0) {
            const firstStepWithTime = itinerary.steps.find(s => s.departureTime && s.departureTime !== "--:--");
            itinerary.departureTime = firstStepWithTime ? firstStepWithTime.departureTime : (itinerary.steps[0].departureTime || "--:--");
            const lastStepWithTime = [...itinerary.steps].reverse().find(s => s.arrivalTime && s.arrivalTime !== "--:--");
            itinerary.arrivalTime = lastStepWithTime ? lastStepWithTime.arrivalTime : (itinerary.steps[itinerary.steps.length - 1].arrivalTime || "--:--");
        }
                
        const allSummarySegments = itinerary.steps.map(step => {
            if (step.type === 'WALK') {
                return { type: 'WALK', duration: step.duration };
            } else {
                return {
                    type: 'BUS',
                    name: getSafeRouteBadgeLabel(step.routeShortName),
                    color: step.routeColor,
                    textColor: step.routeTextColor,
                    duration: step.duration
                };
            }
        });
        const hasBusSegment = itinerary.steps.some(step => step.type === 'BUS');
        const computedDurationSeconds = itinerary.steps.reduce((total, step) => {
            const value = typeof step?.durationRaw === 'number' ? step.durationRaw : 0;
            return total + (Number.isFinite(value) ? value : 0);
        }, 0);
        if (computedDurationSeconds > 0) {
            itinerary.durationRaw = computedDurationSeconds;
            itinerary.duration = formatGoogleDuration(`${computedDurationSeconds}s`);
        }

        const firstTimedStepIndex = itinerary.steps.findIndex(step => isMeaningfulTime(step?.departureTime));
        if (firstTimedStepIndex !== -1) {
            let anchorTime = itinerary.steps[firstTimedStepIndex].departureTime;
            for (let i = firstTimedStepIndex - 1; i >= 0; i--) {
                const stepDuration = typeof itinerary.steps[i]?.durationRaw === 'number' ? itinerary.steps[i].durationRaw : 0;
                if (stepDuration > 0) {
                    const recalculated = subtractSecondsFromTimeString(anchorTime, stepDuration);
                    if (!recalculated) break;
                    anchorTime = recalculated;
                }
            }
            itinerary.departureTime = anchorTime;
        } else if (isMeaningfulTime(itinerary.arrivalTime) && computedDurationSeconds > 0) {
            const derived = subtractSecondsFromTimeString(itinerary.arrivalTime, computedDurationSeconds);
            if (derived) itinerary.departureTime = derived;
        }

        const lastTimedArrivalIndex = (() => {
            for (let i = itinerary.steps.length - 1; i >= 0; i--) {
                if (isMeaningfulTime(itinerary.steps[i]?.arrivalTime)) return i;
            }
            return -1;
        })();

        if (lastTimedArrivalIndex !== -1) {
            let anchorTime = itinerary.steps[lastTimedArrivalIndex].arrivalTime;
            for (let i = lastTimedArrivalIndex + 1; i < itinerary.steps.length; i++) {
                const stepDuration = typeof itinerary.steps[i]?.durationRaw === 'number' ? itinerary.steps[i].durationRaw : 0;
                if (stepDuration > 0) {
                    const recalculated = addSecondsToTimeString(anchorTime, stepDuration);
                    if (!recalculated) break;
                    anchorTime = recalculated;
                }
            }
            itinerary.arrivalTime = anchorTime;
        } else if (isMeaningfulTime(itinerary.departureTime) && computedDurationSeconds > 0) {
            const derivedArrival = addSecondsToTimeString(itinerary.departureTime, computedDurationSeconds);
            if (derivedArrival) itinerary.arrivalTime = derivedArrival;
        }

        if (!hasBusSegment) {
            const legDepartureTime = leg.localizedValues?.departureTime?.time?.text || leg.startTime?.text || "--:--";
            const legArrivalTime = leg.localizedValues?.arrivalTime?.time?.text || leg.endTime?.text || "--:--";
            itinerary.type = 'WALK';
            itinerary.summarySegments = [];
            itinerary._isWalk = true;
            if (legDepartureTime && legDepartureTime !== "--:--") {
                itinerary.departureTime = legDepartureTime;
                if (itinerary.steps.length) {
                    const firstStep = itinerary.steps[0];
                    if (!firstStep.departureTime || firstStep.departureTime === '--:--') {
                        firstStep.departureTime = legDepartureTime;
                    }
                }
            }
            if (legArrivalTime && legArrivalTime !== "--:--") {
                itinerary.arrivalTime = legArrivalTime;
                if (itinerary.steps.length) {
                    const lastStep = itinerary.steps[itinerary.steps.length - 1];
                    if (!lastStep.arrivalTime || lastStep.arrivalTime === '--:--') {
                        lastStep.arrivalTime = legArrivalTime;
                    }
                }
            }
        } else {
            itinerary.summarySegments = allSummarySegments.filter(segment => segment.type === 'BUS');
        }
        return itinerary;
    }).filter(itinerary => itinerary !== null);
}

// (Déduplication déplacée vers itinerary/ranking.js)

function processIntelligentResults(intelligentResults, searchTime) {
    console.log("=== DÉBUT PROCESS INTELLIGENT RESULTS ===");
    console.log("📥 Mode de recherche:", searchTime?.type || 'partir');
    console.log("📥 Heure demandée:", `${searchTime?.hour}:${String(searchTime?.minute || 0).padStart(2,'0')}`);
    
    const itineraries = [];
    const sortedRecommendations = [...intelligentResults.recommendations].sort((a, b) => b.score - a.score);

    // 1. Extraction des résultats Google
    sortedRecommendations.forEach(rec => {
        let modeData = null;
        let modeInfo = null;
        if (rec.mode === 'bus' && intelligentResults.bus) {
            modeData = intelligentResults.bus.data;
            modeInfo = intelligentResults.bus;
        } else if (rec.mode === 'bike' && intelligentResults.bike) {
            modeData = intelligentResults.bike.data;
            modeInfo = intelligentResults.bike;
        } else if (rec.mode === 'walk' && intelligentResults.walk) {
            modeData = intelligentResults.walk.data;
            modeInfo = intelligentResults.walk;
        }

        if (modeData && modeInfo) {
            if (rec.mode === 'bus') {
                const busItineraries = processGoogleRoutesResponse(modeData);
                if (busItineraries.length > 0) {
                    busItineraries.forEach((itin, index) => {
                        itin.score = rec.score - index;
                        if (!itin.type) itin.type = 'BUS';
                    });
                }
                itineraries.push(...busItineraries);
            } else {
                const simpleItinerary = processSimpleRoute(modeData, rec.mode, modeInfo, searchTime);
                if (simpleItinerary) {
                    simpleItinerary.score = rec.score;
                    if (rec.mode === 'bike' && simpleItinerary.type !== 'BIKE') simpleItinerary.type = 'BIKE';
                    if (rec.mode === 'walk' && simpleItinerary.type !== 'WALK') simpleItinerary.type = 'WALK';
                    itineraries.push(simpleItinerary);
                }
            }
        }
    });
    
    // Debug: afficher tous les itinéraires extraits de Google AVANT filtrage
    console.log("📋 Itinéraires Google bruts (avant filtrage):", itineraries.map(it => ({
        type: it.type,
        dep: it.departureTime,
        arr: it.arrivalTime,
        dur: it.duration
    })));

    // 2. LOGIQUE DE FENÊTRE TEMPORELLE (Horaire Arrivée)
    try {
        if (searchTime && searchTime.type === 'arriver') {
            // A. Définir la cible
            let reqDate = null;
            if (!searchTime.date || searchTime.date === 'today' || searchTime.date === "Aujourd'hui") {
                reqDate = new Date();
            } else {
                reqDate = new Date(searchTime.date);
            }
            const reqHour = parseInt(searchTime.hour) || 0;
            const reqMinute = parseInt(searchTime.minute) || 0;
            reqDate.setHours(reqHour, reqMinute, 0, 0);
            const reqMs = reqDate.getTime();

            // B. Fenêtre élargie : on accepte les arrivées jusqu'à 4h AVANT l'heure demandée
            // Le tri ensuite classera par proximité à l'heure cible
            const BEFORE_MINUTES = 240; // 4h de fenêtre en amont pour avoir plus de choix
            const windowStart = reqMs - BEFORE_MINUTES * 60 * 1000;
            const windowEnd = reqMs; // pas de trajets après l'heure demandée

            console.log(`🕒 Cible: ${reqDate.toLocaleTimeString()} | Fenêtre: ${new Date(windowStart).toLocaleTimeString()} → ${new Date(windowEnd).toLocaleTimeString()} ( -${BEFORE_MINUTES}min / +0min )`);

            const busItins = itineraries.filter(i => i.type === 'BUS' && i.arrivalTime && i.arrivalTime !== '~' && i.arrivalTime !== '--:--');
            const otherItins = itineraries.filter(i => i.type !== 'BUS');

            // Parser l'heure d'arrivée (HH:MM) en Timestamp
            const parseArrivalMs = (arrivalStr) => {
                if (!arrivalStr || typeof arrivalStr !== 'string') return NaN;
                const m = arrivalStr.match(/(\d{1,2}):(\d{2})/);
                if (!m) return NaN;
                const hh = parseInt(m[1], 10);
                const mm = parseInt(m[2], 10);
                const d = new Date(reqDate);
                d.setHours(hh, mm, 0, 0);
                return d.getTime();
            };

            const busWithMs = busItins.map(i => ({ itin: i, arrivalMs: parseArrivalMs(i.arrivalTime) })).filter(x => !isNaN(x.arrivalMs));

            // C. Filtrer les bus Google qui sont DANS la fenêtre
            let filteredBus = busWithMs
                .filter(x => x.arrivalMs >= windowStart && x.arrivalMs <= windowEnd)
                .map(x => x.itin);

            console.log(`🚌 Bus Google trouvés dans la fenêtre : ${filteredBus.length} sur ${busItins.length} total`);
            if (busWithMs.length > filteredBus.length) {
                const exclus = busWithMs.filter(x => x.arrivalMs < windowStart || x.arrivalMs > windowEnd);
                console.log(`📅 Bus exclus (hors fenêtre):`, exclus.map(x => ({ arr: x.itin.arrivalTime, ms: x.arrivalMs })));
            }

            // D. INJECTION GTFS (Data locale) pour compléter
            // ON SUPPRIME LA LIMITE "TARGET_BUS_COUNT" pour prendre TOUT ce qui existe.
            
            let gtfsAdded = [];
            let candidateStopIds = new Set();
            if (dataManager && dataManager.isLoaded) {
                console.log("📂 Recherche dans les données GTFS locales...");
                
                const normalize = (name) => {
                    if (!name) return "";
                    return name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '').trim();
                };

                // Récupérer les noms d'arrêts d'arrivée depuis Google pour savoir où chercher
                const candidateNames = new Set();
                busItins.forEach(it => {
                    if (!it.steps) return;
                    const lastBusStep = [...it.steps].reverse().find(s => s.type === 'BUS');
                    if (lastBusStep && lastBusStep.arrivalStop) candidateNames.add(lastBusStep.arrivalStop);
                });

                candidateStopIds = new Set();
                candidateNames.forEach(n => {
                    const key = normalize(n);
                    if (dataManager.stopsByName && dataManager.stopsByName[key]) {
                        dataManager.stopsByName[key].forEach(s => candidateStopIds.add(s.stop_id));
                    } else {
                        // Fallback recherche large
                        dataManager.stops.forEach(s => {
                            if (normalize(s.stop_name || '').includes(key)) candidateStopIds.add(s.stop_id);
                        });
                    }
                });
                
                // Si Google n'a rien donné, on cherche "Tourny" ou "Gare" par défaut (optionnel)
                if (candidateStopIds.size === 0) {
                     console.warn("⚠️ Aucun arrêt candidat trouvé via Google, recherche GTFS impossible.");
                } else {
                    console.log(`📍 Arrêts candidats GTFS (IDs):`, Array.from(candidateStopIds));
                }

                const serviceIdSet = dataManager.getServiceIds(new Date(reqDate));
                const seenKeys = new Set(); // Pour éviter les doublons exacts

                // Ajouter les clés des bus Google déjà trouvés pour ne pas les dupliquer
                filteredBus.forEach(b => {
                    seenKeys.add(`${b.summarySegments[0]?.name}_${b.arrivalTime}`);
                });

                // PARCOURS GTFS
                for (const stopId of candidateStopIds) {
                    const stopTimes = dataManager.stopTimesByStop[stopId] || [];
                    
                    for (const st of stopTimes) {
                        const trip = dataManager.tripsByTripId[st.trip_id];
                        if (!trip) continue;

                        // Vérif Service (Jour de la semaine)
                        const isServiceActive = Array.from(serviceIdSet).some(sid => dataManager.serviceIdsMatch(trip.service_id, sid));
                        if (!isServiceActive) continue;

                        const arrTimeStr = st.arrival_time || st.departure_time;
                        const seconds = dataManager.timeToSeconds(arrTimeStr);
                        
                        // Calcul du Timestamp Arrivée GTFS
                        const d = new Date(reqDate);
                        const hours = Math.floor(seconds / 3600);
                        const mins = Math.floor((seconds % 3600) / 60);
                        d.setHours(hours, mins, 0, 0);
                        const arrMs = d.getTime();

                        // === TEST CRITIQUE DE LA FENÊTRE ===
                        if (arrMs >= windowStart && arrMs <= windowEnd) {
                            
                            const route = dataManager.getRoute(trip.route_id) || {};
                            const routeName = route.route_short_name || trip.route_id;
                            const key = `${routeName}_${dataManager.formatTime(seconds)}`;

                            if (!seenKeys.has(key)) {
                                seenKeys.add(key); // Marquer comme vu

                                // Création de l'itinéraire GTFS enrichi (noms lisibles, horaires, polylines via shapes)
                                                const stopTimesList = dataManager.getStopTimes(st.trip_id) || [];
                                                const alightIndex = stopTimesList.findIndex(s => s.stop_id === st.stop_id);

                                                // Determine boardingIndex robustly:
                                                // 1) Prefer a stop that matches any origin candidate stop IDs (if available)
                                                // 2) Otherwise, pick the nearest predecessor before alightIndex (within a small window)
                                                let boardingIndex = null;
                                                // Déclarer originCandidateIds en dehors du try pour qu'il soit accessible plus bas
                                                let originCandidateIds = new Set();
                                                try {
                                                    // Build origin candidate IDs from the current Google results (departure stops)
                                                    const originCandidateNames = new Set();
                                                    busItins.forEach(bi => {
                                                        if (!bi.steps) return;
                                                        const firstBusStep = [...bi.steps].find(s => s.type === 'BUS');
                                                        if (firstBusStep && firstBusStep.departureStop) originCandidateNames.add(firstBusStep.departureStop);
                                                    });
                                                    originCandidateNames.forEach(n => {
                                                        const key = (n || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '').trim();
                                                        if (dataManager.stopsByName && dataManager.stopsByName[key]) {
                                                            dataManager.stopsByName[key].forEach(s => originCandidateIds.add(s.stop_id));
                                                        } else {
                                                            dataManager.stops.forEach(s => { if ((s.stop_name||'').toLowerCase().includes((n||'').toLowerCase())) originCandidateIds.add(s.stop_id); });
                                                        }
                                                    });
                                                        // Expand candidates via groupedStopMap (include station complexes)
                                                        if (dataManager.groupedStopMap) {
                                                            const toAdd = new Set();
                                                            originCandidateIds.forEach(id => {
                                                                if (dataManager.groupedStopMap[id]) dataManager.groupedStopMap[id].forEach(x => toAdd.add(x));
                                                                // also check parent station mapping
                                                                const stObj = dataManager.getStop(id);
                                                                if (stObj && stObj.parent_station && dataManager.groupedStopMap[stObj.parent_station]) {
                                                                    dataManager.groupedStopMap[stObj.parent_station].forEach(x => toAdd.add(x));
                                                                }
                                                            });
                                                            toAdd.forEach(x => originCandidateIds.add(x));
                                                        }

                                                    if (alightIndex > -1) {
                                                        // search backwards for any origin candidate stop id
                                                        for (let i = Math.min(alightIndex - 1, stopTimesList.length - 1); i >= 0; i--) {
                                                            if (originCandidateIds.size > 0 && originCandidateIds.has(stopTimesList[i].stop_id)) { boardingIndex = i; break; }
                                                        }

                                                        // if none found, pick a reasonable predecessor (up to 3 stops before the alight)
                                                        if (boardingIndex === null) {
                                                            boardingIndex = Math.max(0, alightIndex - 2);
                                                        }
                                                    } else {
                                                        // alightIndex not found: default to first stop or 0
                                                        boardingIndex = 0;
                                                    }
                                                } catch (err) {
                                                    console.warn('Erreur détermination boardingIndex GTFS, fallback utilisé', err);
                                                    boardingIndex = 0;
                                                }

                                                const boardingST = stopTimesList[boardingIndex] || stopTimesList[0] || st;
                                                const alightingST = stopTimesList[alightIndex] || st;

                                const boardingStopObj = dataManager.getStop(boardingST.stop_id) || { stop_name: boardingST.stop_id, stop_lat: 0, stop_lon: 0 };
                                const alightingStopObj = dataManager.getStop(alightingST.stop_id) || { stop_name: alightingST.stop_id, stop_lat: 0, stop_lon: 0 };

                                // If we have origin candidate IDs from Google, ensure the chosen boarding stop
                                // actually matches one of them or is geographically close enough.
                                // This avoids proposing trips that merely pass the destination stop
                                // but do not start near the requested origin.
                                const DIST_THRESHOLD_METERS = 500; // max acceptable walking distance to boarding
                                if (originCandidateIds && originCandidateIds.size > 0) {
                                    if (!originCandidateIds.has(boardingST.stop_id)) {
                                        // Not exact match by ID — compute nearest origin candidate distance
                                        let minDist = Infinity;
                                        originCandidateIds.forEach(cid => {
                                            const cand = dataManager.getStop(cid);
                                            if (cand && cand.stop_lat && cand.stop_lon && boardingStopObj && boardingStopObj.stop_lat) {
                                                const d = dataManager.calculateDistance(parseFloat(cand.stop_lat), parseFloat(cand.stop_lon), parseFloat(boardingStopObj.stop_lat), parseFloat(boardingStopObj.stop_lon));
                                                if (!Number.isNaN(d) && d < minDist) minDist = d;
                                            }
                                        });
                                        if (minDist === Infinity) {
                                            console.debug('GTFS injection: no origin candidate coordinates to compare, rejecting trip', { tripId: st.trip_id, boarding: boardingST.stop_id });
                                            continue;
                                        }
                                        if (minDist > DIST_THRESHOLD_METERS) {
                                            console.debug('GTFS injection: boarding stop too far from origin candidates, skip', { tripId: st.trip_id, boarding: boardingST.stop_id, minDist });
                                            continue;
                                        }
                                        // Otherwise accept (within distance threshold)
                                        console.debug('GTFS injection: boarding stop accepted by proximity', { tripId: st.trip_id, boarding: boardingST.stop_id, minDist });
                                    } else {
                                        // Exact match by ID
                                        console.debug('GTFS injection: boarding stop accepted by exact match', { tripId: st.trip_id, boarding: boardingST.stop_id });
                                    }
                                }

                                const depSeconds = dataManager.timeToSeconds(boardingST.departure_time || boardingST.arrival_time || '00:00:00');
                                const arrSeconds = dataManager.timeToSeconds(alightingST.arrival_time || alightingST.departure_time || '00:00:00');

                                // Diagnostic: report when readable names are missing or when boarding is far from alight
                                if (!boardingStopObj || !boardingStopObj.stop_name || boardingStopObj.stop_name === boardingST.stop_id) {
                                    console.debug('GTFS injection: boarding stop has no readable name', { tripId: st.trip_id, boardingST });
                                }
                                if (!alightingStopObj || !alightingStopObj.stop_name || alightingStopObj.stop_name === alightingST.stop_id) {
                                    console.debug('GTFS injection: alighting stop has no readable name', { tripId: st.trip_id, alightingST });
                                }

                                // Récupérer géométrie shape/route
                                let geometry = dataManager.getRouteGeometry(trip.route_id);
                                if (!geometry && trip.shape_id) {
                                    geometry = dataManager.getShapeGeoJSON(trip.shape_id, trip.route_id);
                                }

                                // Convertir geometry en tableau de [lon, lat] points (comme dans geojson)
                                const extractRouteCoords = (geom) => {
                                    if (!geom) return null;
                                    if (Array.isArray(geom)) return geom; // assume already coords
                                    if (geom.type === 'LineString') return geom.coordinates;
                                    if (geom.type === 'MultiLineString') return geom.coordinates.flat();
                                    return null;
                                };

                                const routeCoords = extractRouteCoords(geometry);
                                let busPolylineEncoded = null;
                                let busPolylineLatLngs = null;
                                if (routeCoords && routeCoords.length > 0) {
                                    // dataManager.findNearestPointOnRoute expects [lon, lat] pairs
                                    const startIdx = dataManager.findNearestPointOnRoute(routeCoords, parseFloat(boardingStopObj.stop_lat), parseFloat(boardingStopObj.stop_lon));
                                    const endIdx = dataManager.findNearestPointOnRoute(routeCoords, parseFloat(alightingStopObj.stop_lat), parseFloat(alightingStopObj.stop_lon));
                                    let slice = null;
                                    if (startIdx != null && endIdx != null) {
                                        if (startIdx <= endIdx) slice = routeCoords.slice(startIdx, endIdx + 1);
                                        else slice = [...routeCoords].slice(endIdx, startIdx + 1).reverse();
                                    }
                                    if (!slice || slice.length < 2) {
                                        slice = [[parseFloat(boardingStopObj.stop_lon), parseFloat(boardingStopObj.stop_lat)], [parseFloat(alightingStopObj.stop_lon), parseFloat(alightingStopObj.stop_lat)]];
                                    }
                                    // convert [lon,lat] to [lat,lon]
                                    const latlngs = slice
                                        .map(p => [Number(p[1]), Number(p[0])])
                                        .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
                                    if (latlngs.length >= 2) {
                                        busPolylineLatLngs = latlngs;
                                        busPolylineEncoded = encodePolyline(latlngs);
                                    }
                                }

                                const intermediateStops = [];
                                if (stopTimesList && stopTimesList.length > 0 && alightIndex > boardingIndex) {
                                    const mids = stopTimesList.slice(boardingIndex + 1, alightIndex).map(s => dataManager.getStop(s.stop_id)?.stop_name || s.stop_id);
                                    intermediateStops.push(...mids);
                                }

                                const busStep = {
                                    type: 'BUS',
                                    icon: ICONS.BUS,
                                    instruction: `Prendre ${routeName} vers ${trip.trip_headsign}`,
                                    polyline: busPolylineEncoded ? { encodedPolyline: busPolylineEncoded, latLngs: busPolylineLatLngs } : null,
                                    routeColor: route.route_color ? `#${route.route_color}` : '#3388ff',
                                    routeTextColor: route.route_text_color ? `#${route.route_text_color}` : '#ffffff',
                                    routeShortName: routeName,
                                    departureStop: boardingStopObj.stop_name || boardingST.stop_id,
                                    arrivalStop: alightingStopObj.stop_name || alightingST.stop_id,
                                    departureTime: dataManager.formatTime(depSeconds),
                                    arrivalTime: dataManager.formatTime(arrSeconds),
                                    duration: dataManager.formatDuration(Math.max(0, arrSeconds - depSeconds)) || 'Horaires théoriques',
                                    intermediateStops,
                                    numStops: Math.max(0, (alightIndex - boardingIndex)),
                                    _durationSeconds: Math.max(0, arrSeconds - depSeconds)
                                };

                                const itin = {
                                    type: 'BUS',
                                    tripId: st.trip_id,
                                    trip: trip,
                                    route: route,
                                    departureTime: busStep.departureTime || '~',
                                    arrivalTime: busStep.arrivalTime || dataManager.formatTime(seconds),
                                    summarySegments: [{ type: 'BUS', name: routeName, color: route.route_color ? `#${route.route_color}` : '#3388ff', textColor: route.route_text_color ? `#${route.route_text_color}` : '#ffffff' }],
                                    durationRaw: busStep._durationSeconds || 0,
                                    duration: busStep.duration || 'Horaires théoriques',
                                    steps: [busStep]
                                };
                                    // Verify trip headsign/direction loosely matches candidate arrival names to avoid cloning reverse trips
                                    if (trip.trip_headsign) {
                                        const th = (trip.trip_headsign || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
                                        const matchesHeadsign = Array.from(candidateNames).some(n => {
                                            if (!n) return false;
                                            const normalizedN = n.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
                                            // Match si headsign contient le nom OU si le nom contient le headsign
                                            return th.includes(normalizedN) || normalizedN.includes(th);
                                        });
                                        if (!matchesHeadsign) {
                                            console.debug('GTFS injection: trip headsign does not match candidate arrival names, skipping', { 
                                                tripId: st.trip_id, 
                                                trip_headsign: trip.trip_headsign,
                                                candidateNames: Array.from(candidateNames)
                                            });
                                            continue;
                                        }
                                    }
                                    gtfsAdded.push(itin);
                            }
                        }
                    }
                }
                console.log(`✅ Bus GTFS ajoutés : ${gtfsAdded.length}`);
            }

            // E. INCLURE LES RÉSULTATS GTFS DANS L'AFFICHAGE (fenêtre stricte: jusqu'à l'heure demandée)
            // On annote d'abord les bus Google confirmés par GTFS
            let matchedCount = 0;
            filteredBus.forEach(it => {
                const key = `${it.summarySegments[0]?.name}_${it.arrivalTime}`;
                const match = gtfsAdded.find(g => `${g.summarySegments[0]?.name}_${g.arrivalTime}` === key);
                // Do not annotate Google itineraries with provenance flags — treat all sources uniformly in UI.
            });

            // Préparer la liste combinée (Google + GTFS) — sans limitation du nombre
            const allBuses = [];
            // Ajouter les bus Google filtrés (déjà dans la fenêtre [req-30min, req])
            filteredBus.forEach(it => {
                allBuses.push({ itin: it, arrivalMs: parseArrivalMs(it.arrivalTime), source: 'google' });
            });
            // Ajouter les bus GTFS trouvés dans la même fenêtre
            gtfsAdded.forEach(g => {
                const arrivalMs = parseArrivalMs(g.arrivalTime);
                // uniquement si dans la fenêtre (sécurité)
                if (!isNaN(arrivalMs) && arrivalMs >= windowStart && arrivalMs <= windowEnd) {
                    allBuses.push({ itin: g, arrivalMs: arrivalMs, source: 'gtfs' });
                }
            });

            // Trier chronologiquement par heure d'arrivée
            allBuses.sort((a, b) => a.arrivalMs - b.arrivalMs);

            // Diagnostics GTFS
            const missingGtfs = gtfsAdded.filter(g => !filteredBus.some(f => `${f.summarySegments[0]?.name}_${f.arrivalTime}` === `${g.summarySegments[0]?.name}_${g.arrivalTime}`));
            itineraries._gtfsDiagnostics = {
                candidateStopIds: Array.from(candidateStopIds || []),
                gtfsFound: gtfsAdded.length,
                googleFound: filteredBus.length,
                matched: matchedCount,
                missing: missingGtfs.map(g => ({ route: g.summarySegments[0]?.name, arrival: g.arrivalTime, tripId: g.tripId }))
            };

            if (missingGtfs.length > 0) {
                console.warn(`⚠️ GTFS: ${missingGtfs.length} départ(s) trouvés dans GTFS mais non proposés par l'API Google.`);
                console.table(itineraries._gtfsDiagnostics.missing);
            } else {
                console.log('✅ GTFS et Google cohérents pour cette fenêtre.');
            }

            // F. RECONSTRUIRE LA LISTE FINALE: inclure TOUS les bus (Google + GTFS) sans limite
            itineraries.length = 0;
            allBuses.forEach(b => itineraries.push(b.itin));
            // Rajouter piéton/vélo filtrés dans la fenêtre demandée
            const filteredOther = otherItins.filter(o => {
                if (!o.arrivalTime || o.arrivalTime === '~' || o.arrivalTime === '--:--') return false;
                const ms = parseArrivalMs(o.arrivalTime);
                return !isNaN(ms) && ms >= windowStart && ms <= windowEnd;
            });
            itineraries.push(...filteredOther);
        }
    } catch (e) {
        console.warn('Erreur lors du filtrage par heure d\'arrivée:', e);
    }

    // Deduplication commune
    let finalList = deduplicateItineraries(itineraries);

    // Tri + pagination spécifique au mode "arriver"
    if (searchTime && searchTime.type === 'arriver') {
        const parseArrivalMsGeneric = (arrivalStr, baseDate) => {
            if (!arrivalStr || typeof arrivalStr !== 'string') return Infinity;
            const m = arrivalStr.match(/(\d{1,2}):(\d{2})/);
            if (!m) return Infinity;
            const hh = parseInt(m[1], 10);
            const mm = parseInt(m[2], 10);
            const d = new Date(baseDate);
            d.setHours(hh, mm, 0, 0);
            return d.getTime();
        };

        let baseDate;
        if (!searchTime.date || searchTime.date === 'today' || searchTime.date === "Aujourd'hui") baseDate = new Date();
        else baseDate = new Date(searchTime.date);
        baseDate.setHours(parseInt(searchTime.hour)||0, parseInt(searchTime.minute)||0, 0, 0);

        const scored = finalList.map(it => {
            const steps = Array.isArray(it.steps) ? it.steps : [];
            const busSteps = steps.filter(s => s.type === 'BUS');
            const walkSteps = steps.filter(s => s.type === 'WALK' || s._isWalk);
            const transfers = Math.max(0, busSteps.length - 1);
            const walkingDurationMin = walkSteps.reduce((acc, s) => {
                const m = (s.duration||'').match(/(\d+)/);
                return acc + (m ? parseInt(m[1],10) : 0);
            }, 0);
            const arrivalMs = parseArrivalMsGeneric(it.arrivalTime, baseDate);
            const durationRaw = it.durationRaw || 0;
            return { it, arrivalMs, transfers, walkingDurationMin, durationRaw };
        });

        scored.sort((a, b) => {
            if (a.arrivalMs !== b.arrivalMs) return a.arrivalMs - b.arrivalMs; // plus tôt d'abord
            if (a.transfers !== b.transfers) return a.transfers - b.transfers; // moins de correspondances
            if (a.walkingDurationMin !== b.walkingDurationMin) return a.walkingDurationMin - b.walkingDurationMin; // moins de marche
            return a.durationRaw - b.durationRaw; // plus rapide
        });

        arrivalRankedAll = scored.map(x => x.it);
        arrivalRenderedCount = ARRIVAL_PAGE_SIZE; // initial slice
        finalList = arrivalRankedAll.slice(0, ARRIVAL_PAGE_SIZE);
    }

    return finalList;
}

/**
 * Ensure every BUS step has a polyline. Attempts to reconstruct from GTFS data (shape or route geometry)
 * and falls back to a straight encoded line between boarding and alighting stops when necessary.
 * This is defensive: some GTFS-inserted itineraries may miss polylines and the renderer expects them.
 */
async function ensureItineraryPolylines(itineraries) {
    if (!Array.isArray(itineraries) || !dataManager) return;

    const shapesReady = await dataManager.ensureShapesIndexLoaded();
    if (shapesReady === false) {
        console.warn('ensureItineraryPolylines: les shapes GTFS n\'ont pas pu être chargées.');
    }

    const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '').trim();

    for (const itin of itineraries) {
        if (!itin || !Array.isArray(itin.steps)) continue;
        for (const step of itin.steps) {
            try {
            if (!step || step.type !== 'BUS' || isWaitStep(step)) continue;

                const hasLatLngs = Array.isArray(step?.polyline?.latLngs) && step.polyline.latLngs.length >= 2;
                if (hasLatLngs) continue;

                const routeId = (itin.route && (itin.route.route_id || itin.routeId)) || null;
                const shapeId = (itin.trip && itin.trip.shape_id) || (itin.shapeId) || null;
                const hasLocalGeometryHints = Boolean(routeId || shapeId || itin.tripId || itin.trip);

                const hasExistingEncoded = step.polyline && (step.polyline.encodedPolyline || step.polyline.points);
                if (!hasLocalGeometryHints && hasExistingEncoded) {
                    // Probable itinéraire Google déjà complet -> garder la polyline fournie
                    continue;
                }

                // Try to find departure/arrival stops via stop names (fast path)
                let depStopObj = null, arrStopObj = null;
                let resolvedDepCoords = null, resolvedArrCoords = null;
                try {
                    if (step.departureStop) {
                        const candidates = (dataManager.findStopsByName && dataManager.findStopsByName(step.departureStop, 3)) || [];
                        if (candidates.length) depStopObj = candidates[0];
                    }
                    if (step.arrivalStop) {
                        const candidates = (dataManager.findStopsByName && dataManager.findStopsByName(step.arrivalStop, 3)) || [];
                        if (candidates.length) arrStopObj = candidates[0];
                    }

                    // If still missing, try to use itinerary-level info (trip/route) and match by times or stop_id
                    if ((!depStopObj || !arrStopObj) && itin.tripId) {
                        const stopTimes = dataManager.getStopTimes(itin.tripId) || [];
                        if (stopTimes.length >= 1) {
                            // Attempt to match by departureTime/arrivalTime strings if available
                            if (!depStopObj && step.departureTime && step.departureTime !== '~') {
                                const match = stopTimes.find(st => (st.departure_time || st.arrival_time) && ((st.departure_time && st.departure_time.startsWith(step.departureTime)) || (st.arrival_time && st.arrival_time.startsWith(step.departureTime))));
                                if (match) depStopObj = dataManager.getStop(match.stop_id);
                            }
                            if (!arrStopObj && step.arrivalTime && step.arrivalTime !== '~') {
                                const match = stopTimes.find(st => (st.arrival_time || st.departure_time) && ((st.arrival_time && st.arrival_time.startsWith(step.arrivalTime)) || (st.departure_time && st.departure_time.startsWith(step.arrivalTime))));
                                if (match) arrStopObj = dataManager.getStop(match.stop_id);
                            }

                            // If still not found, try matching by raw stop_id if the UI shows one (some raw IDs include ':')
                            if (!depStopObj && step.departureStop && step.departureStop.indexOf(':') !== -1) {
                                depStopObj = dataManager.getStop(step.departureStop) || depStopObj;
                            }
                            if (!arrStopObj && step.arrivalStop && step.arrivalStop.indexOf(':') !== -1) {
                                arrStopObj = dataManager.getStop(step.arrivalStop) || arrStopObj;
                            }

                            // Final fallback from stopTimes: choose first/last stops if one side still missing
                            if (!depStopObj && stopTimes.length) depStopObj = dataManager.getStop(stopTimes[0].stop_id);
                            if (!arrStopObj && stopTimes.length) arrStopObj = dataManager.getStop(stopTimes[stopTimes.length - 1].stop_id);
                        }
                    }
                } catch (err) {
                    console.warn('ensureItineraryPolylines: erreur résolution arrêts', err);
                }

                if (!depStopObj && step.departureStop) {
                    resolvedDepCoords = resolveStopCoordinates(step.departureStop, dataManager);
                }
                if (!arrStopObj && step.arrivalStop) {
                    resolvedArrCoords = resolveStopCoordinates(step.arrivalStop, dataManager);
                }

                // Build encoded polyline from route geometry when possible
                let encoded = null;
                let latLngPoints = null;
                let geometry = routeId ? dataManager.getRouteGeometry(routeId) : null;
                if (!geometry && shapeId) geometry = dataManager.getShapeGeoJSON(shapeId, routeId);

                const geometryToLatLngs = (geom) => {
                    if (!geom) return null;

                    const toLatLng = (pair) => {
                        if (!Array.isArray(pair) || pair.length < 2) return null;
                        const lon = parseFloat(pair[0]);
                        const lat = parseFloat(pair[1]);
                        if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
                        return [lat, lon];
                    };

                    let rawPoints = null;
                    if (Array.isArray(geom)) {
                        rawPoints = geom;
                    } else if (geom.type === 'LineString') {
                        rawPoints = geom.coordinates;
                    } else if (geom.type === 'MultiLineString') {
                        rawPoints = geom.coordinates.flat();
                    }

                    if (!rawPoints) return null;
                    const converted = rawPoints.map(toLatLng).filter(Boolean);
                    return converted.length >= 2 ? converted : null;
                };

                const latlngs = geometryToLatLngs(geometry);

                if (latlngs && latlngs.length >= 2 && depStopObj && arrStopObj) {
                    // find nearest indices
                    const findNearestIdx = (points, targetLat, targetLon) => {
                        let best = 0; let bestD = Infinity;
                        for (let i = 0; i < points.length; i++) {
                            const d = dataManager.calculateDistance(targetLat, targetLon, points[i][0], points[i][1]);
                            if (d < bestD) { bestD = d; best = i; }
                        }
                        return best;
                    };
                    const startIdx = findNearestIdx(latlngs, parseFloat(depStopObj.stop_lat), parseFloat(depStopObj.stop_lon));
                    const endIdx = findNearestIdx(latlngs, parseFloat(arrStopObj.stop_lat), parseFloat(arrStopObj.stop_lon));
                    let slice = null;
                    if (startIdx != null && endIdx != null && startIdx !== endIdx) {
                        if (startIdx < endIdx) slice = latlngs.slice(startIdx, endIdx + 1);
                        else slice = [...latlngs].slice(endIdx, startIdx + 1).reverse();
                    }
                    if (!slice || slice.length < 2) {
                        slice = [
                            [parseFloat(depStopObj.stop_lat), parseFloat(depStopObj.stop_lon)],
                            [parseFloat(arrStopObj.stop_lat), parseFloat(arrStopObj.stop_lon)]
                        ];
                    }
                    latLngPoints = slice
                        .map(pair => [Number(pair[0]), Number(pair[1])])
                        .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
                    encoded = latLngPoints.length >= 2 ? encodePolyline(latLngPoints) : null;
                    console.log('ensureItineraryPolylines: polyline reconstruite depuis la géométrie', {
                        itinId: itin.tripId || itin.trip?.trip_id || null,
                        stepRoute: routeId,
                        pointCount: latLngPoints?.length || 0
                    });
                }

                // Final fallback: direct straight line using available coordinates
                if (!encoded) {
                    const dep = depStopObj
                        ? { lat: parseFloat(depStopObj.stop_lat), lon: parseFloat(depStopObj.stop_lon) }
                        : (resolvedDepCoords ? { lat: resolvedDepCoords.lat, lon: resolvedDepCoords.lng } : null);
                    const arr = arrStopObj
                        ? { lat: parseFloat(arrStopObj.stop_lat), lon: parseFloat(arrStopObj.stop_lon) }
                        : (resolvedArrCoords ? { lat: resolvedArrCoords.lat, lon: resolvedArrCoords.lng } : null);
                    if (dep && arr && !Number.isNaN(dep.lat) && !Number.isNaN(arr.lat)) {
                        latLngPoints = [[dep.lat, dep.lon], [arr.lat, arr.lon]];
                        encoded = encodePolyline(latLngPoints);
                        console.log('ensureItineraryPolylines: fallback polyline directe utilisée', {
                            itinId: itin.tripId || itin.trip?.trip_id || null,
                            stepRoute: routeId
                        });
                    }
                }

                if (encoded && latLngPoints && latLngPoints.length >= 2) {
                    step.polyline = { encodedPolyline: encoded, latLngs: latLngPoints };
                    console.debug('ensureItineraryPolylines: reconstructed polyline', { itinId: itin.tripId || itin.trip?.trip_id || null });
                } else {
                    console.warn('ensureItineraryPolylines: impossible de reconstruire la polyline pour une étape BUS (aucune coordonnée fiable)', {
                        itinId: itin.tripId || itin.trip?.trip_id || null,
                        stepRoute: routeId,
                        departureStop: step.departureStop,
                        arrivalStop: step.arrivalStop
                    });
                }
            } catch (err) {
                console.warn('ensureItineraryPolylines error for step', err);
            }
        }
    }
}

function processSimpleRoute(data, mode, modeInfo, searchTime) { 
    if (!data || !data.routes || data.routes.length === 0 || !modeInfo) return null;
    const route = data.routes[0];
    const leg = route.legs[0];
    const durationMinutes = modeInfo.duration;
    const distanceKm = modeInfo.distance;
    const durationRawSeconds = durationMinutes * 60;
    const icon = mode === 'bike' ? ICONS.BICYCLE : ICONS.WALK;
    const modeLabel = mode === 'bike' ? 'Vélo' : 'Marche';
    const type = mode === 'bike' ? 'BIKE' : 'WALK';
    
    let departureTimeStr = "~";
    let arrivalTimeStr = "~";
    if (searchTime.type === 'partir') {
        try {
            let departureDate;
            if(searchTime.date === 'today' || searchTime.date === "Aujourd'hui" || !searchTime.date) {
                departureDate = new Date();
            } else {
                departureDate = new Date(searchTime.date);
            }
            departureDate.setHours(searchTime.hour, searchTime.minute, 0, 0);
            const arrivalDate = new Date(departureDate.getTime() + durationRawSeconds * 1000);
            departureTimeStr = `${String(departureDate.getHours()).padStart(2, '0')}:${String(departureDate.getMinutes()).padStart(2, '0')}`;
            arrivalTimeStr = `${String(arrivalDate.getHours()).padStart(2, '0')}:${String(arrivalDate.getMinutes()).padStart(2, '0')}`;
        } catch(e) {
            console.warn("Erreur calcul date pour vélo/marche", e);
        }
    } else if (searchTime.type === 'arriver') {
        // Recherche "Arriver" : on fixe l'heure d'arrivée et on déduit l'heure de départ.
        try {
            let arrivalDate;
            if(searchTime.date === 'today' || searchTime.date === "Aujourd'hui" || !searchTime.date) {
                arrivalDate = new Date();
            } else {
                arrivalDate = new Date(searchTime.date);
            }
            arrivalDate.setHours(searchTime.hour, searchTime.minute, 0, 0);
            const departureDate = new Date(arrivalDate.getTime() - durationRawSeconds * 1000);
            arrivalTimeStr = `${String(arrivalDate.getHours()).padStart(2, '0')}:${String(arrivalDate.getMinutes()).padStart(2, '0')}`;
            departureTimeStr = `${String(departureDate.getHours()).padStart(2, '0')}:${String(departureDate.getMinutes()).padStart(2, '0')}`;
        } catch(e) {
            console.warn("Erreur calcul date (arriver) pour vélo/marche", e);
        }
    }

    const aggregatedStep = {
        type: type, icon: icon, instruction: modeLabel,
        distance: `${distanceKm} km`, duration: `${durationMinutes} min`,
        subSteps: [], polylines: [], departureTime: "~", arrivalTime: "~",
        durationRaw: durationRawSeconds
    };

    leg.steps.forEach(step => {
        const distanceText = step.localizedValues?.distance?.text || '';
        const instruction = step.navigationInstruction?.instructions || step.localizedValues?.instruction || (mode === 'bike' ? "Continuer à vélo" : "Marcher");
        const duration = formatGoogleDuration(step.staticDuration); 
        const maneuver = step.navigationInstruction?.maneuver || 'DEFAULT';
        aggregatedStep.subSteps.push({ instruction, distance: distanceText, duration, maneuver });
        aggregatedStep.polylines.push(step.polyline);
    });
    
    return {
        type: type, departureTime: departureTimeStr, arrivalTime: arrivalTimeStr,
        duration: `${durationMinutes} min`, durationRaw: durationRawSeconds,
        polyline: route.polyline, summarySegments: [], steps: [aggregatedStep],
        _isBike: mode === 'bike', _isWalk: mode ==='walk'
    };
}

function setupResultTabs(itineraries) {
    if (!resultsModeTabs) return;
    if (!itineraries || !itineraries.length) {
        resultsModeTabs.classList.add('hidden');
        return;
    }
    const tabs = {
        ALL: resultsModeTabs.querySelector('[data-mode="ALL"]'),
        BUS: resultsModeTabs.querySelector('[data-mode="BUS"]'),
        BIKE: resultsModeTabs.querySelector('[data-mode="BIKE"]'),
        WALK: resultsModeTabs.querySelector('[data-mode="WALK"]')
    };
    const bestAll = itineraries[0];
    const bestBus = itineraries.find(i => i.type === 'BUS');
    const bestBike = itineraries.find(i => i.type === 'BIKE');
    const bestWalk = itineraries.find(i => i.type === 'WALK');

    const fillTab = (tab, itinerary, icon) => {
        if (!tab) return;
        let durationHtml = `<span class="mode-tab-duration empty">--</span>`;
        let iconHtml = icon;
        if (itinerary) {
            durationHtml = `<span class="mode-tab-duration">${itinerary.duration}</span>`;
            if (tab === tabs.ALL) iconHtml = ICONS.ALL;
            tab.classList.remove('hidden');
        } else {
            tab.classList.add('hidden'); 
        }
        tab.innerHTML = `${iconHtml}${durationHtml}`;
    };

    fillTab(tabs.ALL, bestAll, ICONS.ALL);
    fillTab(tabs.BUS, bestBus, ICONS.BUS);
    fillTab(tabs.BIKE, bestBike, ICONS.BICYCLE);
    fillTab(tabs.WALK, bestWalk, ICONS.WALK);

    resultsModeTabs.querySelectorAll('.mode-tab').forEach(tab => {
        const newTab = tab.cloneNode(true);
        tab.parentNode.replaceChild(newTab, tab);
        newTab.addEventListener('click', () => {
            resultsModeTabs.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
            newTab.classList.add('active');
            const mode = newTab.dataset.mode;
            if (resultsRenderer) resultsRenderer.render(mode);
        });
    });
    const defaultActiveTab = resultsModeTabs.querySelector('[data-mode="ALL"]');
    if (defaultActiveTab) {
        defaultActiveTab.classList.add('active');
    }
    resultsModeTabs.classList.remove('hidden');
}

// ===================================================================
// main.js - V47 (Partie 2/2 : Rendu visuel et Marqueurs)
// ... (suite de la Partie 1)
//
// *** MODIFICATION V52 (Partie 2) ***
// 1. (Logique de titrage V52 - sera remplacée par V56)
//
// *** MODIFICATION V53 (Partie 2) ***
// 1. (Corrections de filtrage V53 - sera remplacée par V56)
//
// *** MODIFICATION V56 (Partie 2) ***
// 1. Logique de titrage dans `renderItineraryResults` entièrement révisée
//    pour lireSigma
//
// *** MODIFICATION V57.1 (Partie 2) ***
// 1. Correction du SyntaxError: "Illegal continue statement" (remplacé par "return")
//    dans la fonction `initializeRouteFilter`.
// ===================================================================

// Anciennes fonctions de rendu (getItineraryType, renderItineraryResults) supprimées.

/**
 * *** MODIFIÉ V44 ***
 * Helper pour déterminer le style Leaflet (couleur, hachures)
 * en fonction d'une ÉTAPE d'itinéraire.
 */
function getLeafletStyleForStep(step) {
    // Vérifie le type simple (vélo/marche)
    if (step.type === 'BIKE') {
        return {
            color: 'var(--secondary)', // Gris
            weight: 5,
            opacity: 0.8
        };
    }
    if (step.type === 'WALK') {
        return {
            color: 'var(--primary)', // Bleu (couleur primaire)
            weight: 5,
            opacity: 0.8,
            dashArray: '10, 10' // Hachuré
        };
    }
    // Vérifie le type Bus
    if (step.type === 'BUS') {
        const busColor = step.routeColor || 'var(--primary)'; // Fallback
        return {
            color: busColor,
            weight: 5,
            opacity: 0.8
        };
    }
    
    // Fallback pour les types Google (au cas où)
    if (step.travelMode === 'BICYCLE') return getLeafletStyleForStep({type: 'BIKE'});
    if (step.travelMode === 'WALK') return getLeafletStyleForStep({type: 'WALK'});
    if (step.travelMode === 'TRANSIT') return getLeafletStyleForStep({type: 'BUS', routeColor: step.routeColor});

    // Style par défaut
    return {
        color: 'var(--primary)',
        weight: 5,
        opacity: 0.8
    };
}

const getEncodedPolylineValue = (polyline) => {
    if (!polyline) return null;
    if (typeof polyline === 'string') return polyline;
    return polyline.encodedPolyline || polyline.points || null;
};

const getPolylineLatLngs = (polyline) => {
    if (!polyline) return null;

    const normalizePairs = (pairs) => {
        if (!Array.isArray(pairs)) return null;
        const normalized = pairs
            .map((pair) => {
                if (!Array.isArray(pair) || pair.length < 2) return null;
                const lat = Number(pair[0]);
                const lon = Number(pair[1]);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
                return [lat, lon];
            })
            .filter(Boolean);
        return normalized.length ? normalized : null;
    };

    if (Array.isArray(polyline)) {
        const direct = normalizePairs(polyline);
        if (direct) return direct;
    }

    if (Array.isArray(polyline.latLngs)) {
        const direct = normalizePairs(polyline.latLngs);
        if (direct) return direct;
    }

    if (Array.isArray(polyline.points)) {
        const maybeRaw = normalizePairs(polyline.points);
        if (maybeRaw) return maybeRaw;
    }

    if (Array.isArray(polyline.coordinates)) {
        const converted = normalizePairs(polyline.coordinates.map(([lng, lat]) => [lat, lng]));
        if (converted) return converted;
    }

    const encoded = getEncodedPolylineValue(polyline);
    if (encoded) {
        try {
            return decodePolyline(encoded);
        } catch (err) {
            console.warn('getPolylineLatLngs: decode failed', err);
        }
    }

    return null;
};

const isWaitStep = (step) => {
    if (!step) return false;
    if (step.type === 'WAIT') return true;
    const instruction = (step.instruction || '').toLowerCase();
    const looksLikeWait = instruction.includes('correspondance') || instruction.includes('attente') || instruction.includes('transfert');
    const missingRoute = isMissingTextValue(step.routeShortName);
    const missingStops = isMissingTextValue(step.departureStop) && isMissingTextValue(step.arrivalStop);
    return looksLikeWait && (missingRoute || missingStops);
};

function extractStepPolylines(step) {
    if (!step || isWaitStep(step)) return [];

    const collected = [];
    const pushIfValid = (poly) => {
        if (poly) collected.push(poly);
    };

    if (step.type === 'BUS') {
        pushIfValid(step?.polyline);
    } else if (Array.isArray(step.polylines) && step.polylines.length) {
        step.polylines.forEach(pushIfValid);
    } else {
        pushIfValid(step?.polyline);
    }

    return collected;
}

/**
 * ✅ V62: AMÉLIORATION - Ajoute les marqueurs de Début, Fin, Correspondance et Arrêts intermédiaires
 * - Ronds verts pour le début
 * - Ronds rouges pour la fin
 * - Ronds jaunes pour les correspondances
 * - Petits ronds blancs pour les arrêts intermédiaires
 */
function addItineraryMarkers(itinerary, map, markerLayer) {
    if (!itinerary || !Array.isArray(itinerary.steps) || !map || !markerLayer) return;

    markerLayer.clearLayers();

    const busSteps = itinerary.steps.filter(step => step.type === 'BUS' && !isWaitStep(step));
    if (!busSteps.length) {
        addFallbackItineraryMarkers(itinerary, markerLayer);
        return;
    }

    const stopPoints = [];

    busSteps.forEach((step, index) => {
        const isFirstBus = index === 0;
        const isLastBus = index === busSteps.length - 1;
        const stepStops = [];

        // Arrêt de départ
        if (step.departureStop) {
            stepStops.push({ name: step.departureStop, role: isFirstBus ? 'boarding' : 'transfer' });
        }

        // Arrêts intermédiaires - Essayer plusieurs sources
        let intermediateStopsData = [];
        
        // Source 1: intermediateStops du step (noms)
        if (Array.isArray(step.intermediateStops) && step.intermediateStops.length > 0) {
            intermediateStopsData = step.intermediateStops.map(stopName => ({
                name: typeof stopName === 'string' ? stopName : (stopName?.name || stopName?.stop_name || ''),
                lat: stopName?.lat || stopName?.stop_lat || null,
                lng: stopName?.lng || stopName?.stop_lon || null
            }));
        }
        
        // Source 2: Si le step contient les stopTimes avec coordonnées (du router local)
        if (intermediateStopsData.length === 0 && Array.isArray(step.stopTimes)) {
            intermediateStopsData = step.stopTimes.slice(1, -1).map(st => {
                const stopObj = dataManager?.getStop?.(st.stop_id);
                return {
                    name: stopObj?.stop_name || st.stop_id,
                    lat: parseFloat(stopObj?.stop_lat) || null,
                    lng: parseFloat(stopObj?.stop_lon) || null
                };
            });
        }
        
        // Ajouter les arrêts intermédiaires
        intermediateStopsData.forEach(stop => {
            if (stop.name) {
                stepStops.push({ 
                    name: stop.name, 
                    role: 'intermediate',
                    directLat: stop.lat,
                    directLng: stop.lng
                });
            }
        });

        // Arrêt d'arrivée
        if (step.arrivalStop) {
            stepStops.push({ name: step.arrivalStop, role: isLastBus ? 'alighting' : 'transfer' });
        }

        // Résoudre les coordonnées pour chaque arrêt
        stepStops.forEach(stop => {
            let coords = null;
            
            // Utiliser les coordonnées directes si disponibles
            if (stop.directLat && stop.directLng) {
                coords = { lat: stop.directLat, lng: stop.directLng };
            } else {
                // Sinon, résoudre via le dataManager
                coords = resolveStopCoordinates(stop.name, dataManager);
            }
            
            if (!coords) {
                console.log(`⚠️ Coordonnées non trouvées pour: ${stop.name}`);
                return;
            }

            const key = `${coords.lat.toFixed(5)}-${coords.lng.toFixed(5)}`;
            const existing = stopPoints.find(point => point.key === key);
            if (existing) {
                if (STOP_ROLE_PRIORITY[stop.role] > STOP_ROLE_PRIORITY[existing.role]) {
                    existing.role = stop.role;
                }
                if (!existing.names.includes(stop.name)) {
                    existing.names.push(stop.name);
                }
                return;
            }

            stopPoints.push({
                key,
                lat: coords.lat,
                lng: coords.lng,
                role: stop.role,
                names: [stop.name]
            });
        });
    });

    if (!stopPoints.length) {
        addFallbackItineraryMarkers(itinerary, markerLayer);
        return;
    }

    // Créer les marqueurs avec z-index approprié
    stopPoints.forEach(point => {
        const icon = createStopDivIcon(point.role);
        if (!icon) return;
        
        // Z-index: boarding/alighting > transfer > intermediate
        let zIndex = 800;
        if (point.role === 'boarding' || point.role === 'alighting') {
            zIndex = 1200;
        } else if (point.role === 'transfer') {
            zIndex = 1000;
        }
        
        const marker = L.marker([point.lat, point.lng], {
            icon,
            zIndexOffset: zIndex
        });
        markerLayer.addLayer(marker);
    });
    
    console.log(`📍 ${stopPoints.length} marqueurs ajoutés (${stopPoints.filter(p => p.role === 'intermediate').length} arrêts intermédiaires)`);
}

function addFallbackItineraryMarkers(itinerary, markerLayer) {
    if (!itinerary || !Array.isArray(itinerary.steps) || !itinerary.steps.length) return;

    const fallbackPoints = [];
    const firstStep = itinerary.steps[0];
    const firstPolyline = (firstStep.type === 'BUS') ? firstStep.polyline : firstStep.polylines?.[0];
    const firstLatLngs = getPolylineLatLngs(firstPolyline);
    if (firstLatLngs && firstLatLngs.length) {
        const [lat, lng] = firstLatLngs[0];
        fallbackPoints.push({ lat, lng, role: 'boarding' });
    }

    itinerary.steps.forEach((step, index) => {
        if (index === itinerary.steps.length - 1) return;
        const polyline = (step.type === 'BUS')
            ? step.polyline
            : (Array.isArray(step.polylines) ? step.polylines[step.polylines.length - 1] : null);
        const latLngs = getPolylineLatLngs(polyline);
        if (latLngs && latLngs.length) {
            const [lat, lng] = latLngs[latLngs.length - 1];
            fallbackPoints.push({ lat, lng, role: 'transfer' });
        }
    });

    const lastStep = itinerary.steps[itinerary.steps.length - 1];
    const lastPolyline = (lastStep.type === 'BUS')
        ? lastStep.polyline
        : (Array.isArray(lastStep.polylines) ? lastStep.polylines[lastStep.polylines.length - 1] : null);
    const lastLatLngs = getPolylineLatLngs(lastPolyline);
    if (lastLatLngs && lastLatLngs.length) {
        const [lat, lng] = lastLatLngs[lastLatLngs.length - 1];
        fallbackPoints.push({ lat, lng, role: 'alighting' });
    }

    fallbackPoints.forEach(point => {
        const icon = createStopDivIcon(point.role);
        if (!icon) return;
        markerLayer.addLayer(L.marker([point.lat, point.lng], {
            icon,
            zIndexOffset: (point.role === 'boarding' || point.role === 'alighting') ? 1200 : 900
        }));
    });
}


/**
 * *** MODIFIÉ V46 (Marqueurs) ***
 * Dessine un tracé sur la carte des résultats PC
 */
function drawRouteOnResultsMap(itinerary) {
    // Accepter un tableau ou un objet unique
    if (Array.isArray(itinerary)) {
        itinerary = itinerary[0];
    }
    if (!resultsMapRenderer || !resultsMapRenderer.map || !itinerary || !itinerary.steps) return;

    if (currentResultsRouteLayer) {
        resultsMapRenderer.map.removeLayer(currentResultsRouteLayer);
        currentResultsRouteLayer = null;
    }
    // Vider les anciens marqueurs
    if (currentResultsMarkerLayer) {
        currentResultsMarkerLayer.clearLayers();
    }

    const stepLayers = [];
    
    itinerary.steps.forEach(step => {
        const style = getLeafletStyleForStep(step);
        
        const polylinesToDraw = extractStepPolylines(step);

        if (!polylinesToDraw.length) {
            return;
        }

        polylinesToDraw.forEach(polyline => {
            const latLngs = getPolylineLatLngs(polyline);
            if (!latLngs || !latLngs.length) {
                return;
            }

            const stepLayer = L.polyline(latLngs, style);
            stepLayers.push(stepLayer);
        });
    });

    if (stepLayers.length > 0) {
        // Créer un groupe avec toutes les couches d'étapes
        currentResultsRouteLayer = L.featureGroup(stepLayers).addTo(resultsMapRenderer.map);
        
        // Ajouter les marqueurs
        addItineraryMarkers(itinerary, resultsMapRenderer.map, currentResultsMarkerLayer);

        // Ajuster la carte pour voir l'ensemble du trajet
        const bounds = currentResultsRouteLayer.getBounds();
        if (bounds && bounds.isValid()) {
            resultsMapRenderer.map.fitBounds(bounds, { padding: [20, 20] });
        }
    }
}


/**
 * *** MODIFIÉ V46 (Icônes Manœuvre + Filtre Bruit) ***
 * Génère le HTML des détails pour l'accordéon PC (Bus)
 */
function renderItineraryDetailHTML(itinerary) {
    
    const stepsHtml = itinerary.steps.map((step, index) => {
        // ✅ V45: Logique de marche (et vélo) restaurée avec <details>
        if (step.type === 'WALK' || step.type === 'BIKE') {
            const hasSubSteps = step.subSteps && step.subSteps.length > 0;
            const icon = (step.type === 'BIKE') ? ICONS.BICYCLE : ICONS.WALK;
            const stepClass = (step.type === 'BIKE') ? 'bicycle' : 'walk';

            // ✅ V46: Filtrer les étapes "STRAIGHT" trop courtes
            const filteredSubSteps = (step.subSteps || []).filter(subStep => {
                const distanceMatch = subStep.distance.match(/(\d+)\s*m/);
                if (subStep.maneuver === 'STRAIGHT' && distanceMatch && parseInt(distanceMatch[1]) < 100) {
                    return false; // Ne pas afficher "Continuer tout droit (80m)"
                }
                return true;
            });

            return `
                <div class="step-detail ${stepClass}" style="--line-color: var(--text-secondary);">
                    <div class="step-icon">
                        ${icon}
                    </div>
                    <div class="step-info">
                        <span class="step-instruction">${step.instruction} <span class="step-duration-inline">(${step.duration})</span></span>
                        
                        ${hasSubSteps ? `
                        <details class="intermediate-stops">
                            <summary>
                                <span>Voir les étapes</span>
                                <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                            </summary>
                            <ul class="intermediate-stops-list walk-steps">
                                ${filteredSubSteps.map(subStep => `
                                    <li>
                                        ${getManeuverIcon(subStep.maneuver)}
                                        <div class="walk-step-info">
                                            <span>${subStep.instruction}</span>
                                            <span class="walk-step-meta">${subStep.distance} (${subStep.duration})</span>
                                        </div>
                                    </li>
                                `).join('')}
                            </ul>
                        </details>
                        ` : `<span class="step-sub-instruction">${step.instruction}</span>`}
                    </div>
                </div>
            `;
        } else if (isWaitStep(step)) {
            return '';
        } else if (shouldSuppressBusStep(step)) {
            return '';
        } else { // BUS
            const hasIntermediateStops = step.intermediateStops && step.intermediateStops.length > 0;
            const intermediateStopCount = hasIntermediateStops ? step.intermediateStops.length : (step.numStops > 1 ? step.numStops - 1 : 0);
            
            let stopCountLabel = 'Direct';
            if (intermediateStopCount > 1) {
                stopCountLabel = `${intermediateStopCount} arrêts`;
            } else if (intermediateStopCount === 1) {
                stopCountLabel = `1 arrêt`;
            }

            const lineColor = step.routeColor || 'var(--border)';
            const badgeLabel = getSafeRouteBadgeLabel(step.routeShortName);
            const badgeBg = step.routeColor || 'var(--primary)';
            const badgeText = step.routeTextColor || '#ffffff';
            const departureStopLabel = getSafeStopLabel(step.departureStop);
            const arrivalStopLabel = getSafeStopLabel(step.arrivalStop);
            const departureTimeLabel = getSafeTimeLabel(step.departureTime);
            const arrivalTimeLabel = getSafeTimeLabel(step.arrivalTime);
            
            return `
                <div class="step-detail bus" style="--line-color: ${lineColor};">
                    <div class="step-icon">
                        <div class="route-line-badge" style="background-color: ${badgeBg}; color: ${badgeText};">${badgeLabel}</div>
                    </div>
                    <div class="step-info">
                        <span class="step-instruction">${step.instruction} <span class="step-duration-inline">(${step.duration})</span></span>
                        
                        <div class="step-stop-point">
                            <span class="step-time">Montée à <strong>${departureStopLabel}</strong></span>
                            <span class="step-time-detail">(${departureTimeLabel})</span>
                        </div>
                        
                        ${(intermediateStopCount > 0) ? `
                        <details class="intermediate-stops">
                            <summary>
                                <span>${stopCountLabel}</span>
                                <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                            </summary>
                            ${hasIntermediateStops ? `
                            <ul class="intermediate-stops-list" style="--line-color: ${lineColor};">
                                ${step.intermediateStops.map(stop => {
                                    const name = typeof stop === 'string' ? stop : (stop?.name || stop?.stop_name || 'Arrêt');
                                    return `<li>${name}</li>`;
                                }).join('')}
                            </ul>
                            ` : `<ul class="intermediate-stops-list" style="--line-color: ${lineColor};"><li>(La liste détaillée des arrêts n'est pas disponible)</li></ul>`}
                        </details>
                        ` : ''}
                        
                        <div class="step-stop-point">
                            <span class="step-time">Descente à <strong>${arrivalStopLabel}</strong></span>
                            <span class="step-time-detail">(${arrivalTimeLabel})</span>
                        </div>
                    </div>
                </div>
            `;
        }
    }).join('');
    
    return stepsHtml;
}


/**
 * *** MODIFIÉ V48 (Zoom Mobile) ***
 * Remplit l'écran 2 (Détail Mobile)
 * NE FAIT PLUS le fitBounds, mais RETOURNE la couche
 */
function renderItineraryDetail(itinerary) {
    if (!detailPanelContent || !detailMapRenderer) return;

    console.log('renderItineraryDetail: start', {
        itineraryId: itinerary.tripId || itinerary.trip?.trip_id || itinerary.id || null,
        stepCount: itinerary.steps?.length || 0
    });

    let stepsHtml = '';

    // ✅ V45: Logique de marche (et vélo) restaurée avec <details>
    stepsHtml = itinerary.steps.map((step, index) => {
        const lineColor = (step.type === 'BUS') ? (step.routeColor || 'var(--border)') : 'var(--text-secondary)';
        
        if (step.type === 'WALK' || step.type === 'BIKE') {
            const hasSubSteps = step.subSteps && step.subSteps.length > 0;
            const icon = (step.type === 'BIKE') ? ICONS.BICYCLE : ICONS.WALK;
            const stepClass = (step.type === 'BIKE') ? 'bicycle' : 'walk';

            // ✅ V46: Filtrer les étapes "STRAIGHT" trop courtes
            const filteredSubSteps = (step.subSteps || []).filter(subStep => {
                // Tente d'extraire les mètres
                const distanceMatch = subStep.distance.match(/(\d+)\s*m/);
                // Si c'est "STRAIGHT" ET que la distance est < 100m, on cache
                if (subStep.maneuver === 'STRAIGHT' && distanceMatch && parseInt(distanceMatch[1]) < 100) {
                    return false; 
                }
                return true;
            });

            return `
                <div class="step-detail ${stepClass}" style="--line-color: ${lineColor};">
                    <div class="step-icon">
                        ${icon}
                    </div>
                    <div class="step-info">
                        <span class="step-instruction">${step.instruction} <span class="step-duration-inline">(${step.duration})</span></span>
                        
                        ${hasSubSteps ? `
                        <details class="intermediate-stops">
                            <summary>
                                <span>Voir les étapes</span>
                                <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                            </summary>
                            <ul class="intermediate-stops-list walk-steps">
                                ${filteredSubSteps.map(subStep => `
                                    <li>
                                        ${getManeuverIcon(subStep.maneuver)}
                                        <div class="walk-step-info">
                                            <span>${subStep.instruction}</span>
                                            <span class="walk-step-meta">${subStep.distance} ${subStep.duration ? `(${subStep.duration})` : ''}</span>
                                        </div>
                                    </li>
                                `).join('')}
                            </ul>
                        </details>
                        ` : `<span class="step-sub-instruction">${step.instruction}</span>`}
                    </div>
                </div>
            `;
        } else if (isWaitStep(step)) {
            return '';
        } else if (shouldSuppressBusStep(step)) {
            return '';
        } else { // BUS
            const hasIntermediateStops = step.intermediateStops && step.intermediateStops.length > 0;
            const intermediateStopCount = hasIntermediateStops ? step.intermediateStops.length : (step.numStops > 1 ? step.numStops - 1 : 0);
            
            let stopCountLabel = 'Direct';
            if (intermediateStopCount > 1) {
                stopCountLabel = `${intermediateStopCount} arrêts`;
            } else if (intermediateStopCount === 1) {
                stopCountLabel = `1 arrêt`;
            }

            const badgeLabel = getSafeRouteBadgeLabel(step.routeShortName);
            const badgeBg = step.routeColor || 'var(--primary)';
            const badgeText = step.routeTextColor || '#ffffff';
            const departureStopLabel = getSafeStopLabel(step.departureStop);
            const arrivalStopLabel = getSafeStopLabel(step.arrivalStop);
            const departureTimeLabel = getSafeTimeLabel(step.departureTime);
            const arrivalTimeLabel = getSafeTimeLabel(step.arrivalTime);

            return `
                <div class="step-detail bus" style="--line-color: ${lineColor};">
                    <div class="step-icon">
                        <div class="route-line-badge" style="background-color: ${badgeBg}; color: ${badgeText};">${badgeLabel}</div>
                    </div>
                    <div class="step-info">
                        <span class="step-instruction">${step.instruction} <span class="step-duration-inline">(${step.duration})</span></span>
                        
                        <div class="step-stop-point">
                            <span class="step-time">Montée à <strong>${departureStopLabel}</strong></span>
                            <span class="step-time-detail">(${departureTimeLabel})</span>
                        </div>
                        
                        ${(intermediateStopCount > 0) ? `
                        <details class="intermediate-stops">
                            <summary>
                                <span>${stopCountLabel}</span>
                                <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                            </summary>
                            ${hasIntermediateStops ? `
                            <ul class="intermediate-stops-list" style="--line-color: ${lineColor};">
                                ${step.intermediateStops.map(stop => {
                                    const name = typeof stop === 'string' ? stop : (stop?.name || stop?.stop_name || 'Arrêt');
                                    return `<li>${name}</li>`;
                                }).join('')}
                            </ul>
                            ` : `<ul class="intermediate-stops-list" style="--line-color: ${lineColor};"><li>(La liste détaillée des arrêts n'est pas disponible)</li></ul>`}
                        </details>
                        ` : ''}
                        
                        <div class="step-stop-point">
                            <span class="step-time">Descente à <strong>${arrivalStopLabel}</strong></span>
                            <span class="step-time-detail">(${arrivalTimeLabel})</span>
                        </div>
                    </div>
                </div>
            `;
        }
    }).join('');

    // Ajouter le bouton GO à la fin du contenu (uniquement pour les trajets bus)
    const hasBusStep = itinerary.steps?.some(step => step.type === 'BUS');
    const goButtonHtml = hasBusStep ? `
        <div class="go-contribution-section">
            <div class="go-contribution-divider"></div>
            <div class="go-contribution-content">
                <div class="go-contribution-icon">🚌</div>
                <div class="go-contribution-text">
                    <strong>Vous êtes dans ce bus ?</strong>
                    <span>Aidez les autres usagers en partageant votre position en temps réel</span>
                </div>
                <button class="go-contribution-button" id="go-start-sharing-btn">
                    <span class="go-btn-icon">GO</span>
                    <span>Partager</span>
                </button>
            </div>
        </div>
    ` : '';

    detailPanelContent.innerHTML = stepsHtml + goButtonHtml;
    resetDetailPanelScroll();

    // Ajouter l'event listener pour le bouton GO
    const goBtn = document.getElementById('go-start-sharing-btn');
    if (goBtn && typeof CrowdsourcingManager !== 'undefined') {
        goBtn.addEventListener('click', () => {
            CrowdsourcingManager.startSharingFromItinerary(itinerary);
        });
    }

    // 2. Mettre à jour le résumé
    if(detailMapSummary) {
        // ✅ CORRECTION: Affiche les temps calculés pour Vélo/Marche
        const timeHtml = (itinerary.departureTime === '~')
            ? `<span class="route-time" style="color: var(--text-secondary); font-weight: 500;">(Trajet)</span>`
            : `<span class="route-time">${itinerary.departureTime} &gt; ${itinerary.arrivalTime}</span>`;

        detailMapSummary.innerHTML = `
            ${timeHtml}
            <span class="route-duration">${itinerary.duration}</span>
        `;
    }

    // 3. Dessiner le tracé sur la carte
    if (detailMapRenderer.map && itinerary.steps) { // V44: Basé sur les étapes
        if (currentDetailRouteLayer) {
            detailMapRenderer.map.removeLayer(currentDetailRouteLayer);
            currentDetailRouteLayer = null;
        }
        // ✅ V46: Vider les anciens marqueurs
        if (currentDetailMarkerLayer) {
            currentDetailMarkerLayer.clearLayers();
        }
        
        const stepLayers = [];

        itinerary.steps.forEach(step => {
            const style = getLeafletStyleForStep(step);

            const polylinesToDraw = extractStepPolylines(step);

            if (!polylinesToDraw.length) {
                if (!isWaitStep(step)) {
                    console.warn('renderItineraryDetail: étape sans polylines', { stepType: step.type, step });
                }
                return;
            }
            
            polylinesToDraw.forEach(polyline => {
                const latLngs = getPolylineLatLngs(polyline);
                if (!latLngs || !latLngs.length) {
                    console.warn('renderItineraryDetail: étape sans coordonnées', { stepType: step.type, step });
                    return;
                }

                const geoJson = {
                    type: 'LineString',
                    coordinates: latLngs.map(([lat, lng]) => [lng, lat])
                };

                console.log('renderItineraryDetail: couche ajoutée', {
                    stepType: step.type,
                    pointCount: latLngs.length
                });
                const stepLayer = L.geoJSON(geoJson, {
                    style: style // Utiliser le style dynamique de l'étape
                });
                stepLayers.push(stepLayer);
            });
        });

        if (stepLayers.length > 0) {
            // Créer un groupe avec toutes les couches d'étapes
            currentDetailRouteLayer = L.featureGroup(stepLayers).addTo(detailMapRenderer.map);
            
            // ✅ V46: Ajouter les marqueurs
            addItineraryMarkers(itinerary, detailMapRenderer.map, currentDetailMarkerLayer);

            // ✅ V48 (MODIFICATION IMPLÉMENTÉE): La ligne fitBounds est SUPPRIMÉE d'ici
        } else {
            console.warn('renderItineraryDetail: aucune couche tracée (liste vide)', {
                itineraryId: itinerary.tripId || itinerary.trip?.trip_id || itinerary.id || null
            });
        }
    }
    
    // ✅ V48 (MODIFICATION IMPLÉMENTÉE): 
    // On retourne la couche qui vient d'être créée
    return currentDetailRouteLayer;
}

// === Fonctions de formatage maintenant importées depuis utils/formatters.js ===
// formatGoogleTime, formatGoogleDuration, parseGoogleDuration
// isMeaningfulTime, parseTimeStringToMinutes, formatMinutesToTimeString
// addSecondsToTimeString, subtractSecondsFromTimeString


// --- Fonctions de l'application (logique métier GTFS) ---

function renderInfoTraficCard() {
    if (!dataManager || !infoTraficList) return;
    infoTraficList.innerHTML = '';
    let alertCount = 0;
    
    const groupedRoutes = {
        'majeures': { name: 'Lignes majeures', routes: [] },
        'express': { name: 'Lignes express', routes: [] },
        'quartier': { name: 'Lignes de quartier', routes: [] },
        'navettes': { name: 'Navettes', routes: [] }
    };
    const allowedCategories = ['majeures', 'express', 'quartier', 'navettes'];

    dataManager.routes.forEach(route => {
        const category = getCategoryForRoute(route.route_short_name);
        if (allowedCategories.includes(category)) {
            groupedRoutes[category].routes.push(route);
        }
    });

    for (const [categoryId, categoryData] of Object.entries(groupedRoutes)) {
        if (categoryData.routes.length === 0) continue;

        const groupDiv = document.createElement('div');
        groupDiv.className = 'trafic-group';
        
        let badgesHtml = '';
        categoryData.routes.sort((a, b) => { 
             return a.route_short_name.localeCompare(b.route_short_name, undefined, {numeric: true});
        });

        categoryData.routes.forEach(route => {
            const state = lineStatuses[route.route_id] || { status: 'normal', message: '' };
            const routeColor = route.route_color ? `#${route.route_color}` : '#3388ff';
            const textColor = route.route_text_color ? `#${route.route_text_color}` : '#ffffff';
            let statusIcon = '';
            let statusColor = 'transparent'; 
            if (state.status !== 'normal') {
                alertCount++;
                if (state.status === 'annulation') statusColor = 'var(--color-red)';
                else if (state.status === 'retard') statusColor = 'var(--color-yellow)';
                else statusColor = 'var(--color-orange)';
                statusIcon = `<div class="status-indicator-triangle type-${state.status}" style="border-bottom-color: ${statusColor};"></div>`;
            }
            badgesHtml += `
                <div class="trafic-badge-item status-${state.status}">
                    <span class="line-badge" style="background-color: ${routeColor}; color: ${textColor};">
                        ${route.route_short_name}
                    </span>
                    ${statusIcon}
                </div>
            `;
        });

        groupDiv.innerHTML = `
            <h4>${categoryData.name}</h4>
            <div class="trafic-badge-list">
                ${badgesHtml}
            </div>
        `;
        infoTraficList.appendChild(groupDiv);
    }
    if (infoTraficCount) {
        infoTraficCount.textContent = alertCount;
        infoTraficCount.classList.toggle('hidden', alertCount === 0);
    }
}

function buildFicheHoraireList() {
    if (!dataManager || !ficheHoraireContainer) return;
    ficheHoraireContainer.innerHTML = '';

    const groupedRoutes = {
        'Lignes A, B, C et D': [],
        'Lignes e': [],
        'Lignes K': [],
        'Lignes N': [],
        'Lignes R': [],
    };

    dataManager.routes.forEach(route => {
        const name = route.route_short_name;
        if (['A', 'B', 'C', 'D'].includes(name)) groupedRoutes['Lignes A, B, C et D'].push(route);
        else if (name.startsWith('e')) groupedRoutes['Lignes e'].push(route);
        else if (name.startsWith('K')) groupedRoutes['Lignes K'].push(route);
        else if (name.startsWith('N')) groupedRoutes['Lignes N'].push(route);
        else if (name.startsWith('R')) groupedRoutes['Lignes R'].push(route);
    });

    for (const [groupName, routes] of Object.entries(groupedRoutes)) {
        if (routes.length === 0) continue;
        const accordionGroup = document.createElement('div');
        accordionGroup.className = 'accordion-group';
        let linksHtml = '';
        
        if (groupName === 'Lignes R') {
            linksHtml = `
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R1_R2_R3_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R1, R2, R3 La Feuilleraie <> ESAT / Les Gourdoux <> Trélissac Les Garennes / Les Pinots <> P+R Aquacap</a>
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R4_R5_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R4, R5 Route de Payenché <> Collège Jean Moulin / Les Mondines / Clément Laval <> Collège Jean Moulin</a>
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R6_R7_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R6, R7 Maison des Compagnons <> Gour de l’Arche poste / Le Charpe <> Gour de l’Arche poste</a>
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R8_R9_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R8, R9 Jaunour <> Boulazac centre commercial / Stèle de Lesparat <> Place du 8 mai</a>
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R10_R11_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R10, R11 Notre Dame de Sanilhac poste <> Centre de la communication / Héliodore <> Place du 8 mai</a>
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R12_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Ligne R12 Le Change <> Boulazac centre commercial</a>
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R13_R14_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R13, R14 Coursac <> Razac sur l’Isle / La Chapelle Gonaguet <>Razac sur l’Isle</a>
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R15_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Ligne R15 Boulazac Isle Manoire <> Halte ferroviaire Niversac</a>
            `;
        } else {
            routes.sort((a, b) => a.route_short_name.localeCompare(b.route_short_name, undefined, {numeric: true}));
            routes.forEach(route => {
                let pdfName = PDF_FILENAME_MAP[route.route_short_name];
                let pdfPath = pdfName ? `/data/fichehoraire/${pdfName}` : '#';
                if (!pdfName) console.warn(`PDF non mappé pour ${route.route_short_name}.`);
                const longName = ROUTE_LONG_NAME_MAP[route.route_short_name] || (route.route_long_name ? route.route_long_name.replace(/<->/g, '<=>') : '');
                const displayName = `Ligne ${route.route_short_name} ${longName}`.trim();
                linksHtml += `<a href="${pdfPath}" target="_blank" rel="noopener noreferrer">${displayName}</a>`;
            });
        }

        if (linksHtml) {
            accordionGroup.innerHTML = `
                <details>
                    <summary>${groupName}</summary>
                    <div class="accordion-content">
                        <div class="accordion-content-inner">
                            ${linksHtml}
                        </div>
                    </div>
                </details>
            `;
            ficheHoraireContainer.appendChild(accordionGroup);
        }
    }
    
    const allDetails = document.querySelectorAll('#fiche-horaire-container details');
    allDetails.forEach(details => {
        details.addEventListener('toggle', (event) => {
            if (event.target.open) {
                allDetails.forEach(d => {
                    if (d !== event.target && d.open) {
                        d.open = false;
                    }
                });
            }
        });
    });
}

function renderAlertBanner() {
    let alerts = [];
    let firstAlertStatus = 'normal';
    
    if (Object.keys(lineStatuses).length === 0) {
        alertBanner.classList.add('hidden');
        return;
    }
    
    for (const route_id in lineStatuses) {
        const state = lineStatuses[route_id];
        if (state.status !== 'normal') {
            const route = dataManager.getRoute(route_id);
            if (route) { 
                alerts.push({
                    name: route.route_short_name,
                    status: state.status,
                    message: state.message
                });
            }
        }
    }

    if (alerts.length === 0) {
        alertBanner.classList.add('hidden');
        return;
    }

    if (alerts.some(a => a.status === 'annulation')) firstAlertStatus = 'annulation';
    else if (alerts.some(a => a.status === 'perturbation')) firstAlertStatus = 'perturbation';
    else firstAlertStatus = 'retard';
    
    alertBanner.className = `type-${firstAlertStatus}`;
    const alertIcon = getAlertBannerIcon(firstAlertStatus);
    const alertText = alerts.map(a => `<strong>Ligne ${a.name}</strong>`).join(', ');
    alertBannerContent.innerHTML = `${alertIcon} <strong>Infos Trafic:</strong> ${alertText}`;
    alertBanner.classList.remove('hidden');
}


/**
 * Logique de changement de VUE
 */
function showMapView() {
    dashboardContainer.classList.add('hidden');
    itineraryResultsContainer.classList.add('hidden');
    resetDetailViewState();
    mapContainer.classList.remove('hidden');
    document.body.classList.add('view-is-locked'); 
    if (mapRenderer && mapRenderer.map) {
        mapRenderer.map.invalidateSize();
    }
}

function showDashboardHall() {
    dashboardContainer.classList.remove('hidden');
    itineraryResultsContainer.classList.add('hidden');
    resetDetailViewState();
    mapContainer.classList.add('hidden');
    document.body.classList.remove('view-is-locked'); 
    
    if (dataManager) { 
        renderAlertBanner(); 
    }
    dashboardContentView.classList.remove('view-is-active');
    dashboardHall.classList.add('view-is-active');
    document.querySelectorAll('#dashboard-content-view .card').forEach(card => {
        card.classList.remove('view-active');
    });
}

function showResultsView() {
    dashboardContainer.classList.add('hidden');
    itineraryResultsContainer.classList.remove('hidden');
    resetDetailViewState();
    mapContainer.classList.add('hidden');
    document.body.classList.add('view-is-locked'); // Verrouille le scroll

    if (resultsListContainer) {
        resultsListContainer.innerHTML = '<p class="results-message">Recherche d\'itinéraire en cours...</p>';
    }
    
    // *** NOUVEAU V35: Invalide la carte PC ***
    if (resultsMapRenderer && resultsMapRenderer.map) {
        setTimeout(() => {
             resultsMapRenderer.map.invalidateSize();
        }, 10);
    }
}

/**
 * *** MODIFIÉ V48 (Zoom Mobile) ***
 * Accepte la couche du trajet et gère le zoom au bon moment.
 */
function showDetailView(routeLayer) { // ✅ V48: Accepte routeLayer en argument
    if (!itineraryDetailContainer) return;
    
    // Bloquer le scroll du body
    document.body.classList.add('detail-view-open');
    
    initBottomSheetControls();
    cancelBottomSheetDrag();
    currentBottomSheetLevelIndex = BOTTOM_SHEET_DEFAULT_INDEX;
    prepareBottomSheetForViewport(true);
    itineraryDetailContainer.classList.remove('hidden');
    itineraryDetailContainer.classList.remove('is-scrolled');
    resetDetailPanelScroll();
    if (itineraryDetailBackdrop) {
        itineraryDetailBackdrop.classList.remove('hidden');
        requestAnimationFrame(() => itineraryDetailBackdrop.classList.add('is-active'));
    }

    // Invalide la carte des détails MAINTENANT
    if (detailMapRenderer && detailMapRenderer.map) {
        detailMapRenderer.map.invalidateSize();
    }

    // Force l'animation
    setTimeout(() => {
        itineraryDetailContainer.classList.add('is-active');
        
        // ✅ V48 (MODIFICATION IMPLÉMENTÉE):
        // Zoome sur le trajet APRÈS que la carte soit visible et ait une taille
        if (routeLayer && detailMapRenderer.map) {
            try {
                const bounds = routeLayer.getBounds();
                if (bounds.isValid()) {
                    // Ce zoom se produit maintenant au bon moment
                    detailMapRenderer.map.fitBounds(bounds, { padding: [20, 20] });
                }
            } catch (e) {
                console.error("Erreur lors du fitBounds sur la carte détail:", e);
            }
        }
        
    }, 10); // 10ms (Juste pour démarrer l'animation CSS)
}


// *** NOUVELLE FONCTION V33 ***
function hideDetailView() {
    if (!itineraryDetailContainer) return;
    
    // 1. D'abord, lancer l'animation de fermeture du backdrop
    if (itineraryDetailBackdrop) {
        itineraryDetailBackdrop.classList.remove('is-active');
    }
    
    // 2. Retirer is-active pour déclencher l'animation de fermeture du bottom sheet
    itineraryDetailContainer.classList.remove('is-active');
    itineraryDetailContainer.classList.remove('is-scrolled');
    
    // 3. Annuler tout drag en cours
    cancelBottomSheetDrag();
    
    // 4. Attendre la fin de la transition CSS AVANT de cacher et reset
    setTimeout(() => {
        resetDetailViewState();
    }, DETAIL_SHEET_TRANSITION_MS);
}

function resetDetailViewState() {
    if (!itineraryDetailContainer) return;
    
    // Débloquer le scroll du body
    document.body.classList.remove('detail-view-open');
    
    itineraryDetailContainer.classList.add('hidden');
    itineraryDetailContainer.classList.remove('is-active');
    itineraryDetailContainer.classList.remove('is-scrolled');
    if (detailBottomSheet) {
        detailBottomSheet?.classList.remove('is-dragging');
        itineraryDetailContainer?.classList.remove('sheet-is-dragging');
        detailBottomSheet.classList.remove('sheet-height-no-transition');
        detailBottomSheet.style.removeProperty('--sheet-height');
    }
    resetDetailPanelScroll();
    if (detailPanelContent) {
        detailPanelContent.innerHTML = '';
    }
    if (currentDetailRouteLayer && detailMapRenderer?.map) {
        detailMapRenderer.map.removeLayer(currentDetailRouteLayer);
        currentDetailRouteLayer = null;
    }
    if (currentDetailMarkerLayer) {
        currentDetailMarkerLayer.clearLayers();
    }
    if (itineraryDetailBackdrop) {
        itineraryDetailBackdrop.classList.remove('is-active');
        itineraryDetailBackdrop.classList.add('hidden');
    }
}

function resetDetailPanelScroll() {
    if (!detailPanelWrapper) return;
    detailPanelWrapper.scrollTop = 0;
    detailPanelWrapper.scrollLeft = 0;
    requestAnimationFrame(() => {
        if (!detailPanelWrapper) return;
        if (detailPanelWrapper.scrollTop !== 0) {
            detailPanelWrapper.scrollTop = 0;
        }
        if (detailPanelWrapper.scrollLeft !== 0) {
            detailPanelWrapper.scrollLeft = 0;
        }
    });
}


function showDashboardView(viewName) {
    dashboardHall.classList.remove('view-is-active');
    dashboardContentView.classList.add('view-is-active');

    // V27/V28 : On scrolle le body, pas le dashboard-main
    window.scrollTo({ top: 0, behavior: 'auto' });
    // Correctif: garantir que la classe 'view-is-locked' (utilisée pour les vues plein écran)
    // est retirée quand on affiche une sous-vue interne (horaires, info-trafic) afin
    // de préserver l'en-tête et le scroll.
    document.body.classList.remove('view-is-locked');
    try { if (typeof renderAlertBanner === 'function' && dataManager) renderAlertBanner(); } catch(e) { /* non bloquant */ }

    document.querySelectorAll('#dashboard-content-view .card').forEach(card => {
        card.classList.remove('view-active');
    });

    const activeCard = document.getElementById(viewName);
    if (activeCard) {
        setTimeout(() => {
            activeCard.classList.add('view-active');
        }, 50);
    }
}


// --- Fonctions de l'application (logique métier GTFS) ---

function checkAndSetupTimeMode() {
    timeManager.setMode('real');
    timeManager.play();
    console.log('⏰ Mode TEMPS RÉEL activé.');
}

function initializeRouteFilter() {
    const routeCheckboxesContainer = document.getElementById('route-checkboxes');
    if (!routeCheckboxesContainer || !dataManager) return;

    routeCheckboxesContainer.innerHTML = '';
    visibleRoutes.clear();
    const routesByCategory = {};
    Object.keys(LINE_CATEGORIES).forEach(cat => { routesByCategory[cat] = []; });
    routesByCategory['autres'] = [];
    
    dataManager.routes.forEach(route => {
        visibleRoutes.add(route.route_id);
        const category = getCategoryForRoute(route.route_short_name);
        routesByCategory[category].push(route);
    });
    Object.values(routesByCategory).forEach(routes => {
        routes.sort((a, b) => a.route_short_name.localeCompare(b.route_short_name, undefined, {numeric: true}));
    });

    Object.entries(LINE_CATEGORIES).forEach(([categoryId, categoryInfo]) => {
        const routes = routesByCategory[categoryId];
        
        // ✅ V57.1 (CORRECTION BUG) : 'continue' remplacé par 'return'
        if (routes.length === 0) return; 

        const categoryHeader = document.createElement('div');
        categoryHeader.className = 'category-header';
        categoryHeader.innerHTML = `
            <div class="category-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="${categoryInfo.color}"><circle cx="12" cy="12" r="10"/></svg>
                <strong>${categoryInfo.name}</strong>
                <span class="category-count">(${routes.length})</span>
            </div>
            <div class="category-actions">
                <button class="btn-category-action" data-category="${categoryId}" data-action="select">Tous</button>
                <button class="btn-category-action" data-category="${categoryId}" data-action="deselect">Aucun</button>
            </div>`;
        routeCheckboxesContainer.appendChild(categoryHeader);
        
        const categoryContainer = document.createElement('div');
        categoryContainer.className = 'category-routes';
        categoryContainer.id = `category-${categoryId}`;
        routes.forEach(route => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'route-checkbox-item';
            
            // *** CORRECTION V30 (BUG ##) ***
            // Le '#' est retiré des variables. Il est appliqué
            // directement et uniquement dans la chaîne innerHTML.
            const routeColor = route.route_color ? route.route_color : '3388ff';
            const textColor = route.route_text_color ? route.route_text_color : 'ffffff';
            
            itemDiv.innerHTML = `
                <input type="checkbox" id="route-${route.route_id}" data-category="${categoryId}" checked>
                <div class="route-badge" style="background-color: #${routeColor}; color: #${textColor};">
                    ${route.route_short_name || route.route_id}
                </div>
                <span class="route-name">${route.route_long_name || route.route_short_name || route.route_id}</span>
            `;
            
            itemDiv.querySelector('input[type="checkbox"]').addEventListener('change', handleRouteFilterChange);
            itemDiv.addEventListener('mouseenter', () => mapRenderer.highlightRoute(route.route_id, true));
            itemDiv.addEventListener('mouseleave', () => mapRenderer.highlightRoute(route.route_id, false));
            itemDiv.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                mapRenderer.zoomToRoute(route.route_id);
            });
            categoryContainer.appendChild(itemDiv);
        });
        routeCheckboxesContainer.appendChild(categoryContainer);
    });

    document.querySelectorAll('.btn-category-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const category = e.target.dataset.category;
            const action = e.target.dataset.action;
            handleCategoryAction(category, action);
        });
    });
}

function handleCategoryAction(category, action) {
    const checkboxes = document.querySelectorAll(`input[data-category="${category}"]`);
    checkboxes.forEach(checkbox => { checkbox.checked = (action === 'select'); });
    handleRouteFilterChange();
}

function handleRouteFilterChange() {
    if (!dataManager) return;
    visibleRoutes.clear();
    dataManager.routes.forEach(route => {
        const checkbox = document.getElementById(`route-${route.route_id}`);
        if (checkbox && checkbox.checked) { visibleRoutes.add(route.route_id); }
    });
    if (dataManager.geoJson) {
        mapRenderer.displayMultiColorRoutes(dataManager.geoJson, dataManager, visibleRoutes);
    }
    updateData();
}

function handleSearchInput(e) {
    const query = e.target.value.toLowerCase();
    if (query.length < 2) {
        searchResultsContainer.classList.add('hidden');
        searchResultsContainer.innerHTML = '';
        return;
    }
    if (!dataManager) return;
    const matches = dataManager.masterStops
        .filter(stop => stop.stop_name.toLowerCase().includes(query))
        .slice(0, 10); 
    displaySearchResults(matches, query);
}

function displaySearchResults(stops, query) {
    searchResultsContainer.innerHTML = '';
    if (stops.length === 0) {
        searchResultsContainer.innerHTML = `<div class="search-result-item">Aucun arrêt trouvé.</div>`;
        searchResultsContainer.classList.remove('hidden');
        return;
    }
    stops.forEach(stop => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        const regex = new RegExp(`(${query})`, 'gi');
        item.innerHTML = stop.stop_name.replace(regex, '<strong>$1</strong>');
        item.addEventListener('click', () => onSearchResultClick(stop));
        searchResultsContainer.appendChild(item);
    });
    searchResultsContainer.classList.remove('hidden');
}

function onSearchResultClick(stop) {
    showMapView(); 
    if (mapRenderer) {
        mapRenderer.zoomToStop(stop);
        mapRenderer.onStopClick(stop);
    }
    searchBar.value = stop.stop_name;
    searchResultsContainer.classList.add('hidden');
}

/**
 * Fonction de mise à jour principale (pour la carte temps réel)
 */
function updateData() {
    if (!timeManager || !tripScheduler || !busPositionCalculator || !mapRenderer) {
        return;
    }

    const currentSeconds = timeManager.getCurrentSeconds();
    const currentDate = timeManager.getCurrentDate(); 
    
    updateClock(currentSeconds);
    
    const activeBuses = tripScheduler.getActiveTrips(currentSeconds, currentDate);
    const allBusesWithPositions = busPositionCalculator.calculateAllPositions(activeBuses);

    allBusesWithPositions.forEach(bus => {
        if (bus && bus.route) {
            const routeId = bus.route.route_id;
            bus.currentStatus = (lineStatuses[routeId] && lineStatuses[routeId].status) 
                                ? lineStatuses[routeId].status 
                                : 'normal';
        }
    });
    
    const visibleBuses = allBusesWithPositions
        .filter(bus => bus !== null)
        .filter(bus => bus.route && visibleRoutes.has(bus.route.route_id)); 
    
    mapRenderer.updateBusMarkers(visibleBuses, tripScheduler, currentSeconds);
    updateBusCount(visibleBuses.length, visibleBuses.length);
}

function updateClock(seconds) {
    const hours = Math.floor(seconds / 3600) % 24;
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    const currentTimeEl = document.getElementById('current-time');
    if (currentTimeEl) currentTimeEl.textContent = timeString;
    
    const now = new Date();
    const dateString = now.toLocaleDateString('fr-FR', { 
        weekday: 'short', 
        day: 'numeric', 
        month: 'short' 
    });
    const dateIndicatorEl = document.getElementById('date-indicator');
    if (dateIndicatorEl) dateIndicatorEl.textContent = dateString;
}

function updateBusCount(visible, total) {
    const busCountElement = document.getElementById('bus-count');
    if (busCountElement) {
        busCountElement.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10"/>
            </svg>
            ${visible} bus
        `;
    }
}

function updateDataStatus(message, status = '') {
    const statusElement = document.getElementById('data-status');
    if (statusElement) {
        statusElement.className = status;
        statusElement.textContent = message;
    }
}

export async function bootstrapApp() {
    await initializeApp();
}

// =====================
// DEBUG EXPORTS (harness)
// =====================
// Expose pure / side-effect-light helpers for local testing in debug.html
if (typeof window !== 'undefined') {
    window.__DEBUG = Object.assign({}, window.__DEBUG || {}, {
        // Imported pure functions from ranking.js
        rankArrivalItineraries,
        rankDepartureItineraries,
        deduplicateItineraries,
        filterExpiredDepartures,
        filterLateArrivals,
        // Local helpers (remain internal but exposed for inspection)
        processIntelligentResults,
        ensureItineraryPolylines,
        computeTimeDifferenceMinutes,
        getWaitStepPresentation,
        // State inspectors
        getAllFetched: () => allFetchedItineraries,
        getArrivalState: () => ({ lastSearchMode, arrivalRankedAll, arrivalRenderedCount, ARRIVAL_PAGE_SIZE }),
        // Manual trigger (simulate minimal search rendering without network)
        _debugRender: (mode='ALL') => resultsRenderer && resultsRenderer.render(mode)
    });
}