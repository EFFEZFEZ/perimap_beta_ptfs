/**
 * config.js
 * Centralise la récupération de configuration runtime (clé API Google, flags, etc.).
 * Aucun hardcode sensible : la clé est lue soit via variable globale, soit via <meta>.
 * Priorité:
 * 1. window.__APP_CONFIG.googleApiKey
 * 2. <meta name="peribus-api-key" content="...">
 * 3. (optionnel) variable d'environnement injectée côté build (placeholder remplacé)
 */

export function getGoogleApiKey() {
  // 1. Objet global (ex: défini avant chargement des modules):
  if (typeof window !== 'undefined' && window.__APP_CONFIG && window.__APP_CONFIG.googleApiKey) {
    return window.__APP_CONFIG.googleApiKey;
  }
  // 2. Meta tag
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="peribus-api-key"]');
    if (meta && meta.content && meta.content.trim()) {
      return meta.content.trim();
    }
  }
  // 3. Aucune clé trouvée - warning explicite
  console.warn('[config] Aucune clé API Google trouvée. Définissez window.__APP_CONFIG.googleApiKey ou ajoutez <meta name="peribus-api-key" content="VOTRE_CLE">.');
  return '';
}

/**
 * Récupère le token admin (fourni par Vercel via variable d'environnement ou injection runtime).
 * Priorité:
 * 1. window.__ADMIN_TOKEN (injection serveur dans index.html)
 * 2. window.__APP_CONFIG.adminToken (injection runtime côté client)
 * 3. <meta name="peribus-admin-token" content="..."> (optionnel)
 * 4. import.meta.env.VITE_ADMIN_TOKEN ou process.env.VITE_ADMIN_TOKEN
 */
export function getAdminToken() {
  if (typeof window !== 'undefined' && window.__ADMIN_TOKEN) {
    return window.__ADMIN_TOKEN;
  }
  if (typeof window !== 'undefined' && window.__APP_CONFIG && window.__APP_CONFIG.adminToken) {
    return window.__APP_CONFIG.adminToken;
  }
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="peribus-admin-token"]');
    if (meta && meta.content && meta.content.trim()) {
      return meta.content.trim();
    }
  }
  // Try import.meta.env for Vite builds
  try {
    if (typeof import !== 'undefined' && import.meta && import.meta.env) {
      return import.meta.env.VITE_ADMIN_TOKEN || '';
    }
  } catch (e) {
    // Fallback silently
  }
  return '';
}

export function getAppConfig() {
  return {
    googleApiKey: getGoogleApiKey(),
    arrivalPageSize: 6,
    minBusItineraries: 3,
    maxBottomSheetLevels: 3,
    adminToken: getAdminToken()
  };
}
