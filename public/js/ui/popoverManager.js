/**
 * popoverManager.js - Gestion centralisée des popovers
 * 
 * Ce module gère l'affichage, le positionnement et la fermeture
 * des popovers de l'application (arrêts intermédiaires).
 */

// === État des popovers ===

let currentPopover = null;
let currentMapForPopover = null;

// === Gestionnaire de fermeture au clic extérieur ===

let outsideClickHandler = null;

function setupOutsideClickHandler() {
    if (outsideClickHandler) return;
    
    outsideClickHandler = (e) => {
        if (currentPopover && !currentPopover.getElement().contains(e.target)) {
            closeCurrentPopover();
        }
    };
    
    document.addEventListener('click', outsideClickHandler, { capture: true });
}

function removeOutsideClickHandler() {
    if (outsideClickHandler) {
        document.removeEventListener('click', outsideClickHandler, { capture: true });
        outsideClickHandler = null;
    }
}

// === Fonctions publiques ===

/**
 * Ferme le popover actuellement ouvert
 */
export function closeCurrentPopover() {
    if (currentPopover) {
        currentPopover.remove();
        currentPopover = null;
        currentMapForPopover = null;
    }
}

/**
 * Vérifie si un popover est actuellement ouvert
 * @returns {boolean}
 */
export function hasActivePopover() {
    return currentPopover !== null;
}

/**
 * Récupère la référence du popover actuel
 * @returns {maplibregl.Popup|null}
 */
export function getCurrentPopover() {
    return currentPopover;
}

/**
 * Crée et affiche un popover d'arrêts intermédiaires sur la carte
 * @param {Object} options - Options du popover
 * @param {Object} options.map - Instance maplibregl.Map
 * @param {Array} options.coordinates - Coordonnées [lng, lat]
 * @param {string} options.htmlContent - Contenu HTML du popover
 * @param {Object} options.maplibregl - Référence à la librairie maplibregl
 * @param {string} [options.className] - Classe CSS additionnelle
 */
export function showIntermediateStopsPopover({ map, coordinates, htmlContent, maplibregl, className = '' }) {
    // Fermer le popover existant s'il y en a un
    closeCurrentPopover();
    
    if (!map || !coordinates || !htmlContent || !maplibregl) {
        console.warn('[PopoverManager] Paramètres manquants pour afficher le popover');
        return null;
    }
    
    // Créer le nouveau popover
    currentPopover = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        className: `intermediate-stops-popup ${className}`.trim(),
        maxWidth: '300px',
        offset: [0, -10]
    })
    .setLngLat(coordinates)
    .setHTML(htmlContent)
    .addTo(map);
    
    currentMapForPopover = map;
    
    // Setup du gestionnaire de clic extérieur
    setupOutsideClickHandler();
    
    // Gestion de la fermeture via le bouton
    currentPopover.on('close', () => {
        currentPopover = null;
        currentMapForPopover = null;
    });
    
    return currentPopover;
}

/**
 * Met à jour le contenu d'un popover existant
 * @param {string} htmlContent - Nouveau contenu HTML
 */
export function updatePopoverContent(htmlContent) {
    if (currentPopover) {
        currentPopover.setHTML(htmlContent);
    }
}

/**
 * Repositionne le popover sur de nouvelles coordonnées
 * @param {Array} coordinates - Nouvelles coordonnées [lng, lat]
 */
export function updatePopoverPosition(coordinates) {
    if (currentPopover && coordinates) {
        currentPopover.setLngLat(coordinates);
    }
}

/**
 * Crée le contenu HTML pour un popover d'arrêts intermédiaires
 * @param {Array} stops - Liste des arrêts intermédiaires
 * @param {Object} step - Étape du trajet
 * @returns {string} - HTML du popover
 */
export function createIntermediateStopsHtml(stops, step) {
    if (!stops || stops.length === 0) {
        return '<div class="popover-empty">Aucun arrêt intermédiaire</div>';
    }
    
    const stopCount = stops.length;
    const routeShortName = step?.transitDetails?.transitLine?.nameShort || 
                           step?.transitDetails?.transitLine?.name || 
                           'Bus';
    const routeColor = step?.transitDetails?.transitLine?.color || '#666';
    
    let html = `
        <div class="intermediate-stops-content">
            <div class="popover-header">
                <span class="route-badge" style="background-color: ${routeColor}">
                    ${routeShortName}
                </span>
                <span class="stop-count">${stopCount} arrêt${stopCount > 1 ? 's' : ''}</span>
            </div>
            <ul class="stops-list">
    `;
    
    stops.forEach((stop, index) => {
        const stopName = stop.name || stop.stopName || `Arrêt ${index + 1}`;
        html += `<li class="stop-item">${stopName}</li>`;
    });
    
    html += `
            </ul>
        </div>
    `;
    
    return html;
}

/**
 * Nettoyage complet - à appeler lors du changement de vue
 */
export function cleanup() {
    closeCurrentPopover();
    removeOutsideClickHandler();
}

export default {
    closeCurrentPopover,
    hasActivePopover,
    getCurrentPopover,
    showIntermediateStopsPopover,
    updatePopoverContent,
    updatePopoverPosition,
    createIntermediateStopsHtml,
    cleanup
};
