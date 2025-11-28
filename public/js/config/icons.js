/**
 * icons.js - Définition centralisée de toutes les icônes SVG
 * 
 * Ce module exporte l'objet ICONS contenant toutes les icônes SVG
 * utilisées dans l'application.
 */

export const ICONS = {
    BUS: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="12" rx="3"/><path d="M4 10h16"/><path d="M6 15v2"/><path d="M18 15v2"/><circle cx="8" cy="19" r="1.5"/><circle cx="16" cy="19" r="1.5"/></svg>`,
    busSmall: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="11" rx="2.5"/><path d="M5 10h14"/><path d="M7 15v2"/><path d="M17 15v2"/><circle cx="9" cy="19" r="1.2"/><circle cx="15" cy="19" r="1.2"/></svg>`,
    statusTriangle: `<svg width="16" height="8" viewBox="0 0 16 8" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M8 0L16 8H0L8 0Z" /></svg>`,
    statusWarning: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
    statusError: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
    BICYCLE: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3.2"/><circle cx="17.5" cy="17" r="3.2"/><path d="M6 17 10 8h3.5l2 5h3"/><path d="M12 8l1.8 9"/><path d="m14 13.5 4 3.5"/></svg>`,
    WALK: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><path d="m9 21 2.2-6.2-2.2-3.8 3-2 3 2 1.2-3.5"/><path d="M13 14.5 16 21"/></svg>`,
    ALL: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27z"/></svg>`,
    LEAF_ICON: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-4-4 1.41-1.41L10 16.17l6.59-6.59L18 11l-8 8z" opacity=".3"/><path d="M17.8 7.29c-.39-.39-1.02-.39-1.41 0L10 13.17l-1.88-1.88c-.39-.39-1.02-.39-1.41 0-.39.39-.39 1.02 0 1.41l2.59 2.59c.39.39 1.02.39 1.41 0L17.8 8.7c.39-.39.39-1.02 0-1.41z" transform="translate(0, 0)" opacity=".1"/><path d="M12 4.14c-4.33 0-7.86 3.53-7.86 7.86s3.53 7.86 7.86 7.86 7.86-3.53 7.86-7.86S16.33 4.14 12 4.14zm5.8 4.57 c0 .28-.11.53-.29.71L12 15.01l-2.59-2.59c-.39-.39-1.02-.39-1.41 0-.39.39-.39 1.02 0 1.41l3.29 3.29c.39.39 1.02.39 1.41 0l6.29-6.29c.18-.18.29-.43.29-.71 0-1.04-1.2-1.57-2-1.57-.42 0-.8.13-1.1.33-.29.2-.6.4-.9.6z" fill="#1e8e3e"/></svg>`,
    GEOLOCATE: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5c0 4.9 6.5 12.5 6.5 12.5s6.5-7.6 6.5-12.5A6.5 6.5 0 0 0 12 2.5Zm0 9.3a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6Z"/></svg>`,
    GEOLOCATE_SPINNER: `<div class="spinner"></div>`,
    MAP_LOCATE: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L7 12l10 0L12 2z"/><circle cx="12" cy="12" r="10"/></svg>`,
    // Icônes de manœuvre pour les étapes de marche
    MANEUVER: {
        STRAIGHT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`,
        TURN_LEFT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>`,
        TURN_RIGHT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4"></polyline><path d="M4 20v-7a4 4 0 0 1 4-4h12"></path></svg>`,
        TURN_SLIGHT_LEFT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M17 5 9 13v7"></path><path d="m8 18 4-4"></path></svg>`,
        TURN_SLIGHT_RIGHT: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21 3-5 5"/><path d="M21 3v8h-8"/><path d="m3 21 5.5-5.5"/></svg>`,
        ROUNDABOUT_LEFT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 9.5c.1-.4.5-.8.9-1s1-.3 1.5-.3c.7 0 1.3.1 1.9.4c.6.3 1.1.7 1.5 1.1c.4.5.7 1 .8 1.7c.1.6.1 1.3 0 1.9c-.2.7-.4 1.3-.8 1.8c-.4.5-1 1-1.6 1.3c-.6.3-1.3.5-2.1.5c-.6 0-1.1-.1-1.6-.2c-.5-.1-1-.4-1.4-.7c-.4-.3-.7-.7-.9-1.1"></path><path d="m7 9 3-3 3 3"></path><circle cx="12" cy="12" r="10"></circle></svg>`,
        ROUNDABOUT_RIGHT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9.5c-.1-.4-.5-.8-.9-1s-1-.3-1.5-.3c-.7 0-1.3.1-1.9.4c-.6.3-1.1.7-1.5 1.1c-.4.5-.7 1-.8 1.7c-.1.6-.1 1.3 0 1.9c.2.7.4 1.3.8 1.8c.4.5 1 1 1.6 1.3c.6.3 1.3.5 2.1.5c.6 0 1.1-.1 1.6-.2c.5-.1 1-.4 1.4-.7c.4-.3.7-.7-.9-1.1"></path><path d="m17 9-3-3-3 3"></path><circle cx="12" cy="12" r="10"></circle></svg>`,
        DEFAULT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="m12 16 4-4-4-4"></path><path d="M8 12h8"></path></svg>`
    }
};

// Icônes pour le bandeau d'alerte
export const ALERT_BANNER_ICONS = {
    annulation: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    retard: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
    default: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
};

/**
 * Récupère l'icône de manœuvre appropriée
 * @param {string} maneuver - Type de manœuvre
 * @returns {string} - HTML de l'icône SVG
 */
export function getManeuverIcon(maneuver) {
    switch(maneuver) {
        case 'TURN_LEFT': return ICONS.MANEUVER.TURN_LEFT;
        case 'TURN_RIGHT': return ICONS.MANEUVER.TURN_RIGHT;
        case 'TURN_SLIGHT_LEFT': return ICONS.MANEUVER.TURN_SLIGHT_LEFT;
        case 'TURN_SLIGHT_RIGHT': return ICONS.MANEUVER.TURN_SLIGHT_RIGHT;
        case 'ROUNDABOUT_LEFT': return ICONS.MANEUVER.ROUNDABOUT_LEFT;
        case 'ROUNDABOUT_RIGHT': return ICONS.MANEUVER.ROUNDABOUT_RIGHT;
        case 'STRAIGHT': return ICONS.MANEUVER.STRAIGHT;
        default: return ICONS.MANEUVER.DEFAULT;
    }
}

/**
 * Récupère l'icône d'alerte appropriée pour le bandeau
 * @param {string} type - Type d'alerte (annulation, retard, etc.)
 * @returns {string} - HTML de l'icône SVG
 */
export function getAlertBannerIcon(type) {
    if (!type) {
        return ALERT_BANNER_ICONS.default;
    }
    return ALERT_BANNER_ICONS[type] || ALERT_BANNER_ICONS.default;
}

export default ICONS;
