/**
 * main.js - V221 (Refactorisation + nettoyage code mort)
 *
 * Version refactorisée avec modules séparés pour:
 * - Dessin de routes (map/routeDrawing.js)
 * - Traitement itinéraires (search/itineraryProcessor.js)
 * - Formatage (utils/formatters.js)
 * - Configuration (config/icons.js, config/routes.js)
 * - UI (ui/resultsRenderer.js, ui/trafficInfo.js)
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

// === Imports des modules extraits (V221) ===
import { 
    isWaitStep,
    getEncodedPolylineValue,
    getPolylineLatLngs,
    extractStepPolylines,
    STOP_ROLE_PRIORITY as IMPORTED_STOP_ROLE_PRIORITY
} from './map/routeDrawing.js';

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
    computeTimeDifferenceMinutes
} from './utils/formatters.js';

import { getCategoryForRoute, LINE_CATEGORIES, PDF_FILENAME_MAP, ROUTE_LONG_NAME_MAP } from './config/routes.js';
import { ICONS, getManeuverIcon, getAlertBannerIcon } from './config/icons.js';
import { updateNewsBanner, renderInfoTraficCard as renderInfoTraficCardFromModule } from './ui/trafficInfo.js';

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

// ⚠️ ARCHITECTURE SERVEUR-CENTRALISÉE
// Le client ne fait PLUS de routing local - tout passe par l'API serveur/OTP
// Le fallback GTFS local est DÉSACTIVÉ pour garantir des données cohérentes
const ENABLE_GTFS_ROUTER = false; // ❌ DÉSACTIVÉ - Le serveur gère tout le routing

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
let ARRIVAL_PAGE_SIZE = 6; // V120: Augmenté à 6 pour afficher plus d'options

// V60: État pour charger plus de départs
let lastSearchTime = null; // Dernier searchTime utilisé
let loadMoreOffset = 0; // Décalage en minutes pour charger plus

let geolocationManager = null;

const BOTTOM_SHEET_LEVELS = [0.4, 0.8]; // Seulement 2 niveaux: peek (40%) et expanded (80%)
import { getAppConfig } from './config.js';
import { deduplicateItineraries, rankArrivalItineraries, rankDepartureItineraries, filterExpiredDepartures, filterLateArrivals, limitBikeWalkItineraries, countBusItineraries, getMinBusItineraries } from './itinerary/ranking.js';
import { normalizeStopNameForLookup, resolveStopCoordinates } from './utils/geo.js';
import { createResultsRenderer } from './ui/resultsRenderer.js';
const BOTTOM_SHEET_DEFAULT_INDEX = 0;
const BOTTOM_SHEET_DRAG_ZONE_PX = 110;
const APP_CONFIG = getAppConfig();
// GOOGLE_API_KEY removed - using OTP backend only
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

// V221: STOP_ROLE_PRIORITY importé depuis map/routeDrawing.js
const STOP_ROLE_PRIORITY = IMPORTED_STOP_ROLE_PRIORITY;

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

        // V117: Mettre à jour la carte avec l'itinéraire sélectionné
        if (resultsMapRenderer && resultsMapRenderer.map) {
            resultsMapRenderer.map.invalidateSize();
            setTimeout(() => drawRouteOnResultsMap(itinerary), 50);
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

function wireThemeToggles() {
    const themeToggles = Array.from(document.querySelectorAll('[data-theme-toggle]'));
    themeToggles.forEach(btn => {
        btn.addEventListener('click', () => {
            const nextIsDark = !document.body.classList.contains('dark-theme');
            applyThemeState(nextIsDark);
            try { localStorage.setItem('ui-theme', nextIsDark ? 'dark' : 'light'); } catch (e) { /* ignore */ }
        }, { passive: true });
    });
}

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

let _lastScheduleBannerKey = null;

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
        onLoadMoreArrivals: () => loadMoreArrivals(), // V132: Charger plus d'arrivées
        getDataManager: () => dataManager, // V64: Accès aux données GTFS pour prochains départs
        getSearchTime: () => lastSearchTime // V212: Expose la date/heure de recherche pour enrichissement GTFS
    });

    apiManager = new ApiManager(); // No API key needed - using local OTP backend
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

        // Exposer mapRenderer et dataManager globalement pour le système de retards
        window.mapRenderer = mapRenderer;
        window.dataManager = dataManager;
        
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

        // Wire theme toggles now that fragments sont chargés, puis applique le thème initial
        wireThemeToggles();
        initTheme();
        
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
        updateData().catch(err => console.error('updateData error:', err)); 

        try { updateSchedulePeriodBanner(true); } catch (e) { console.debug('updateSchedulePeriodBanner init failed', e); }
        
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
    // Initialiser tous les statuts à "normal" par défaut
    dataManager.routes.forEach(route => {
        lineStatuses[route.route_id] = { status: 'normal', message: '' };
    });
    
    // Charger les statuts depuis le fichier JSON de configuration
    loadLineStatuses().then(() => {
        renderInfoTraficCard();
        renderAlertBanner();
        updateNewsBanner(dataManager, lineStatuses); // V114: Mise à jour du bandeau défilant
    });
    
    buildFicheHoraireList();
}

/**
 * V82: Charge les statuts des lignes depuis /data/line-status.json
 * Ce fichier peut être modifié facilement pour mettre à jour l'état des lignes
 */
