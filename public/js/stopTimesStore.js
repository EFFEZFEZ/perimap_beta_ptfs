const DB_NAME = 'peribus_stop_times_store';
const STORE_NAME = 'stopTimesByTrip';
const DB_VERSION = 1;

export class StopTimesStore {
    constructor(maxCacheEntries = 300) {
        this.maxCacheEntries = maxCacheEntries;
        this.cache = new Map();
        this.dbPromise = null;
    }

    hasIndexedDb() {
        return typeof indexedDB !== 'undefined';
    }

    async getDb() {
        if (this.dbPromise) return this.dbPromise;
        if (!this.hasIndexedDb()) {
            this.dbPromise = Promise.resolve(null);
            return this.dbPromise;
        }
        this.dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }).catch((error) => {
            console.warn('StopTimesStore: IndexedDB indisponible', error);
            return null;
        });
        return this.dbPromise;
    }

    async seedFromTripMap(stopTimesByTrip = {}) {
        const entries = Object.entries(stopTimesByTrip);
        if (!entries.length) return;
        const db = await this.getDb();
        if (!db) {
            this.cacheFromEntries(entries);
            return;
        }
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            entries.forEach(([tripId, list]) => {
                store.put(list, tripId);
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        }).catch((error) => {
            console.warn('StopTimesStore: écriture IndexedDB impossible', error);
        });
        this.cacheFromEntries(entries);
    }

    cacheFromEntries(entries) {
        if (!Array.isArray(entries)) return;
        entries.slice(0, this.maxCacheEntries).forEach(([tripId, list]) => {
            this.setCache(tripId, list);
        });
    }

    setCache(tripId, list) {
        if (this.cache.has(tripId)) {
            this.cache.delete(tripId);
        } else if (this.cache.size >= this.maxCacheEntries) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }
        this.cache.set(tripId, list);
    }

    touch(tripId) {
        if (!this.cache.has(tripId)) return;
        const value = this.cache.get(tripId);
        this.cache.delete(tripId);
        this.cache.set(tripId, value);
    }

    getCached(tripId) {
        const cached = this.cache.get(tripId);
        if (cached) this.touch(tripId);
        return cached || null;
    }

    async get(tripId) {
        const cached = this.getCached(tripId);
        if (cached) return cached;
        const db = await this.getDb();
        if (!db) return null;
        const entry = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(tripId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        }).catch((error) => {
            console.warn('StopTimesStore: lecture IndexedDB impossible', error);
            return null;
        });
        if (entry) {
            this.setCache(tripId, entry);
        }
        return entry;
    }
}
