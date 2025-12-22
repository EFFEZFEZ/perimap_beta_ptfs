/**
 * config.js
 * Centralise la configuration runtime pour le backend auto-hébergé.
 * 
 * Backend: OpenTripPlanner + Photon + GTFS-RT
 * - /api/routes : OTP (itinéraires multimodaux)
 * - /api/places : Photon (géocodage et autocomplétion)
 * - /api/realtime : GTFS-RT (positions des bus en temps réel)
 */

/**
 * Récupère le token admin pour GitHub API
 * @returns {string} Le token ou chaîne vide
 */
export function getAdminToken() {
  // 1. Variable globale injectée (Vercel/index.html)
  if (window.__ADMIN_TOKEN && window.__ADMIN_TOKEN !== '__VITE_ADMIN_TOKEN__') {
    return window.__ADMIN_TOKEN;
  }
  // 2. Objet config global
  if (window.__APP_CONFIG && window.__APP_CONFIG.adminToken) {
    return window.__APP_CONFIG.adminToken;
  }
  // 3. Meta tag
  const meta = document.querySelector('meta[name="peribus-admin-token"]');
  if (meta && meta.content && meta.content.trim()) {
    return meta.content.trim();
  }
  return '';
}

/**
 * URLs des endpoints du backend auto-hébergé
 */
export const API_ENDPOINTS = {
    routes: '/api/routes',
    places: '/api/places',
    realtime: '/api/realtime'
};

/**
 * Détermine si les logs debug doivent être affichés.
 * Objectif: garder un front silencieux en prod, tout en conservant les traces en local.
 */
export function isDebugEnabled() {
  // 1) Config globale (override explicite)
  if (window.__APP_CONFIG && typeof window.__APP_CONFIG.debug === 'boolean') {
    return window.__APP_CONFIG.debug;
  }

  // 2) Query param (debug=1)
  try {
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('debug') === '1') return true;
  } catch {
    // ignore
  }

  // 3) Par défaut: activé uniquement en local
  const host = (window.location && window.location.hostname) ? window.location.hostname : '';
  return host === 'localhost' || host === '127.0.0.1';
}

/**
 * Retourne la configuration globale de l'application
 * @returns {Object} Configuration avec adminToken, endpoints backend, etc.
 */
export function getAppConfig() {
  return {
    adminToken: getAdminToken(),
    apiEndpoints: API_ENDPOINTS,
    debug: isDebugEnabled(),
    // GTFS remote fallback (désactivé par défaut)
    // Permet (si besoin) de recharger shapes.txt depuis une source externe.
    // Ex: window.__APP_CONFIG = { allowRemoteGtfs: true, remoteGtfsBaseUrl: 'https://.../public/data/gtfs' }
    allowRemoteGtfs: !!(window.__APP_CONFIG && window.__APP_CONFIG.allowRemoteGtfs === true),
    remoteGtfsBaseUrl: (window.__APP_CONFIG && typeof window.__APP_CONFIG.remoteGtfsBaseUrl === 'string')
      ? window.__APP_CONFIG.remoteGtfsBaseUrl
      : '',
    arrivalPageSize: 6,
    minBusItineraries: 3,
    maxBottomSheetLevels: 3
  };
}
