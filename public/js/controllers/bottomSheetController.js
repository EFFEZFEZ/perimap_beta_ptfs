/**
 * bottomSheetController.js - Contrôleur du bottom sheet mobile
 * 
 * Ce module gère le comportement du bottom sheet dans la vue détail d'itinéraire :
 * - Niveaux de hauteur (25%, 50%, 80%)
 * - Drag & drop
 * - Gestion du scroll
 * - Resize responsive
 */

// === Constantes ===

/**
 * Niveaux de hauteur du bottom sheet (pourcentage de la hauteur du viewport)
 * 0 = réduit, 1 = moyen, 2 = étendu
 */
export const BOTTOM_SHEET_LEVELS = [0.25, 0.50, 0.80];

/**
 * Index du niveau considéré comme "étendu" (permet le scroll du contenu)
 */
export const BOTTOM_SHEET_EXPANDED_LEVEL_INDEX = 2;

/**
 * Zone en pixels au-dessus du bord supérieur du sheet où le drag est permis
 */
export const BOTTOM_SHEET_DRAG_BUFFER_PX = 20;

/**
 * Zone en pixels depuis le haut du sheet où le drag est toujours permis
 */
export const BOTTOM_SHEET_DRAG_ZONE_PX = 60;

/**
 * Seuil de scroll pour débloquer le drag depuis le contenu
 */
export const BOTTOM_SHEET_SCROLL_UNLOCK_THRESHOLD = 5;

/**
 * Seuil de vélocité pour déclencher un changement de niveau
 */
export const BOTTOM_SHEET_VELOCITY_THRESHOLD = 0.3;

/**
 * Distance minimale de drag pour déclencher un changement de niveau
 */
export const BOTTOM_SHEET_MIN_DRAG_DISTANCE_PX = 40;

// === État du controller ===

let currentLevelIndex = 0;
let dragState = null;
let controlsInitialized = false;

// Références DOM
let detailBottomSheet = null;
let detailPanelWrapper = null;
let itineraryDetailContainer = null;

// === Fonctions utilitaires ===

/**
 * Vérifie si on est sur mobile
 */
export function isMobileDetailViewport() {
    return window.innerWidth <= 768;
}

/**
 * Récupère la hauteur du viewport
 */
function getViewportHeight() {
    return Math.max(window.innerHeight, document.documentElement?.clientHeight || 0);
}

/**
 * Récupère la hauteur actuelle du sheet en pixels
 */
function getCurrentSheetHeightPx() {
    if (!detailBottomSheet) return 0;
    const inlineValue = parseFloat(detailBottomSheet.style.getPropertyValue('--sheet-height'));
    if (Number.isFinite(inlineValue)) {
        return inlineValue;
    }
    const viewportHeight = getViewportHeight();
    return viewportHeight * BOTTOM_SHEET_LEVELS[currentLevelIndex];
}

/**
 * Trouve l'index du niveau le plus proche d'une fraction
 */
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

/**
 * Vérifie si on est au niveau maximum
 */
export function isSheetAtMaxLevel() {
    return currentLevelIndex >= BOTTOM_SHEET_LEVELS.length - 1;
}

/**
 * Vérifie si on est au niveau minimum
 */
export function isSheetAtMinLevel() {
    return currentLevelIndex <= 0;
}

/**
 * Récupère l'index du niveau actuel
 */
export function getCurrentLevelIndex() {
    return currentLevelIndex;
}

// === Fonctions de gestion du niveau ===

/**
 * Applique un niveau de hauteur au bottom sheet
 * @param {number} index - Index du niveau à appliquer
 * @param {Object} options - Options
 * @param {boolean} options.immediate - Si true, pas de transition
 */
