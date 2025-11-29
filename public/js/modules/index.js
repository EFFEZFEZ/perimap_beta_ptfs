/**
 * index.js - Point d'entrée des modules refactorisés
 * 
 * Ce fichier exporte tous les modules pour faciliter les imports
 * lors de la migration progressive de main.js.
 */

// === État ===
export { AppState } from '../state/appState.js';

// === Configuration ===
export { ICONS, getManeuverIcon, getAlertBannerIcon } from '../config/icons.js';
export { 
    LINE_CATEGORIES, 
    PDF_FILENAME_MAP, 
    ROUTE_LONG_NAME_MAP,
    getCategoryForRoute,
    getCategoryInfo,
    getPdfPath,
    getRouteLongName,
    isDisplayableInTraffic
} from '../config/routes.js';

// === Utilitaires ===
export {
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
    parseGoogleDuration,
    formatSecondsToClockString,
    formatDateShort,
    formatDateLabel
} from '../utils/formatters.js';

export {
    decodePolyline,
    encodePolyline,
    getEncodedPolylineValue,
    getPolylineLatLngs,
    isWaitStep,
    extractStepPolylines,
    getLeafletStyleForStep
} from '../utils/polyline.js';

// === Logger ===
export {
    debug,
    info,
    warn,
    error,
    timing,
    setDebug,
    isDebug
} from '../utils/logger.js';

// === Controllers ===
export {
    BOTTOM_SHEET_LEVELS,
    BOTTOM_SHEET_EXPANDED_LEVEL_INDEX,
    isMobileDetailViewport,
    isSheetAtMaxLevel,
    isSheetAtMinLevel,
    getCurrentLevelIndex,
    applyBottomSheetLevel,
    prepareBottomSheetForViewport,
    initBottomSheetControls,
    resetBottomSheetState,
    setupDetailPanelScrollHandlers
} from '../controllers/bottomSheetController.js';

export {
    init as initViewController,
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
} from '../controllers/viewController.js';

// === UI ===
export {
    closeCurrentPopover,
    hasActivePopover,
    getCurrentPopover,
    showIntermediateStopsPopover,
    updatePopoverContent,
    updatePopoverPosition,
    createIntermediateStopsHtml,
    cleanup as cleanupPopover
} from '../ui/popoverManager.js';

export {
    STOP_ROLE_PRIORITY,
    isWaitStep as isDetailWaitStep,
    shouldSuppressBusStep,
    getManeuverIcon as getDetailManeuverIcon,
    renderItineraryStepsHTML,
    renderItinerarySummaryHTML
} from '../ui/detailRenderer.js';

// === Constantes partagées ===
export const DETAIL_SHEET_TRANSITION_MS = 300;
export const BOTTOM_SHEET_DRAG_ZONE_PX = 110;
export const BOTTOM_SHEET_SCROLL_UNLOCK_THRESHOLD = 4;
export const BOTTOM_SHEET_VELOCITY_THRESHOLD = 0.35;
export const BOTTOM_SHEET_MIN_DRAG_DISTANCE_PX = 45;
export const BOTTOM_SHEET_DRAG_BUFFER_PX = 20;
