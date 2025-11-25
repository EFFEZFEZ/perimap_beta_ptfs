const CACHE_NAME = 'peribus-cache-v1';
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
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_ASSETS)).catch((error) => {
      console.warn('Service worker install cache error', error);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return null;
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request)
        .then((networkResponse) => {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return networkResponse;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});
