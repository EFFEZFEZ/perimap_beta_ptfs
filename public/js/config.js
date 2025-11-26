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
  // 3. Placeholder (déclenche warning explicite si non remplacé)
  const placeholder = process?.env?.PERIBUS_GOOGLE_API_KEY || '';
  if (placeholder) return placeholder;
  console.warn('[config] Aucune clé API Google trouvée. Les fonctionnalités cartographiques/itinéraires échoueront.');
  return '';
}

export function getAppConfig() {
  return {
    googleApiKey: getGoogleApiKey(),
    arrivalPageSize: 5,
    maxBottomSheetLevels: 3
  };
}