export function applyBottomSheetLevel(index, { immediate = false } = {}) {
    if (!detailBottomSheet || !isMobileDetailViewport()) return;
    
    const targetIndex = Math.max(0, Math.min(BOTTOM_SHEET_LEVELS.length - 1, index));
    currentLevelIndex = targetIndex;
    
    const viewportHeight = getViewportHeight();
    if (!viewportHeight) return;
    
    const targetPx = Math.round(viewportHeight * BOTTOM_SHEET_LEVELS[targetIndex]);
    
    if (immediate) {
        detailBottomSheet.classList.add('sheet-height-no-transition');
    }
    
    detailBottomSheet.style.setProperty('--sheet-height', `${targetPx}px`);
    
    // Gestion de la classe is-expanded
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

/**
 * Prépare le bottom sheet pour le viewport actuel
 */
export function prepareBottomSheetForViewport(immediate = false) {
    if (!detailBottomSheet) return;
    if (!isMobileDetailViewport()) {
        detailBottomSheet.style.removeProperty('--sheet-height');
        return;
    }
    applyBottomSheetLevel(currentLevelIndex, { immediate });
}

/**
 * Gère le redimensionnement de la fenêtre
 */
function handleBottomSheetResize() {
    if (!detailBottomSheet) return;
    if (!isMobileDetailViewport()) {
        detailBottomSheet.style.removeProperty('--sheet-height');
        cancelBottomSheetDrag();
        return;
    }
    applyBottomSheetLevel(currentLevelIndex, { immediate: true });
}

// === Fonctions de drag ===

/**
 * Vérifie si le pointeur est dans la zone de drag
 */
function isPointerWithinBottomSheetDragRegion(event) {
    if (!detailBottomSheet) return false;
    const rect = detailBottomSheet.getBoundingClientRect();
    const topBoundary = rect.top - BOTTOM_SHEET_DRAG_BUFFER_PX;
    const bottomBoundary = rect.top + BOTTOM_SHEET_DRAG_ZONE_PX;
    return event.clientY >= topBoundary && event.clientY <= bottomBoundary;
}

/**
 * Annule le drag en cours
 */
function cancelBottomSheetDrag() {
    if (!dragState) return;
    window.removeEventListener('pointermove', onBottomSheetPointerMove);
    window.removeEventListener('pointerup', onBottomSheetPointerUp);
    window.removeEventListener('pointercancel', onBottomSheetPointerUp);
    if (detailBottomSheet && dragState.pointerId !== undefined) {
        try { detailBottomSheet.releasePointerCapture(dragState.pointerId); } catch (_) { /* ignore */ }
    }
    detailBottomSheet?.classList.remove('is-dragging');
    dragState = null;
}

/**
 * Handler pour le début du drag (pointerdown)
 */
function onBottomSheetPointerDown(event) {
    if (!isMobileDetailViewport() || !detailBottomSheet || !itineraryDetailContainer?.classList.contains('is-active')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    
    const isHandle = Boolean(event.target.closest('.panel-handle'));
    const inDragRegion = isPointerWithinBottomSheetDragRegion(event);
    const inSheetContent = Boolean(event.target.closest('#detail-panel-wrapper'));
    const isExpanded = currentLevelIndex >= BOTTOM_SHEET_EXPANDED_LEVEL_INDEX;
    const wrapperScroll = detailPanelWrapper ? detailPanelWrapper.scrollTop : 0;
    
    // Si pas expanded, on peut drag depuis n'importe où sur le sheet
    if (!isExpanded) {
        if (!isHandle && !inDragRegion && !inSheetContent) return;
    } else {
        // Si expanded, on ne peut drag que depuis la handle ou si on est au top du scroll
        const canUseContentDrag = inSheetContent && wrapperScroll <= BOTTOM_SHEET_SCROLL_UNLOCK_THRESHOLD;
        if (!isHandle && !inDragRegion && !canUseContentDrag) return;
    }
    
    event.preventDefault();
    dragState = {
        pointerId: event.pointerId,
        startY: event.clientY,
        lastClientY: event.clientY,
        startHeight: getCurrentSheetHeightPx(),
        lastHeight: null,
        lastEventTime: performance.now(),
        velocity: 0,
        startIndex: currentLevelIndex
    };
    
    detailBottomSheet.classList.add('is-dragging');
    itineraryDetailContainer?.classList.add('sheet-is-dragging');
    
    try { detailBottomSheet.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
    
    window.addEventListener('pointermove', onBottomSheetPointerMove, { passive: false });
    window.addEventListener('pointerup', onBottomSheetPointerUp);
    window.addEventListener('pointercancel', onBottomSheetPointerUp);
}

/**
 * Handler pour le mouvement du drag (pointermove)
 */
function onBottomSheetPointerMove(event) {
    if (!dragState || !detailBottomSheet) return;
    event.preventDefault();
    
    const viewportHeight = getViewportHeight();
    if (!viewportHeight) return;
    
    const deltaY = dragState.startY - event.clientY;
    const minHeight = viewportHeight * BOTTOM_SHEET_LEVELS[0];
    const maxHeight = viewportHeight * BOTTOM_SHEET_LEVELS[BOTTOM_SHEET_LEVELS.length - 1];
    let nextHeight = dragState.startHeight + deltaY;
    nextHeight = Math.max(minHeight, Math.min(maxHeight, nextHeight));
    
    const now = performance.now();
    if (dragState.lastHeight !== null) {
        const deltaHeight = nextHeight - dragState.lastHeight;
        const elapsed = now - (dragState.lastEventTime || now);
        if (elapsed > 0) {
            dragState.velocity = deltaHeight / elapsed;
        }
    }
    
    dragState.lastHeight = nextHeight;
    dragState.lastClientY = event.clientY;
    dragState.lastEventTime = now;
    
    detailBottomSheet.style.setProperty('--sheet-height', `${nextHeight}px`);
}

/**
 * Handler pour la fin du drag (pointerup)
 */
function onBottomSheetPointerUp() {
    if (!dragState) return;
    
    const viewportHeight = getViewportHeight();
    if (viewportHeight) {
        const appliedHeight = dragState.lastHeight ?? dragState.startHeight;
        const fraction = appliedHeight / viewportHeight;
        const closestIndex = getClosestSheetLevelIndex(fraction);
        let targetIndex = closestIndex;
        
        const velocity = dragState.velocity || 0;
        const deltaFromStart = appliedHeight - dragState.startHeight;
        const biasNeeded = closestIndex === dragState.startIndex;
        
        if (biasNeeded && Math.abs(velocity) > BOTTOM_SHEET_VELOCITY_THRESHOLD) {
            const direction = velocity > 0 ? 1 : -1;
            targetIndex = Math.max(0, Math.min(BOTTOM_SHEET_LEVELS.length - 1, dragState.startIndex + direction));
        } else if (biasNeeded && Math.abs(deltaFromStart) > BOTTOM_SHEET_MIN_DRAG_DISTANCE_PX) {
            const direction = deltaFromStart > 0 ? 1 : -1;
            targetIndex = Math.max(0, Math.min(BOTTOM_SHEET_LEVELS.length - 1, dragState.startIndex + direction));
        }
        
        applyBottomSheetLevel(targetIndex);
    }
    
    cancelBottomSheetDrag();
}

/**
 * Handler pour la molette dans le panel détail
 */
function handleDetailPanelWheel(event) {
    if (!isMobileDetailViewport() || !detailPanelWrapper || !detailBottomSheet) return;
    
    const nearTop = detailPanelWrapper.scrollTop <= BOTTOM_SHEET_SCROLL_UNLOCK_THRESHOLD;
    if (!nearTop) return; // let content scroll when not at the top
    
    const direction = Math.sign(event.deltaY);
    if (direction < 0 && !isSheetAtMaxLevel()) {
        event.preventDefault();
        applyBottomSheetLevel(currentLevelIndex + 1);
    } else if (direction > 0 && !isSheetAtMinLevel()) {
        event.preventDefault();
        applyBottomSheetLevel(currentLevelIndex - 1);
    }
}

// === Initialisation ===

/**
 * Initialise les contrôles du bottom sheet
 * @param {Object} elements - Éléments DOM requis
 * @param {HTMLElement} elements.detailBottomSheet - L'élément bottom sheet
 * @param {HTMLElement} elements.detailPanelWrapper - Le wrapper du contenu
 * @param {HTMLElement} elements.itineraryDetailContainer - Le container de la vue détail
 */
export function initBottomSheetControls(elements) {
    if (controlsInitialized) return;
    
    detailBottomSheet = elements.detailBottomSheet;
    detailPanelWrapper = elements.detailPanelWrapper;
    itineraryDetailContainer = elements.itineraryDetailContainer;
    
    if (!detailBottomSheet || !itineraryDetailContainer) return;
    
    detailBottomSheet.addEventListener('pointerdown', onBottomSheetPointerDown, { passive: false });
    window.addEventListener('resize', handleBottomSheetResize);
    
    if (detailPanelWrapper) {
        detailPanelWrapper.addEventListener('wheel', handleDetailPanelWheel, { passive: false });
    }
    
    controlsInitialized = true;
    prepareBottomSheetForViewport(true);
}

/**
 * Réinitialise l'état du controller (pour les tests ou le rechargement)
 */
export function resetBottomSheetState() {
    currentLevelIndex = 0;
    dragState = null;
    controlsInitialized = false;
    detailBottomSheet = null;
    detailPanelWrapper = null;
    itineraryDetailContainer = null;
}

/**
 * Configure les handlers de scroll et touch pour le panel détail
 * @param {Object} elements - Éléments DOM requis
 */
export function setupDetailPanelScrollHandlers(elements) {
    const { detailPanelWrapper, itineraryDetailContainer } = elements;
    
    if (!detailPanelWrapper || !itineraryDetailContainer) return;
    
    let touchStartY = 0;
    
    // Bloquer le scroll du contenu tant qu'on n'est pas au niveau expanded
    detailPanelWrapper.addEventListener('touchstart', (e) => { 
        touchStartY = e.touches[0].clientY; 
    }, { passive: true }); 
    
    detailPanelWrapper.addEventListener('touchmove', (e) => {
        // Si on n'est pas au niveau max, bloquer le scroll et permettre le drag
        if (currentLevelIndex < BOTTOM_SHEET_EXPANDED_LEVEL_INDEX) {
            e.preventDefault();
            return;
        }
        
        const currentTouchY = e.touches[0].clientY;
        const currentScrollTop = detailPanelWrapper.scrollTop;
        const deltaY = currentTouchY - touchStartY;
        
        if (currentScrollTop === 0 && deltaY > 0 && itineraryDetailContainer.classList.contains('is-scrolled')) {
            e.preventDefault(); 
            itineraryDetailContainer.classList.remove('is-scrolled');
        }
        if (deltaY < 0 && !itineraryDetailContainer.classList.contains('is-scrolled')) {
            itineraryDetailContainer.classList.add('is-scrolled');
        }
    }, { passive: false }); 
    
    detailPanelWrapper.addEventListener('scroll', () => {
        // Ne pas gérer le scroll si on n'est pas au niveau max
        if (currentLevelIndex < BOTTOM_SHEET_EXPANDED_LEVEL_INDEX) {
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

export default {
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
};
