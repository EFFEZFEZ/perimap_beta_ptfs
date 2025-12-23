/*
 * Copyright (c) 2025 Périmap. Tous droits réservés.
 * Ce code ne peut être ni copié, ni distribué, ni modifié sans l'autorisation écrite de l'auteur.
 */
/**
 * Service Worker - Stratégie optimisée pour performance
 * 
 * STRATÉGIES:
 * - Cache-First pour assets statiques (CSS, JS, images)
 * - Stale-While-Revalidate pour données GTFS
 * - Network-First pour APIs externes
 * 
 * IMPORTANT: Incrémentez CACHE_VERSION à chaque déploiement !
 */

const CACHE_VERSION = 'v252'; // ⚠️ INCRÉMENTEZ À CHAQUE DÉPLOIEMENT - V252: texte bandeau défile sur petits écrans
const CACHE_NAME = `peribus-cache-${CACHE_VERSION}`;
const STATIC_CACHE = `peribus-static-${CACHE_VERSION}`;
const DATA_CACHE = `peribus-data-${CACHE_VERSION}`;

// Assets critiques à pré-cacher (chargés immédiatement)
const CRITICAL_ASSETS = [
  '/',
  '/index.html',
  '/horaires.html',
  '/horaires-ligne-a.html',
  '/horaires-ligne-b.html',
  '/horaires-ligne-c.html',
  '/horaires-ligne-d.html',
  '/itineraire.html',
  '/trafic.html',
  '/carte.html',
  '/about.html',
  '/mentions-legales.html',
  '/style.css',
  '/js/app.js',
  '/manifest.json',
  '/robots.txt',
  '/sitemap.xml'
];

// Assets secondaires (chargés en arrière-plan)
const SECONDARY_ASSETS = [
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
  '/js/uiManager.js',
  '/js/viewLoader.js',
  '/js/config.js',
  '/js/config/icons.js',
  '/js/config/routes.js',
  '/js/utils/formatters.js',
  '/js/utils/geo.js',
  '/js/utils/stopName.mjs',
  '/js/utils/tripStopTimes.mjs',
  '/js/utils/polyline.js',
  '/js/utils/gtfsProcessor.js',
  '/js/itinerary/ranking.js',
  '/js/ui/resultsRenderer.js',
  '/js/ui/trafficInfo.js',
  '/js/map/routeDrawing.js',
  '/js/search/itineraryProcessor.js',
  '/js/workers/gtfsWorker.js',
  '/js/workers/routerWorker.js',
  '/views/hall.html',
  '/views/horaires.html',
  '/views/carte.html',
  '/views/itineraire.html',
  '/views/trafic.html'
];

// Patterns pour Network-Only
const NETWORK_ONLY = ['/api/', 'google', 'googleapis', 'ibb.co', 'line-status.json'];

// Patterns pour données GTFS (cache long terme)
const GTFS_PATTERNS = ['/data/gtfs/', '.json', '.txt'];

/**
 * Installation: Pré-cache les assets critiques, puis secondaires
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installation version', CACHE_VERSION);
  event.waitUntil(
    (async () => {
      // Cache critique en priorité
      const staticCache = await caches.open(STATIC_CACHE);
      await staticCache.addAll(CRITICAL_ASSETS);
      console.log('[SW] Assets critiques cachés');
      
      // Cache secondaire en arrière-plan (non-bloquant)
      staticCache.addAll(SECONDARY_ASSETS).catch(err => {
        console.warn('[SW] Certains assets secondaires non cachés:', err);
      });
      
      await self.skipWaiting();
    })()
  );
});

/**
 * Activation: Nettoie les anciens caches
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation version', CACHE_VERSION);
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map(key => {
          if (!key.includes(CACHE_VERSION)) {
            console.log('[SW] Suppression cache obsolète:', key);
            return caches.delete(key);
          }
        })
      );
      await self.clients.claim();
    })()
  );
});

/**
 * Fetch: Stratégies différenciées selon le type de ressource
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Ignorer non-GET
  if (request.method !== 'GET') return;

  // Ne jamais tenter de cacher des schémas non supportés (ex: chrome-extension://)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    event.respondWith(fetch(request));
    return;
  }

  // Network-first pour les navigations (évite HTML nouveau + JS ancien)
  // On garde un fallback offline vers index.html si le réseau échoue.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }
  
  // Network-only pour APIs externes
  if (NETWORK_ONLY.some(p => request.url.includes(p))) {
    event.respondWith(fetch(request).catch(() => new Response('', { status: 503 })));
    return;
  }
  
  // Stale-While-Revalidate pour assets statiques (JS, CSS)
  // Objectif: site réactif + mise à jour progressive sans "mix" sur HTML.
  if (url.origin === self.location.origin &&
      (request.url.endsWith('.js') || request.url.endsWith('.css'))) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }
  
  // Stale-While-Revalidate pour données GTFS
  if (GTFS_PATTERNS.some(p => request.url.includes(p))) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }
  
  // Par défaut: Stale-While-Revalidate
  event.respondWith(staleWhileRevalidate(request, CACHE_NAME));
});

/**
 * Cache-First: Retourne le cache, sinon réseau
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  let cached = null;
  try { cached = await cache.match(request); } catch (e) { cached = null; }
  if (cached) return cached;
  
  try {
    const response = await fetch(request);
    try {
      const u = new URL(request.url);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && response.ok) {
        cache.put(request, response.clone());
      }
    } catch (e) { /* ignore */ }
    return response;
  } catch {
    return caches.match('/index.html');
  }
}

/**
 * Stale-While-Revalidate: Retourne le cache, met à jour en arrière-plan
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  let cached = null;
  try { cached = await cache.match(request); } catch (e) { cached = null; }
  
  // Revalidation en arrière-plan
  const networkPromise = fetch(request)
    .then(response => {
      try {
        const u = new URL(request.url);
        if ((u.protocol === 'http:' || u.protocol === 'https:') && response.ok) {
          cache.put(request, response.clone());
        }
      } catch (e) { /* ignore */ }
      return response;
    })
    .catch(() => null);
  
  return cached || networkPromise || caches.match('/index.html');
}

/**
 * Network-First: tente le réseau, fallback cache, puis fallback index.html
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      try {
        const u = new URL(request.url);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          cache.put(request, response.clone());
        }
      } catch (e) { /* ignore */ }
    }
    return response;
  } catch {
    let cached = null;
    try { cached = await cache.match(request); } catch (e) { cached = null; }
    return cached || caches.match('/index.html');
  }
}

/**
 * Message: Permet de forcer une mise à jour depuis l'app
 */
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'clearCache') {
    caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
  }
});