async function loadLineStatuses() {
    try {
        const response = await fetch('/data/line-status.json?t=' + Date.now()); // Cache-bust
        if (!response.ok) {
            console.warn('[LineStatus] Fichier line-status.json non trouvé, utilisation des statuts par défaut');
            return;
        }
        
        const data = await response.json();
        console.log('[LineStatus] Chargement des statuts:', data.lastUpdate);
        
        // Mapper les statuts du JSON vers lineStatuses
        if (data.lines) {
            for (const [shortName, statusInfo] of Object.entries(data.lines)) {
                // Trouver le route_id correspondant au short_name
                const route = dataManager.routes.find(r => r.route_short_name === shortName);
                if (route && statusInfo.status !== 'normal') {
                    lineStatuses[route.route_id] = {
                        status: statusInfo.status,
                        message: statusInfo.message || ''
                    };
                    console.log(`[LineStatus] Ligne ${shortName}: ${statusInfo.status} - ${statusInfo.message}`);
                }
            }
        }
        
        // Message global (pour les alertes générales)
        if (data.globalMessage) {
            console.log('[LineStatus] Message global:', data.globalMessage);
        }
        
    } catch (error) {
        console.warn('[LineStatus] Erreur chargement statuts:', error);
    }
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
    // Backend auto-hébergé activé - pas d'API Google
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

// V75: Vérifie si le dashboard est chargé et le recharge si nécessaire
async function ensureDashboardLoaded() {
    // Vérifier si les éléments clés du dashboard existent
    const dashboardExists = document.getElementById('dashboard-container');
    if (!dashboardExists) {
        console.log('[Navigation] Dashboard non chargé, rechargement...');
        await reloadDashboardFromTarifs();
        return true; // Indique qu'on a rechargé
    }
    return false;
}

// Gérer les actions de navigation
async function handleNavigationAction(action) {
    // V75: Pour les actions qui nécessitent le dashboard, s'assurer qu'il est chargé
    const needsDashboard = ['itineraire', 'horaires', 'info-trafic', 'carte'].includes(action);
    
    if (needsDashboard) {
        await ensureDashboardLoaded();
        // Réinitialiser les références DOM après rechargement potentiel
        initializeDomElements();
    }
    
    switch(action) {
        case 'itineraire':
            // Aller à la vue résultats d'itinéraire (sans recherche préalable)
            showResultsView();
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
        
        document.body.classList.remove('view-map-locked');
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

    // V204 + correctif fuseau: calculer la date du jour en local (pas en UTC)
    const nowLocal = new Date();
    const todayIso = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;
    if (!searchTime.date || searchTime.date < todayIso) {
        searchTime.date = todayIso;
        try { dateSelect.value = todayIso; } catch (e) {}
    }
    
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

        // ✅ ARCHITECTURE SERVEUR-CENTRALISÉE
        // Tout le routing passe par l'API serveur (OTP)
        // Plus de fallback local - erreurs explicites si OTP échoue
        const routingStart = performance.now();
        
        // Appel API serveur (seule source de vérité)
        let apiResult = null;
        let apiError = null;
        
        try {
            apiResult = await apiManager.fetchItinerary(fromPlaceId, toPlaceId, searchTime);
        } catch (e) {
            console.error('❌ Erreur API serveur:', e);
            apiError = e;
        }
        
        console.log(`⚡ Routage terminé en ${Math.round(performance.now() - routingStart)}ms`);

        // Traiter les résultats API OTP
        let apiItins = [];
        if (apiResult) {
            try {
                apiItins = processIntelligentResults(apiResult, searchTime) || [];
                console.log('✅ API OTP:', apiItins.length, 'itinéraire(s)');
            } catch (e) {
                console.error('processIntelligentResults error:', e);
                apiItins = [];
            }
        }

        // ❌ PLUS DE FALLBACK LOCAL
        // Si OTP échoue, on affiche une erreur claire à l'utilisateur
        if (apiItins.length === 0 && apiError) {
            const errorMessage = apiError.message || 'Erreur inconnue';
            // Afficher l'erreur dans l'interface
            showSearchError(errorMessage);
            return;
        }
        
        allFetchedItineraries = apiItins;

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

        // V137b: Forcer un ordre croissant clair (départs les plus proches → plus éloignés)
        const heureDemandee = `${searchTime.hour}:${String(searchTime.minute).padStart(2,'0')}`;
        if (searchTime.type === 'arriver') {
            console.log(`🎯 Mode ARRIVER: tri cible ${heureDemandee} (arrivée décroissante)`);
            const { rankArrivalItineraries } = await import('./itinerary/ranking.js');
            arrivalRankedAll = rankArrivalItineraries([...allFetchedItineraries], searchTime);
            arrivalRenderedCount = arrivalRankedAll.length; // Montrer tout, pas de pagination
        } else {
            console.log(`🎯 Mode PARTIR: tri chrono croissant appliqué (base ${heureDemandee})`);
            allFetchedItineraries = sortItinerariesByDeparture(allFetchedItineraries);
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
            // V117: S'assurer que la carte est bien dimensionnée avant de dessiner
            if (resultsMapRenderer && resultsMapRenderer.map) {
                setTimeout(() => {
                    resultsMapRenderer.map.invalidateSize();
                    drawRouteOnResultsMap(allFetchedItineraries[0]);
                }, 100);
            } else {
                drawRouteOnResultsMap(allFetchedItineraries[0]);
            }
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
 * V95: Cache les itinéraires existants pour éviter les doublons + ne charge que des bus
 */
async function loadMoreDepartures() {
    if (!lastSearchTime || !fromPlaceId || !toPlaceId) {
        console.warn('loadMoreDepartures: pas de recherche précédente');
        return;
    }

    // V95: Créer un cache des signatures d'itinéraires existants pour éviter les doublons
    const existingSignatures = new Set();
    const existingDepartures = new Set();
    
    allFetchedItineraries.forEach(it => {
        // Signature basée sur la structure du trajet
        const sig = createItinerarySignature(it);
        existingSignatures.add(sig);
        // Aussi garder les heures de départ exactes
        if (it.departureTime && it.departureTime !== '~') {
            existingDepartures.add(it.departureTime);
        }
    });

    // Trouver le dernier départ bus pour commencer après
    const busItineraries = allFetchedItineraries.filter(it => it.type === 'BUS' || it.type === 'TRANSIT');
    let startHour, startMinute;
    
    // V203: Calcul robuste de la nouvelle heure avec gestion de la date
    let baseDateObj;
    if (!lastSearchTime.date || lastSearchTime.date === 'today' || lastSearchTime.date === "Aujourd'hui") {
        baseDateObj = new Date();
    } else {
        baseDateObj = new Date(lastSearchTime.date);
    }
    
    // Si on a trouvé un dernier départ, on l'utilise comme base
    // V209: On ajoute seulement +1 min car l'API Google ajoute déjà des décalages internes (+15/+30/+50)
    // Avant on ajoutait +5 min, ce qui créait des sauts d'horaire (7h26 → 9h22)
    if (busItineraries.length > 0) {
        const lastDep = busItineraries[busItineraries.length - 1].departureTime;
        const match = lastDep?.match(/(\d{1,2}):(\d{2})/);
        if (match) {
            const h = parseInt(match[1], 10);
            const m = parseInt(match[2], 10);
            
            // Attention: si le dernier départ est le lendemain (ex: 00:15 alors qu'on cherchait 23:00)
            // Il faut ajuster la date. Simplification: on prend l'heure de lastSearchTime
            // Si lastDep < lastSearchTime, c'est probablement le lendemain
            
            baseDateObj.setHours(h, m + 1, 0, 0); // +1 min seulement (l'API ajoute déjà des décalages)
            
            // Si on passe de 23h à 00h, setHours gère le changement de jour automatiquement
            // MAIS il faut être sûr que baseDateObj était au bon jour avant
        } else {
             // Fallback
             baseDateObj.setHours(parseInt(lastSearchTime.hour), parseInt(lastSearchTime.minute) + 30, 0, 0);
        }
    } else {
        // Fallback: décaler de 30 minutes par rapport à la recherche initiale
        loadMoreOffset += 30;
        baseDateObj.setHours(parseInt(lastSearchTime.hour), parseInt(lastSearchTime.minute) + loadMoreOffset, 0, 0);
    }

    const year = baseDateObj.getFullYear();
    const month = String(baseDateObj.getMonth() + 1).padStart(2, '0');
    const day = String(baseDateObj.getDate()).padStart(2, '0');
    const newDateStr = `${year}-${month}-${day}`;

    const offsetSearchTime = {
        ...lastSearchTime,
        date: newDateStr, // Date mise à jour
        hour: String(baseDateObj.getHours()).padStart(2, '0'),
        minute: String(baseDateObj.getMinutes()).padStart(2, '0')
    };

    console.log(`🔄 Chargement + de départs à partir de ${offsetSearchTime.date} ${offsetSearchTime.hour}:${offsetSearchTime.minute}`);
    console.log(`📦 Cache: ${existingSignatures.size} signatures, ${existingDepartures.size} heures de départ`);

    try {
        // Appeler l'API avec le nouvel horaire
        const intelligentResults = await apiManager.fetchItinerary(fromPlaceId, toPlaceId, offsetSearchTime);
        let newItineraries = processIntelligentResults(intelligentResults, offsetSearchTime);
        
        // V95: Filtrer strictement les nouveaux itinéraires
        const beforeFilter = newItineraries.length;
        newItineraries = newItineraries.filter(it => {
            // 1. Exclure TOUS les vélo et piéton (on les a déjà de la première recherche)
            if (it.type === 'BIKE' || it.type === 'WALK' || it._isBike || it._isWalk) {
                return false;
            }
            
            // V199: Suppression du filtrage par heure exacte (existingDepartures)
            // Cela bloquait les trajets différents partant à la même heure
            
            // 3. Exclure les trajets avec la même signature (même structure)
            const sig = createItinerarySignature(it);
            if (existingSignatures.has(sig)) {
                // Même structure mais peut-être horaire différent - vérifier l'heure
                // Si c'est vraiment le même trajet à la même heure, exclure
                return false;
            }
            
            return true;
        });
        
        console.log(`🔍 Filtrage: ${beforeFilter} → ${newItineraries.length} (${beforeFilter - newItineraries.length} doublons/vélo/piéton exclus)`);
        
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

        console.log(`✅ ${newItineraries.length} nouveaux départs bus ajoutés`);
        
        // Ajouter les nouveaux itinéraires et mettre à jour le cache
        newItineraries.forEach(it => {
            const sig = createItinerarySignature(it);
            existingSignatures.add(sig);
            if (it.departureTime) existingDepartures.add(it.departureTime);
        });
        
        allFetchedItineraries = sortItinerariesByDeparture([...allFetchedItineraries, ...newItineraries]);
        
        // Re-rendre
        setupResultTabs(allFetchedItineraries);
        if (resultsRenderer) resultsRenderer.render('ALL');
        
        // Réactiver le bouton
        const btn = document.querySelector('.load-more-departures button');
        if (btn) {
            btn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                Charger + de départs
            `;
            btn.disabled = false;
        }
        
    } catch (error) {
        console.error('Erreur chargement + de départs:', error);
        const btn = document.querySelector('.load-more-departures button');
        if (btn) {
            btn.innerHTML = 'Erreur - Réessayer';
            btn.disabled = false;
        }
    }
}

/**
 * V95: Crée une signature unique pour un itinéraire basée sur sa structure
 * Permet de détecter les doublons même avec des horaires différents
 */
function createItinerarySignature(it) {
    if (!it) return 'null';
    
    const type = it.type || 'BUS';
    
    // Pour vélo/piéton, signature simple par type
    if (type === 'BIKE' || type === 'WALK') {
        return `${type}_only`;
    }
    
    // Pour les bus, signature basée sur les lignes et arrêts
    const segments = (it.summarySegments || [])
        .map(s => s.name || s.routeShortName || 'X')
        .join('>');
    
    const steps = (it.steps || [])
        .filter(s => s.type === 'BUS')
        .map(s => {
            const route = s.routeShortName || s.route?.route_short_name || '';
            const from = (s.departureStop || '').toLowerCase().slice(0, 15);
            const to = (s.arrivalStop || '').toLowerCase().slice(0, 15);
            return `${route}:${from}-${to}`;
        })
        .join('|');
    
    // Inclure l'heure de départ pour distinguer les mêmes trajets à des heures différentes
    const depTime = it.departureTime || '';
    
    return `${type}::${segments}::${steps}::${depTime}`;
}

    // V137b: Parse HH:MM safely and return minutes (Infinity if invalid)
    function parseDepartureMinutes(timeStr) {
        const match = timeStr?.match?.(/(\d{1,2}):(\d{2})/);
        if (!match) return Infinity;
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        if (Number.isNaN(h) || Number.isNaN(m)) return Infinity;
        return h * 60 + m;
    }

    // V139: Parse HH:MM to seconds (Infinity if invalid)
    function parseTimeToSeconds(timeStr) {
        const match = timeStr?.match?.(/(\d{1,2}):(\d{2})/);
        if (!match) return Infinity;
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        if (Number.isNaN(h) || Number.isNaN(m)) return Infinity;
        return h * 3600 + m * 60;
    }

    // V142: Garantit un ordre chronologique croissant (proche → lointain)
    // MAIS conserve les groupes par type: BUS d'abord, puis BIKE, puis WALK
    function sortItinerariesByDeparture(list) {
        // Séparer par type
        const busItins = list.filter(it => it.type !== 'BIKE' && it.type !== 'WALK' && !it._isBike && !it._isWalk);
        const bikeItins = list.filter(it => it.type === 'BIKE' || it._isBike);
        const walkItins = list.filter(it => it.type === 'WALK' || it._isWalk);
        
        // Trier seulement les bus par heure de départ
        busItins.sort((a, b) => parseDepartureMinutes(a?.departureTime) - parseDepartureMinutes(b?.departureTime));
        
        // Recomposer: BUS triés, puis BIKE, puis WALK
        return [...busItins, ...bikeItins, ...walkItins];
    }

/**
 * V132: Charge plus de trajets pour le mode "arriver"
 * Recherche des trajets arrivant plus tôt que ceux déjà affichés
 */
async function loadMoreArrivals() {
    if (!lastSearchTime || !fromPlaceId || !toPlaceId || lastSearchTime.type !== 'arriver') {
        console.warn('loadMoreArrivals: pas de recherche arriver précédente');
        return;
    }

    // Créer un cache des signatures d'itinéraires existants
    const existingSignatures = new Set();
    const existingArrivals = new Set();
    
    allFetchedItineraries.forEach(it => {
        const sig = createItinerarySignature(it);
        existingSignatures.add(sig);
        if (it.arrivalTime && it.arrivalTime !== '~') {
            existingArrivals.add(it.arrivalTime);
        }
    });

    // V203: Calcul robuste de la nouvelle heure avec gestion de la date (Arriver)
    let baseDateObj;
    if (!lastSearchTime.date || lastSearchTime.date === 'today' || lastSearchTime.date === "Aujourd'hui") {
        baseDateObj = new Date();
    } else {
        baseDateObj = new Date(lastSearchTime.date);
    }

    // Trouver l'arrivée la plus tôt parmi les bus pour chercher encore plus tôt
    const busItineraries = allFetchedItineraries.filter(it => it.type === 'BUS' || it.type === 'TRANSIT');
    
    if (busItineraries.length > 0) {
        let earliestArrival = Infinity;
        busItineraries.forEach(it => {
            const match = it.arrivalTime?.match(/(\d{1,2}):(\d{2})/);
            if (match) {
                const mins = parseInt(match[1]) * 60 + parseInt(match[2]);
                if (mins < earliestArrival) earliestArrival = mins;
            }
        });
        
        if (earliestArrival !== Infinity) {
            // On recule de 30 minutes
            // Attention: earliestArrival est en minutes depuis minuit.
            // Il faut gérer le passage au jour précédent si < 0
            // Simplification: on utilise setHours sur l'objet Date
            
            const h = Math.floor(earliestArrival / 60);
            const m = earliestArrival % 60;
            
            baseDateObj.setHours(h, m - 30, 0, 0);
        } else {
             baseDateObj.setHours(parseInt(lastSearchTime.hour) - 1, parseInt(lastSearchTime.minute), 0, 0);
        }
    } else {
        // Fallback: décaler de 1h en arrière
        baseDateObj.setHours(parseInt(lastSearchTime.hour) - 1, parseInt(lastSearchTime.minute), 0, 0);
    }

    const year = baseDateObj.getFullYear();
    const month = String(baseDateObj.getMonth() + 1).padStart(2, '0');
    const day = String(baseDateObj.getDate()).padStart(2, '0');
    const newDateStr = `${year}-${month}-${day}`;

    const offsetSearchTime = {
        ...lastSearchTime,
        date: newDateStr,
        hour: String(baseDateObj.getHours()).padStart(2, '0'),
        minute: String(baseDateObj.getMinutes()).padStart(2, '0')
    };

    console.log(`🔄 Chargement + d'arrivées (cible ${offsetSearchTime.date} ${offsetSearchTime.hour}:${offsetSearchTime.minute})`);
    console.log(`📦 Cache: ${existingSignatures.size} signatures, ${existingArrivals.size} heures d'arrivée`);

    try {
        const intelligentResults = await apiManager.fetchItinerary(fromPlaceId, toPlaceId, offsetSearchTime);
        let newItineraries = processIntelligentResults(intelligentResults, offsetSearchTime);
        
        // Filtrer les nouveaux itinéraires
        const beforeFilter = newItineraries.length;
        newItineraries = newItineraries.filter(it => {
            // Exclure vélo et piéton
            if (it.type === 'BIKE' || it.type === 'WALK' || it._isBike || it._isWalk) {
                return false;
            }
            
            // V199: Suppression du filtrage par heure exacte (existingArrivals)
            
            // Exclure les trajets avec la même signature
            const sig = createItinerarySignature(it);
            if (existingSignatures.has(sig)) {
                return false;
            }
            
            return true;
        });
        
        console.log(`🔍 Filtrage: ${beforeFilter} → ${newItineraries.length} nouveaux trajets`);
        
        if (newItineraries.length === 0) {
            console.log('Aucun nouveau trajet arrivée trouvé');
            const btn = document.querySelector('.load-more-arrivals button');
            if (btn) {
                btn.innerHTML = 'Plus de trajets disponibles';
                btn.disabled = true;
            }
            return;
        }

        console.log(`✅ ${newItineraries.length} nouveaux trajets arrivée ajoutés`);
        
        // Ajouter les nouveaux itinéraires
        newItineraries.forEach(it => {
            const sig = createItinerarySignature(it);
            existingSignatures.add(sig);
            if (it.arrivalTime) existingArrivals.add(it.arrivalTime);
        });
        
        allFetchedItineraries = [...allFetchedItineraries, ...newItineraries];
        
        // Re-trier et mettre à jour arrivalRankedAll
        const { rankArrivalItineraries } = await import('./itinerary/ranking.js');
        arrivalRankedAll = rankArrivalItineraries([...allFetchedItineraries], lastSearchTime);
        arrivalRenderedCount = arrivalRankedAll.length; // Montrer tout, pas de pagination
        
        // Re-rendre
        setupResultTabs(allFetchedItineraries);
        if (resultsRenderer) resultsRenderer.render('ALL');
        
        // Réactiver le bouton
        const btn = document.querySelector('.load-more-arrivals button');
        if (btn) {
            btn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                Générer + de trajets
            `;
            btn.disabled = false;
        }
        
    } catch (error) {
        console.error('Erreur chargement + d\'arrivées:', error);
        const btn = document.querySelector('.load-more-arrivals button');
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
        // Essaie de passer la position actuelle pour prioriser les résultats
        let lat = null, lon = null;
        if (geolocationManager && geolocationManager.lastKnownLocation) {
            lat = geolocationManager.lastKnownLocation.lat;
            lon = geolocationManager.lastKnownLocation.lng;
        }
        const suggestions = await apiManager.getPlaceAutocomplete(query, lat, lon);
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


// ❌ FONCTION SUPPRIMÉE: processGoogleRoutesResponse (Google API - not used with OTP backend)

// ❌ FONCTION SUPPRIMÉE: processSimpleRoute (Google API - not used with OTP backend)

/**
 * Transforme les legs OTP en format frontendfrontal
 */
function transformLegs(otpLegs) {
    if (!otpLegs || !Array.isArray(otpLegs)) return [];

    const normalizeStopId = (stopId) => {
        if (!stopId) return null;
        // OTP peut préfixer le feed par un entier (ex: "1:MOBIITI:Quay:111646")
        return String(stopId).replace(/^(\d+):/, '');
    };
    
    return otpLegs.map(leg => {
        const startMs = leg.startTime || null;
        const endMs = leg.endTime || null;
        const startDate = startMs ? new Date(startMs) : null;
        const endDate = endMs ? new Date(endMs) : null;
        const fmtTime = (d) => d ? `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '~';

        const fromStopId = normalizeStopId(leg.from?.stopId);
        const toStopId = normalizeStopId(leg.to?.stopId);
        const fromStopName = leg.from?.name || fromStopId || 'Arrêt';
        const toStopName = leg.to?.name || toStopId || 'Arrêt';

        const routeId = leg.routeId ? normalizeStopId(leg.routeId) : null;
        const shapeId = leg.shapeId ? normalizeStopId(leg.shapeId) : null;
        const tripId = leg.tripId ? normalizeStopId(leg.tripId) : null;

        const transformed = {
            type: leg.mode?.toUpperCase() || 'WALK',
            _isWalk: leg.mode === 'WALK',
            _isBike: leg.mode === 'BICYCLE',
            duration: formatDuration(leg.duration),
            distance: formatDistance(leg.distanceMeters),
            from: leg.from?.name || 'Départ',
            to: leg.to?.name || 'Arrivée',
            // ✅ SERVEUR-CENTRALISÉ: La polyline vient directement d'OTP (legGeometry)
            polyline: leg.polyline || leg.legGeometry?.points || null,
            // Affichage = nom; ID brut conservé pour la reconstruction des shapes
            departureStop: fromStopName,
            arrivalStop: toStopName,
            departureStopId: fromStopId || null,
            arrivalStopId: toStopId || null,
            departureTime: fmtTime(startDate),
            arrivalTime: fmtTime(endDate),
            routeId: routeId,
            shapeId: shapeId,
            tripId: tripId,
            // ✅ SERVEUR-CENTRALISÉ: Couleurs GTFS enrichies par le serveur
            routeColor: leg.routeColor || null,
            routeTextColor: leg.routeTextColor || null,
            subSteps: [] // Pour compatibilité avec legacy rendering
        };
        
        // Ajouter les détails de transit pour les bus
        if (leg.mode === 'BUS') {
            // Normaliser le nom court de la ligne et fournir des fallbacks
            const cleanedRouteId = (routeId || '') ? String(routeId).split(':').pop() : '';
            const shortName = leg.routeShortName || leg.route_long_name || leg.routeLongName || cleanedRouteId || '';
            transformed.routeShortName = shortName;
            transformed.lineNumber = shortName;
            transformed.lineName = leg.routeLongName || leg.route_long_name || '';
            transformed.headsign = leg.headsign || leg.headsign || '';
            transformed.agency = leg.agencyName || leg.agency || '';
            // Construire une instruction lisible pour l'UI
            const instrParts = [];
            if (shortName) instrParts.push(`<strong>${shortName}</strong>`);
            if (leg.headsign) instrParts.push(`direction ${leg.headsign}`);
            transformed.instruction = instrParts.length ? `Prendre ${instrParts.join(' ')}` : (`Prendre ${shortName || 'le bus'}`);
            // Arrêts intermédiaires (si disponibles) - garder coordonnées OTP
            transformed.intermediateStops = (leg.intermediateStops || []).map(stop => ({
                name: stop.name || stop.stopName || '',
                lat: stop.lat || null,
                lon: stop.lon || null
            }));
        }
        
        // Transformer les steps OTP en substeps pour les WALK legs
        if ((leg.mode === 'WALK' || leg.mode === 'BICYCLE') && leg.steps && Array.isArray(leg.steps)) {
            transformed.subSteps = leg.steps.map(step => {
                const maneuverIcon = step.relativeDirection || 'CONTINUE';
                const streetName = step.streetName || 'Continuer';
                let instruction = streetName;
                if (maneuverIcon && maneuverIcon !== 'CONTINUE') {
                    instruction = `${maneuverIcon} ${streetName}`;
                }
                return {
                    distance: formatDistance(step.distance),
                    duration: step.duration ? formatDuration(step.duration) : '',
                    maneuver: maneuverIcon,
                    streetName: streetName,
                    absoluteDirection: step.absoluteDirection || '',
                    instruction: instruction
                };
            });
            // Fournir une instruction lisible pour les étapes à pied / vélo
            const walkInstr = leg.instruction || leg.legInstruction || (leg.mode === 'BICYCLE' ? 'À vélo' : 'À pied');
            transformed.instruction = walkInstr || `À ${leg.mode?.toLowerCase()}`;
        }
        
        return transformed;
    });
}

function _normalizeStopKey(value) {
    if (!value) return '';
    return String(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function _getEncodedPolylineValue(polyline) {
    if (!polyline) return null;
    if (typeof polyline === 'string') return polyline;
    if (typeof polyline.encodedPolyline === 'string') return polyline.encodedPolyline;
    if (typeof polyline.points === 'string') return polyline.points;
    return null;
}

function _mergeEncodedPolylines(polyA, polyB) {
    const encA = _getEncodedPolylineValue(polyA);
    const encB = _getEncodedPolylineValue(polyB);
    if (!encA || !encB) return null;
    try {
        const a = decodePolyline(encA);
        const b = decodePolyline(encB);
        if (!Array.isArray(a) || a.length < 2 || !Array.isArray(b) || b.length < 2) return null;
        const merged = a.slice();
        const lastA = merged[merged.length - 1];
        const firstB = b[0];
        const sameJoin = lastA && firstB && lastA[0] === firstB[0] && lastA[1] === firstB[1];
        merged.push(...(sameJoin ? b.slice(1) : b));
        const encoded = encodePolyline(merged);
        return { encodedPolyline: encoded, latLngs: merged };
    } catch {
        return null;
    }
}

function mergeConsecutiveSameLineBusSteps(steps) {
    if (!Array.isArray(steps) || steps.length < 2) return steps;

    const merged = [];
    for (let i = 0; i < steps.length; i++) {
        const current = steps[i];
        const next = steps[i + 1];

        if (
            current?.type === 'BUS' &&
            next?.type === 'BUS' &&
            !isWaitStep(current) &&
            !isWaitStep(next)
        ) {
            const sameLine = _normalizeStopKey(current.routeShortName) &&
                _normalizeStopKey(current.routeShortName) === _normalizeStopKey(next.routeShortName);

            const sameAgency = !_normalizeStopKey(current.agency) || !_normalizeStopKey(next.agency)
                ? true
                : _normalizeStopKey(current.agency) === _normalizeStopKey(next.agency);

            const transferById = current.arrivalStopId && next.departureStopId && current.arrivalStopId === next.departureStopId;
            const transferByName = _normalizeStopKey(current.arrivalStop) &&
                _normalizeStopKey(current.arrivalStop) === _normalizeStopKey(next.departureStop);
            const sameTransferStop = transferById || transferByName;

            if (sameLine && sameAgency && sameTransferStop) {
                const mergedPolyline = _mergeEncodedPolylines(current.polyline, next.polyline);
                const finalHeadsign = next.headsign || current.headsign || '';
                const shortName = current.routeShortName || next.routeShortName || '';
                const instrParts = [];
                if (shortName) instrParts.push(`<strong>${shortName}</strong>`);
                if (finalHeadsign) instrParts.push(`direction ${finalHeadsign}`);

                merged.push({
                    ...current,
                    // Étendre jusqu'à la destination finale
                    arrivalStop: next.arrivalStop,
                    arrivalStopId: next.arrivalStopId || current.arrivalStopId,
                    arrivalTime: next.arrivalTime,
                    to: next.to || current.to,
                    // Garder l'info la plus pertinente côté bus
                    headsign: finalHeadsign,
                    instruction: instrParts.length ? `Prendre ${instrParts.join(' ')}` : (current.instruction || next.instruction),
                    // Fusion durée / stops
                    _durationSeconds: (current._durationSeconds || 0) + (next._durationSeconds || 0),
                    duration: formatDuration((current._durationSeconds || 0) + (next._durationSeconds || 0)),
                    numStops: (current.numStops || 0) + (next.numStops || 0),
                    // Fusion arrêts intermédiaires (sans changer le format)
                    intermediateStops: [
                        ...(Array.isArray(current.intermediateStops) ? current.intermediateStops : []),
                        ...(Array.isArray(next.intermediateStops) ? next.intermediateStops : [])
                    ],
                    // Fusion polyline si possible
                    polyline: mergedPolyline || current.polyline || next.polyline
                });
                i++; // sauter le next
                continue;
            }
        }

        merged.push(current);
    }
    return merged;
}

/**
 * Formate la durée en minutes pour l'affichage
 */
function formatDuration(seconds) {
    if (!seconds) return '0 min';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h${String(mins).padStart(2, '0')}` : `${hours}h`;
}

/**
 * Formate la distance pour l'affichage
 */
function formatDistance(meters) {
    if (!meters) return '0 m';
    if (meters < 1000) return `${Math.round(meters)} m`;
    const km = (meters / 1000).toFixed(1);
    return `${km} km`;
}

/**
 * Affiche un message d'erreur dans l'interface de recherche
 * @param {string} message - Message d'erreur à afficher
 */
function showSearchError(message) {
    console.error('❌ Erreur de recherche:', message);
    
    // Déterminer le message utilisateur approprié
    let userMessage = 'Erreur lors de la recherche d\'itinéraire';
    let suggestion = '';
    
    if (message.includes('404') || message.includes('NO_ROUTE')) {
        userMessage = 'Aucun itinéraire trouvé';
        suggestion = 'Essayez de modifier vos points de départ ou d\'arrivée.';
    } else if (message.includes('DATE_OUT_OF_RANGE') || message.includes('date')) {
        userMessage = 'Date hors plage';
        suggestion = 'Les horaires ne sont pas disponibles pour cette date. Essayez une date plus proche.';
    } else if (message.includes('502') || message.includes('CONNECTION')) {
        userMessage = 'Service temporairement indisponible';
        suggestion = 'Réessayez dans quelques instants.';
    } else if (message.includes('504') || message.includes('TIMEOUT')) {
        userMessage = 'Délai dépassé';
        suggestion = 'Le serveur met trop de temps à répondre. Réessayez.';
    }
    
    // Afficher dans le conteneur de résultats
    if (resultsListContainer) {
        resultsListContainer.innerHTML = `
            <div class="search-error" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                <div style="font-size: 2rem; margin-bottom: 1rem;">😕</div>
                <h3 style="margin-bottom: 0.5rem; color: var(--text-primary);">${userMessage}</h3>
                ${suggestion ? `<p style="margin-bottom: 1rem;">${suggestion}</p>` : ''}
                <button onclick="window.location.reload()" class="btn-primary" style="margin-top: 1rem;">
                    Réessayer
                </button>
            </div>
        `;
    }
}

/**
 * Retourne la couleur d'une ligne de bus
 */
function getLineColor(lineNumber) {
    const key = String(lineNumber || '').toUpperCase();
    const colors = {
        'A': '#1abc9c',
        'B': '#3498db',
        'C': '#e74c3c',
        'D': '#f39c12',
        'E1': '#9b59b6',
        'E2': '#1abc9c',
        'E3': '#3498db',
        'E4': '#e74c3c',
    };
    return colors[key] || '#95a5a6';
}

function processIntelligentResults(intelligentResults, searchTime) {
    console.log("=== DÉBUT PROCESS INTELLIGENT RESULTS ===");
    console.log("📥 Mode de recherche:", searchTime?.type || 'partir');
    console.log("📥 Heure demandée:", `${searchTime?.hour}:${String(searchTime?.minute || 0).padStart(2,'0')}`);
    
    // Si null/undefined, retourner array vide
    if (!intelligentResults) {
        console.warn('⚠️ intelligentResults est null/undefined');
        return [];
    }
    
    // **BACKEND OTP LOCAL UNIQUEMENT** - pas de Google, juste OTP
    if (intelligentResults?.routes && Array.isArray(intelligentResults.routes)) {
        console.log('🚀 Utilisation du backend OTP local -', intelligentResults.routes.length, 'itinéraires');
        const fmtTime = (ms) => {
            if (!ms || Number.isNaN(ms)) return null;
            const d = new Date(ms);
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        };
        
        return intelligentResults.routes.map((r, idx) => {
            const legs = r.legs || [];
            const durationSeconds = r.duration || 0;
            const itineraryStartMs = r.startTime || legs[0]?.startTime || null;
            const itineraryEndMs = r.endTime || legs[legs.length - 1]?.endTime || (itineraryStartMs ? itineraryStartMs + durationSeconds * 1000 : null);

            let departureTime = fmtTime(itineraryStartMs);
            let arrivalTime = fmtTime(itineraryEndMs);

            // Fallback sur l'heure demandée si OTP ne renvoie rien (ne devrait pas arriver)
            if (!departureTime && searchTime?.hour !== undefined && searchTime?.minute !== undefined) {
                const h = parseInt(searchTime.hour) || 0;
                const m = parseInt(searchTime.minute) || 0;
                departureTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            }
            if (!arrivalTime && departureTime) {
                const [hStr, mStr] = departureTime.split(':');
                const startTotal = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);
                const endTotal = startTotal + Math.round(durationSeconds / 60);
                const endHour = Math.floor(endTotal / 60) % 24;
                const endMin = endTotal % 60;
                arrivalTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
            }
            if (!departureTime) departureTime = '~';
            if (!arrivalTime) arrivalTime = '~';
            
            // Détecter le type d'itinéraire
            const hasBus = legs.some(leg => leg.mode === 'BUS');
            const hasBike = legs.some(leg => leg.mode === 'BICYCLE');
            const itinType = hasBus ? 'BUS' : (hasBike ? 'BIKE' : 'WALK');
            
            // ✅ SERVEUR-CENTRALISÉ: Utiliser les couleurs GTFS du serveur
            const summarySegments = legs
                .filter(leg => leg.mode === 'BUS')
                .map(leg => {
                    const cleanedRouteId = (leg.routeId || '') ? String(leg.routeId).split(':').pop() : '';
                    const label = leg.routeShortName || leg.routeLongName || cleanedRouteId || 'Bus';
                    return {
                        type: 'BUS',
                        name: label,
                        // Priorité: couleur serveur (GTFS) > couleur locale
                        color: leg.routeColor || getLineColor(label || ''),
                        textColor: leg.routeTextColor || '#fff'
                    };
                });
            
            // Transformer les legs OTP
            const steps = mergeConsecutiveSameLineBusSteps(transformLegs(legs));

            // Itinéraire-level metadata
            const firstBusLeg = legs.find(l => l.mode === 'BUS');
            const routeId = firstBusLeg?.routeId || null;
            const tripId = firstBusLeg?.tripId || null;
            const shapeId = firstBusLeg?.shapeId || null;
            
            return {
                type: itinType,
                duration: formatDuration(durationSeconds),
                distance: formatDistance(r.distanceMeters),
                polyline: r.polyline,
                legs: steps,
                steps: steps,
                summarySegments,
                routeId,
                tripId,
                shapeId,
                departureTime,
                arrivalTime,
                score: 100 - idx
            };
        });
    }

    // Aucune donnée valide - retourner vide
    console.warn('⚠️ Aucune donnée OTP valide reçue');
    return [];
}

/**
 * ✅ SERVEUR-CENTRALISÉ: Normalisation des polylines
 * 
 * Les polylines viennent maintenant directement du serveur (OTP legGeometry).
 * Cette fonction ne fait plus de reconstruction locale - elle normalise simplement
 * le format pour le renderer Leaflet.
 */
async function ensureItineraryPolylines(itineraries) {
    if (!Array.isArray(itineraries)) return;

    for (const itin of itineraries) {
        if (!itin || !Array.isArray(itin.steps)) continue;
        
        for (const step of itin.steps) {
            if (!step || step.type !== 'BUS' || isWaitStep(step)) continue;
            
            // La polyline doit venir du serveur (OTP legGeometry.points)
            const existingPolyline = step.polyline;
            
            // Si on a déjà des latLngs, c'est bon
            if (Array.isArray(existingPolyline?.latLngs) && existingPolyline.latLngs.length >= 2) {
                continue;
            }
            
            // Si on a une polyline encodée, la décoder
            const encodedValue = typeof existingPolyline === 'string' 
                ? existingPolyline 
                : (existingPolyline?.encodedPolyline || existingPolyline?.points);
                
            if (encodedValue && typeof encodedValue === 'string') {
                try {
                    const decoded = decodePolyline(encodedValue);
                    if (decoded && decoded.length >= 2) {
                        step.polyline = {
                            encodedPolyline: encodedValue,
                            latLngs: decoded
                        };
                        continue;
                    }
                } catch (err) {
                    console.warn('Erreur décodage polyline:', err);
                }
            }
            
            // ⚠️ SERVEUR-CENTRALISÉ: Si pas de polyline du serveur, c'est un problème
            // On log un warning mais on ne tente PAS de reconstruire localement
            console.warn('❌ Polyline manquante du serveur pour step BUS:', {
                departureStop: step.departureStop,
                arrivalStop: step.arrivalStop,
                routeId: step.routeId
            });
        }
    }
}

function processSimpleRoute(data, mode, modeInfo, searchTime) { 
    if (!data || !data.routes || data.routes.length === 0 || !modeInfo) return null;
    const route = data.routes[0];
    const leg = route.legs?.[0];
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

    // V184: Protection contre leg ou leg.steps undefined
    if (leg?.steps) {
        leg.steps.forEach(step => {
            const distanceText = step.localizedValues?.distance?.text || '';
            const instruction = step.navigationInstruction?.instructions || step.localizedValues?.instruction || (mode === 'bike' ? "Continuer à vélo" : "Marcher");
            const duration = formatGoogleDuration(step.staticDuration); 
            const maneuver = step.navigationInstruction?.maneuver || 'DEFAULT';
            aggregatedStep.subSteps.push({ instruction, distance: distanceText, duration, maneuver });
            aggregatedStep.polylines.push(step.polyline);
        });
    }
    
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

// V221: getEncodedPolylineValue, getPolylineLatLngs, isWaitStep, extractStepPolylines
// sont maintenant importés depuis map/routeDrawing.js

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
    // Protection: si pas de steps, retourner un message
    if (!itinerary || !itinerary.steps) {
        console.warn('⚠️ renderItineraryDetailHTML: itinerary ou steps manquant', itinerary);
        return '<p class="error-message">Données d\'itinéraire manquantes</p>';
    }
    
    const stepsHtml = itinerary.steps.map((step, index) => {
        // ✅ V45: Logique de marche (et vélo) restaurée avec <details>
        if (step.type === 'WALK' || step.type === 'BIKE') {
            const hasSubSteps = step.subSteps && step.subSteps.length > 0;
            const icon = (step.type === 'BIKE') ? ICONS.BICYCLE : ICONS.WALK;
            const stepClass = (step.type === 'BIKE') ? 'bicycle' : 'walk';
            const safeInstruction = getSafeStopLabel(step.instruction, step.type === 'BIKE' ? 'À vélo' : 'À pied');

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
                        <span class="step-instruction">${safeInstruction} <span class="step-duration-inline">(${step.duration})</span></span>
                        
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
                        ` : `<span class="step-sub-instruction">${safeInstruction}</span>`}
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
            
            let stopsDisplayText = 'Direct';
            if (intermediateStopCount > 1) {
                stopsDisplayText = `${intermediateStopCount} arrêts`;
            } else if (intermediateStopCount === 1) {
                stopsDisplayText = `1 arrêt`;
            }

            const lineColor = step.routeColor || 'var(--border)';
            const badgeLabel = getSafeRouteBadgeLabel(step.routeShortName, step.lineName || step.routeId || 'Bus');
            const badgeBg = step.routeColor || 'var(--primary)';
            const badgeText = step.routeTextColor || '#ffffff';
            const safeHeadsign = step.headsign || step.routeLongName || '';
            const departureStopLabel = getSafeStopLabel(step.departureStop);
            const arrivalStopLabel = getSafeStopLabel(step.arrivalStop);
            const departureTimeLabel = getSafeTimeLabel(step.departureTime);
            const arrivalTimeLabel = getSafeTimeLabel(step.arrivalTime);
            
            return `
                <div class="step-detail bus" style="--line-color: ${lineColor};">
                    <div class="step-icon">
                        <div class="route-line-badge-large" style="background-color: ${badgeBg}; color: ${badgeText};">${badgeLabel}</div>
                    </div>
                    <div class="step-info">
                        <div class="bus-instruction">Prendre le <strong>${badgeLabel}</strong> direction <strong>${safeHeadsign || 'destination'}</strong> <span class="trip-duration">(${step.duration})</span></div>
                        <div class="bus-boarding">
                            <span class="boarding-dot"></span>
                            <span>Montée à <strong>${departureStopLabel}</strong></span>
                            <span class="boarding-time">(${departureTimeLabel})</span>
                        </div>
                        ${intermediateStopCount > 0 ? `
                        <details class="bus-stops-details">
                            <summary class="bus-stops-summary">
                                <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                                <span>${stopsDisplayText}</span>
                            </summary>
                            ${hasIntermediateStops ? `
                            <ul class="bus-intermediate-stops">
                                ${step.intermediateStops.map(stop => {
                                    const name = typeof stop === 'string' ? stop : (stop?.name || stop?.stop_name || 'Arrêt');
                                    const safeName = getSafeStopLabel(name);
                                    return `<li class="bus-stop-item"><span class="stop-dot"></span>${safeName}</li>`;
                                }).join('')}
                            </ul>
                            ` : `<ul class="bus-intermediate-stops"><li class="bus-stop-item">(Arrêts non disponibles)</li></ul>`}
                        </details>
                        ` : ''}
                        <div class="bus-alighting">
                            <span class="alighting-dot"></span>
                            <span>Descente à <strong>${arrivalStopLabel}</strong></span>
                            <span class="alighting-time">(${arrivalTimeLabel})</span>
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
            const safeInstruction = getSafeStopLabel(step.instruction, step.type === 'BIKE' ? 'À vélo' : 'À pied');

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
                        <span class="step-instruction">${safeInstruction} <span class="step-duration-inline">(${step.duration})</span></span>
                        
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
                                            <span>${getSafeStopLabel(subStep.instruction, 'Continuer')}</span>
                                            <span class="walk-step-meta">${subStep.distance} ${subStep.duration ? `(${subStep.duration})` : ''}</span>
                                        </div>
                                    </li>
                                `).join('')}
                            </ul>
                        </details>
                        ` : `<span class="step-sub-instruction">${safeInstruction}</span>`}
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
            
            let stopsDisplayText = 'Direct';
            if (intermediateStopCount > 1) {
                stopsDisplayText = `${intermediateStopCount} arrêts`;
            } else if (intermediateStopCount === 1) {
                stopsDisplayText = `1 arrêt`;
            }

            const badgeLabel = getSafeRouteBadgeLabel(step.routeShortName, step.lineName || step.routeId || 'Bus');
            const badgeBg = step.routeColor || 'var(--primary)';
            const badgeText = step.routeTextColor || '#ffffff';
            const safeHeadsign = step.headsign || step.routeLongName || '';
            
            // Departure/arrival info
            const departureStopLabel = getSafeStopLabel(step.from, 'Départ');
            const arrivalStopLabel = getSafeStopLabel(step.to, 'Arrivée');
            const departureTimeLabel = getSafeTimeLabel(step.departureTime || step.startTime);
            const arrivalTimeLabel = getSafeTimeLabel(step.arrivalTime || step.endTime);

            return `
                <div class="step-detail bus" style="--line-color: ${lineColor};">
                    <div class="step-icon">
                        <div class="route-line-badge-large" style="background-color: ${badgeBg}; color: ${badgeText};">${badgeLabel}</div>
                    </div>
                    <div class="step-info">
                        <div class="bus-instruction">Prendre le <strong>${badgeLabel}</strong> direction <strong>${safeHeadsign || 'destination'}</strong> <span class="trip-duration">(${step.duration})</span></div>
                        <div class="bus-boarding">
                            <span class="boarding-dot"></span>
                            <span>Montée à <strong>${departureStopLabel}</strong></span>
                            <span class="boarding-time">(${departureTimeLabel})</span>
                        </div>
                        ${intermediateStopCount > 0 ? `
                        <details class="bus-stops-details">
                            <summary class="bus-stops-summary">
                                <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                                <span>${stopsDisplayText}</span>
                            </summary>
                            ${hasIntermediateStops ? `
                            <ul class="bus-intermediate-stops">
                                ${step.intermediateStops.map(stop => {
                                    const name = typeof stop === 'string' ? stop : (stop?.name || stop?.stop_name || 'Arrêt');
                                    const safeName = getSafeStopLabel(name);
                                    return `<li class="bus-stop-item"><span class="stop-dot"></span>${safeName}</li>`;
                                }).join('')}
                            </ul>
                            ` : `<ul class="bus-intermediate-stops"><li class="bus-stop-item">(Arrêts non disponibles)</li></ul>`}
                        </details>
                        ` : ''}
                        <div class="bus-alighting">
                            <span class="alighting-dot"></span>
                            <span>Descente à <strong>${arrivalStopLabel}</strong></span>
                            <span class="alighting-time">(${arrivalTimeLabel})</span>
                        </div>
                    </div>
                </div>
            `;
        }
    }).join('');

    detailPanelContent.innerHTML = stepsHtml;
    resetDetailPanelScroll();

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
    // V131: Utiliser la fonction du module trafficInfo.js pour avoir les clics
    renderInfoTraficCardFromModule(dataManager, lineStatuses, infoTraficList, infoTraficCount);
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
    document.body.classList.add('view-map-locked'); 
    if (mapRenderer && mapRenderer.map) {
        mapRenderer.map.invalidateSize();
    }
}

function showDashboardHall() {
    dashboardContainer.classList.remove('hidden');
    itineraryResultsContainer.classList.add('hidden');
    resetDetailViewState();
    mapContainer.classList.add('hidden');
    document.body.classList.remove('view-map-locked');
    document.body.classList.remove('view-is-locked');
    document.body.classList.remove('itinerary-view-active'); // V67
    
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
    // V67: Cacher header/footer Perimap sur la vue itinéraire
    document.body.classList.add('itinerary-view-active');
    // Ne pas verrouiller le scroll pour permettre de voir tous les itinéraires

    if (resultsListContainer) {
        resultsListContainer.innerHTML = '<p class="results-message">Recherche d\'itinéraire en cours...</p>';
    }
    
    // V151: Invalider la carte PC avec plusieurs délais pour s'assurer qu'elle s'affiche
    if (resultsMapRenderer && resultsMapRenderer.map) {
        // Délai immédiat
        setTimeout(() => {
            resultsMapRenderer.map.invalidateSize();
        }, 50);
        // Délai après le rendu complet
        setTimeout(() => {
            resultsMapRenderer.map.invalidateSize();
            console.log('🗺️ Carte PC invalidée (300ms)');
        }, 300);
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
    // Correctif: garantir que les classes de verrouillage (utilisées pour les vues plein écran)
    // sont retirées quand on affiche une sous-vue interne (horaires, info-trafic) afin
    // de préserver l'en-tête et le scroll.
    document.body.classList.remove('view-map-locked');
    document.body.classList.remove('view-is-locked');
    
    // V84: Masquer le bandeau d'alerte sur les sous-vues pour ne pas bloquer le bouton retour
    if (alertBanner) {
        alertBanner.classList.add('hidden');
    }

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
    updateData().catch(err => console.error('updateData error:', err));
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
async function updateData() {
    if (!timeManager || !tripScheduler || !mapRenderer) {
        return;
    }

    try { updateSchedulePeriodBanner(false); } catch (e) { /* ignore */ }

    const currentSeconds = timeManager.getCurrentSeconds();
    updateClock(currentSeconds);
    
    const activeBuses = await tripScheduler.getActiveTrips();

    activeBuses.forEach(bus => {
        if (bus && bus.route) {
            const routeId = bus.route.route_id;
            bus.currentStatus = (lineStatuses[routeId] && lineStatuses[routeId].status) 
                                ? lineStatuses[routeId].status 
                                : 'normal';
        }
    });
    
    const visibleBuses = activeBuses
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
        _debugRender: (mode='ALL') => resultsRenderer && resultsRenderer.render(mode),
        // V140: offline sorting check without external API
        simulateItinerarySorting: async function simulateItinerarySorting() {
            const sampleDepart = [
                { departureTime: '13:22', arrivalTime: '14:43', type: 'BUS' },
                { departureTime: '13:25', arrivalTime: '14:49', type: 'BUS' },
                { departureTime: '13:50', arrivalTime: '15:13', type: 'BUS' },
                { departureTime: '14:14', arrivalTime: '15:21', type: 'BUS' }
            ];

            const sampleArrive = [
                { departureTime: '12:39', arrivalTime: '13:51', type: 'BUS' },
                { departureTime: '13:25', arrivalTime: '14:49', type: 'BUS' },
                { departureTime: '14:06', arrivalTime: '15:00', type: 'BUS' },
                { departureTime: '13:50', arrivalTime: '15:13', type: 'BUS' },
                { departureTime: '13:22', arrivalTime: '14:43', type: 'BUS' }
            ];

            console.log('--- DEBUG PARTIR (tri croissant départ) ---');
            console.table(sortItinerariesByDeparture(sampleDepart).map(it => ({ dep: it.departureTime, arr: it.arrivalTime })));

            console.log('--- DEBUG ARRIVER (cible 15:00, tri arrivée décroissante) ---');
            const rankedArrive = rankArrivalItineraries(sampleArrive, { type: 'arriver', hour: '15', minute: '00' });
            console.table(rankedArrive.map(it => ({ dep: it.departureTime, arr: it.arrivalTime })));
        }
    });
}

function updateSchedulePeriodBanner(force = false) {
    if (!dataManager || !timeManager) return;

    const banner = document.getElementById('schedule-period-banner');
    const labelEl = document.getElementById('schedule-period-label');
    const textEl = document.getElementById('schedule-period-text');

    if (!banner || !labelEl || !textEl) return;

    const nowDate = timeManager.getCurrentDate ? timeManager.getCurrentDate() : new Date();
    const key = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;

    if (!force && _lastScheduleBannerKey === key) return;
    _lastScheduleBannerKey = key;

    const info = dataManager.getSchedulePeriodInfo(nowDate);
    const shouldShow = info && info.type !== 'standard';

    if (!shouldShow) {
        banner.classList.add('hidden');
        return;
    }

    labelEl.textContent = info.label || 'Horaires';
    textEl.textContent = info.message || 'Vérifiez les horaires selon la période.';
    banner.classList.remove('hidden');
}