/**
 * Service Worker - Stratégie "Stale-While-Revalidate"
 * 
 * FONCTIONNEMENT:
 * 1. Sert immédiatement depuis le cache (rapide)
 * 2. EN PARALLÈLE, récupère la nouvelle version du réseau
 * 3. Met à jour le cache avec la nouvelle version
 * 4. Au prochain chargement, l'utilisateur a automatiquement la dernière version
 * 
 * IMPORTANT: Incrémentez CACHE_VERSION à chaque déploiement !
 */

const CACHE_VERSION = 'v26'; // ⚠️ INCRÉMENTEZ À CHAQUE DÉPLOIEMENT
const CACHE_NAME = `peribus-cache-${CACHE_VERSION}`;

// Fichiers essentiels pour le mode hors-ligne
const OFFLINE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/js/main.js',
  '/js/dataManager.js',
  '/js/mapRenderer.js',
  '/js/router.js',
  '/js/routerWorkerClient.js',
  '/js/geolocationManager.js',
  '/js/busPositionCalculator.js',
  '/js/tripScheduler.js',
  '/js/timeManager.js',
  '/js/apiManager.js',
  '/js/stopTimesStore.js',
  '/js/crowdsourcing.js',
  '/js/uiManager.js',
  '/js/viewLoader.js',
  '/js/config.js',
  '/js/constants.js',
  // Modules refactorisés
  '/js/config/icons.js',
  '/js/config/routes.js',
  '/js/utils/formatters.js',
  '/js/utils/geo.js',
  '/js/utils/polyline.js',
  '/js/itinerary/ranking.js',
  '/js/ui/resultsRenderer.js',
  '/js/ui/detailRenderer.js',
  '/js/ui/popoverManager.js',
  '/js/controllers/bottomSheetController.js',
  '/js/controllers/viewController.js',
  '/js/state/appState.js',
  '/js/modules/index.js',
  '/css/crowdsourcing.css',
  '/manifest.json'
];

// Fichiers à toujours récupérer du réseau (jamais en cache)
const NETWORK_ONLY = [
  '/api/',
  'google',
  'googleapis'
];

/**
 * Installation: Pré-cache les assets essentiels
 * skipWaiting() force l'activation immédiate
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installation version', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(OFFLINE_ASSETS))
      .then(() => self.skipWaiting()) // ✅ Active immédiatement le nouveau SW
      .catch((error) => {
        console.warn('[SW] Erreur installation cache:', error);
      })
  );
});

/**
 * Activation: Nettoie les anciens caches et prend le contrôle
 * clients.claim() applique le nouveau SW à tous les onglets ouverts
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation version', CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(
          keys.map((key) => {
            // Supprime TOUS les anciens caches
            if (key !== CACHE_NAME) {
              console.log('[SW] Suppression ancien cache:', key);
              return caches.delete(key);
            }
            return null;
          })
        );
      })
      .then(() => self.clients.claim()) // ✅ Prend le contrôle immédiatement
  );
});

/**
 * Fetch: Stratégie "Stale-While-Revalidate"
 * - Retourne le cache immédiatement (si disponible)
 * - Met à jour le cache en arrière-plan avec la version réseau
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;
  
  // Ignorer les requêtes externes
  if (url.origin !== self.location.origin) return;
  
  // Network-only pour les APIs et services externes
  if (NETWORK_ONLY.some(pattern => request.url.includes(pattern))) {
    event.respondWith(fetch(request));
    return;
  }

  // Stratégie Stale-While-Revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(request).then((cachedResponse) => {
        // Fetch réseau en arrière-plan (toujours, même si cache existe)
        const networkFetch = fetch(request)
          .then((networkResponse) => {
            // Mettre à jour le cache avec la nouvelle version
            if (networkResponse.ok) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch((err) => {
            console.warn('[SW] Erreur réseau pour:', request.url);
            return null;
          });

        // Retourner le cache immédiatement, ou attendre le réseau
        return cachedResponse || networkFetch || caches.match('/index.html');
      });
    })
  );
});

/**
 * Message: Permet de forcer une mise à jour depuis l'app
 */
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearCache') {
    caches.keys().then((keys) => {
      keys.forEach((key) => caches.delete(key));
    });
  }
});
