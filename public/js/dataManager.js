import { cleanDataset, buildGtfsIndexes } from './utils/gtfsProcessor.js';
import { StopTimesStore } from './stopTimesStore.js';
import { getAppConfig } from './config.js';

/**
 * dataManager.js - CORRECTION V39
 * 1. Ajout de routesById/stopsById dans le constructeur (Fix Bug Fatal)
 * 2. Remplacement de getIntermediateStops par la version V39
 * (matching flexible des noms)
 */

const GTFS_CACHE_KEY = 'peribus_gtfs_cache_v2';
const GTFS_CACHE_VERSION = '2.11.0';  // V110: Fix mode arriver (filtrage sur heure d'arrivée)
const GTFS_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 heures (augmenté pour moins de rechargements)
const GTFS_CACHE_META_KEY = 'peribus_gtfs_cache_meta';
const GTFS_CACHE_DB = 'peribus_gtfs_cache_db';
const GTFS_CACHE_STORE = 'datasets';
// Fallback GTFS distant (désactivé par défaut, voir config.js)
const DEFAULT_REMOTE_GTFS_BASE_URL = '';

const DEBUG = (() => {
    try {
        return !!getAppConfig()?.debug;
    } catch {
        return false;
    }
})();

const debugLog = (...args) => {
    if (DEBUG) console.log(...args);
};

// Performance: requestIdleCallback polyfill pour navigateurs anciens
const scheduleIdleTask = typeof requestIdleCallback !== 'undefined' 
    ? requestIdleCallback 
    : (fn) => setTimeout(fn, 1);
export class DataManager {
    constructor() {
        const appConfig = getAppConfig();
        this.routes = [];
        this.trips = [];
        this.stopTimes = [];
        this.stops = [];
        this.geoJson = null;
        this.isLoaded = false;
        
        this.calendar = [];
        this.calendarDates = [];
        this.shapes = [];
        this.routeGeometriesById = {};
        this._shapesIndexPromise = null;
        this.allowRemoteGtfs = !!appConfig?.allowRemoteGtfs;
        this.remoteGtfsBaseUrl = (this.allowRemoteGtfs && appConfig?.remoteGtfsBaseUrl)
            ? String(appConfig.remoteGtfsBaseUrl)
            : DEFAULT_REMOTE_GTFS_BASE_URL;

        this.masterStops = []; 
        this.groupedStopMap = {}; 

        this.stopTimesByStop = {}; 
        this.tripsByTripId = {};
        this.stopTimesByTrip = {};
        this.shapesById = {};
        
        // ✅ CORRECTIF 1 : AJOUT DE CES LIGNES
        this.routesById = {};
        this.stopsById = {};
        
        // Nouveaux index pour la recherche
        this.routesByShortName = {};
        this.stopsByName = {};
        this.tripsByRoute = {};

        this.cacheKey = GTFS_CACHE_KEY;
        this.cacheVersion = GTFS_CACHE_VERSION;
        this.cacheTtlMs = GTFS_CACHE_TTL_MS;
        this.cacheMetaKey = GTFS_CACHE_META_KEY;
        this.cacheDbPromise = null;
        this.stopTimesStore = null;

        // Lazy-built index for calendar_dates (date -> { added:Set, removed:Set })
        this._calendarDatesIndex = null;

        // Baseline signatures (most common) to detect "horaires adaptés" even without exceptions
        this._baselineSignatures = null;
        this._baselineComputedAt = null;
    }

    _toGtfsDateString(date) {
        const d = date instanceof Date ? date : new Date(date);
        return d.getFullYear() +
            String(d.getMonth() + 1).padStart(2, '0') +
            String(d.getDate()).padStart(2, '0');
    }

    _ensureCalendarDatesIndex() {
        if (this._calendarDatesIndex) return;
        const index = new Map();
        for (const row of (this.calendarDates || [])) {
            const date = row?.date;
            const serviceId = row?.service_id;
            const exceptionType = row?.exception_type;
            if (!date || !serviceId || !exceptionType) continue;
            let entry = index.get(date);
            if (!entry) {
                entry = { added: new Set(), removed: new Set() };
                index.set(date, entry);
            }
            if (exceptionType === '1' || exceptionType === 1) entry.added.add(serviceId);
            if (exceptionType === '2' || exceptionType === 2) entry.removed.add(serviceId);
        }
        this._calendarDatesIndex = index;
    }

    getCalendarExceptionsForDate(date) {
        this._ensureCalendarDatesIndex();
        const dateString = this._toGtfsDateString(date);
        const entry = this._calendarDatesIndex?.get(dateString);
        const addedCount = entry?.added?.size || 0;
        const removedCount = entry?.removed?.size || 0;
        return {
            dateString,
            addedCount,
            removedCount,
            hasAny: (addedCount + removedCount) > 0
        };
    }

    getServiceSignature(date) {
        const serviceIds = Array.from(this.getServiceIds(date) || []);
        serviceIds.sort();
        return serviceIds.join('|');
    }

    _getDayKind(date) {
        const d = date instanceof Date ? date : new Date(date);
        const day = d.getDay();
        return (day === 0 || day === 6) ? 'weekend' : 'weekday';
    }

    _parseGtfsDateString(dateString) {
        if (!dateString || typeof dateString !== 'string' || dateString.length !== 8) return null;
        const y = Number(dateString.slice(0, 4));
        const m = Number(dateString.slice(4, 6));
        const d = Number(dateString.slice(6, 8));
        if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
        return new Date(y, m - 1, d);
    }

    _getGtfsDateBounds() {
        const allStarts = [];
        const allEnds = [];
        for (const row of (this.calendar || [])) {
            if (row?.start_date) allStarts.push(String(row.start_date));
            if (row?.end_date) allEnds.push(String(row.end_date));
        }
        allStarts.sort();
        allEnds.sort();
        const minStart = allStarts.length ? this._parseGtfsDateString(allStarts[0]) : null;
        const maxEnd = allEnds.length ? this._parseGtfsDateString(allEnds[allEnds.length - 1]) : null;
        return { minStart, maxEnd };
    }

    /**
     * Calcule des signatures "référence" (weekday/weekend) à partir des prochains jours.
     * Sert à détecter une période "adaptée" même si calendar_dates est vide.
     */
    ensureBaselineSignatures({ horizonDays = 90 } = {}) {
        const now = new Date();
        const last = this._baselineComputedAt ? new Date(this._baselineComputedAt) : null;
        const lastKey = last ? this._toGtfsDateString(last) : null;
        const nowKey = this._toGtfsDateString(now);
        if (this._baselineSignatures && lastKey === nowKey) return this._baselineSignatures;

        const { maxEnd } = this._getGtfsDateBounds();
        const endLimit = new Date(now);
        endLimit.setDate(now.getDate() + Math.max(7, horizonDays));
        const scanEnd = (maxEnd && maxEnd < endLimit) ? maxEnd : endLimit;

        const freq = { weekday: new Map(), weekend: new Map() };
        const cursor = new Date(now);
        cursor.setHours(0, 0, 0, 0);
        const end = new Date(scanEnd);
        end.setHours(0, 0, 0, 0);

        while (cursor <= end) {
            const kind = this._getDayKind(cursor);
            const exceptions = this.getCalendarExceptionsForDate(cursor);
            const signature = this.getServiceSignature(cursor);
            // On ignore les jours vides et ceux avec exceptions pour construire une référence "standard"
            if (signature && !exceptions.hasAny) {
                const map = freq[kind];
                map.set(signature, (map.get(signature) || 0) + 1);
            }
            cursor.setDate(cursor.getDate() + 1);
        }

        const pickMode = (map) => {
            let best = '';
            let bestCount = 0;
            for (const [sig, count] of map.entries()) {
                if (count > bestCount) {
                    best = sig;
                    bestCount = count;
                }
            }
            return best;
        };

        this._baselineSignatures = {
            weekday: pickMode(freq.weekday),
            weekend: pickMode(freq.weekend)
        };
        this._baselineComputedAt = new Date();
        return this._baselineSignatures;
    }

    getDayScheduleClassification(date) {
        const d = date instanceof Date ? date : new Date(date);
        const signature = this.getServiceSignature(d);
        const exceptions = this.getCalendarExceptionsForDate(d);
        const kind = this._getDayKind(d);
        const baseline = this.ensureBaselineSignatures();
        const baselineSig = baseline?.[kind] || '';

        if (!signature) {
            return {
                type: 'no-service',
                label: 'Aucun service',
                message: 'Aucun transport prévu aujourd\'hui (calendrier GTFS).',
                signature,
                kind,
                exceptions
            };
        }

        if (exceptions.hasAny) {
            return {
                type: 'adapted',
                label: 'Horaires adaptés',
                message: 'Période spéciale (vacances, jours fériés, événements) : vérifiez vos horaires.',
                signature,
                kind,
                exceptions
            };
        }

        // Si la signature diffère de la signature "référence" du même type de jour
        if (baselineSig && baselineSig !== signature) {
            return {
                type: 'adapted',
                label: 'Horaires adaptés',
                message: 'Horaires différents de la période habituelle : vérifiez vos horaires (vacances / période spéciale).',
                signature,
                kind,
                exceptions
            };
        }

        return {
            type: 'standard',
            label: 'Horaires du jour',
            message: 'Horaires standard (selon calendrier).',
            signature,
            kind,
            exceptions
        };
    }

    /**
     * Décrit la "période horaires" en se basant STRICTEMENT sur GTFS:
     * - calendar.txt (services réguliers)
     * - calendar_dates.txt (exceptions: fériés/vacances/événements)
     */
    getSchedulePeriodInfo(date) {
        const d = date instanceof Date ? date : new Date(date);
        const classification = this.getDayScheduleClassification(d);
        const exceptions = classification.exceptions;
        const signatureToday = classification.signature;

        const yesterday = new Date(d);
        yesterday.setDate(d.getDate() - 1);
        const tomorrow = new Date(d);
        tomorrow.setDate(d.getDate() + 1);

        const signatureYesterday = this.getServiceSignature(yesterday);
        const signatureTomorrow = this.getServiceSignature(tomorrow);

        const changedFromYesterday = signatureYesterday !== signatureToday;
        const changesTomorrow = signatureTomorrow !== signatureToday;

        // Si on est sur standard mais qu'il y a un changement autour, on remonte un état "transition"
        if (classification.type === 'standard' && (changedFromYesterday || changesTomorrow)) {
            return {
                type: 'transition',
                label: 'Changement de période',
                message: 'Les horaires changent (période en cours différente) : pensez à vérifier.',
                dateString: exceptions.dateString,
                changedFromYesterday,
                changesTomorrow,
                exceptions
            };
        }

        return {
            type: classification.type,
            label: classification.label,
            message: classification.message,
            dateString: exceptions.dateString,
            changedFromYesterday,
            changesTomorrow,
            exceptions
        };
    }

    getUpcomingNonStandardSchedulePeriods(fromDate, { maxItems = 2, horizonDays = 120 } = {}) {
        const start = fromDate instanceof Date ? new Date(fromDate) : new Date(fromDate || Date.now());
        start.setHours(0, 0, 0, 0);

        const { maxEnd } = this._getGtfsDateBounds();
        const endLimit = new Date(start);
        endLimit.setDate(start.getDate() + Math.max(14, horizonDays));
        const scanEnd = (maxEnd && maxEnd < endLimit) ? maxEnd : endLimit;
        scanEnd.setHours(0, 0, 0, 0);

        const items = [];
        let cursor = new Date(start);
        cursor.setDate(cursor.getDate() + 1); // commence demain

        while (cursor <= scanEnd && items.length < maxItems) {
            const info = this.getDayScheduleClassification(cursor);
            if (info.type === 'standard') {
                cursor.setDate(cursor.getDate() + 1);
                continue;
            }

            const periodStart = new Date(cursor);
            let periodEnd = new Date(cursor);
            // Étendre tant que le type reste identique ET que les exceptions restent cohérentes
            while (true) {
                const next = new Date(periodEnd);
                next.setDate(next.getDate() + 1);
                if (next > scanEnd) break;
                const nextInfo = this.getDayScheduleClassification(next);
                const sameType = nextInfo.type === info.type;
                const sameExceptionsShape = (nextInfo.exceptions?.hasAny || false) === (info.exceptions?.hasAny || false);
                if (!sameType || !sameExceptionsShape) break;
                periodEnd = next;
            }

            items.push({
                type: info.type,
                label: info.label,
                start: periodStart,
                end: periodEnd,
                message: info.message,
                exceptions: info.exceptions
            });

            cursor = new Date(periodEnd);
            cursor.setDate(cursor.getDate() + 1);
        }

        return items;
    }

    async loadAllData(onProgress) {
        const startTime = performance.now();
        try {
            // Tenter de restaurer depuis le cache en premier (instantané)
            const cached = await this.restoreCache();
            if (cached) {
                const cacheTime = performance.now() - startTime;
                debugLog(`⚡ GTFS cache utilisé en ${cacheTime.toFixed(0)}ms`);
                this.applyLoadedData(cached);
                this.isLoaded = true;
                return true;
            }

            // Chargement via Worker (plus rapide, ne bloque pas le thread principal)
            if (typeof Worker !== 'undefined') {
                try {
                    const workerPayload = await this.loadViaWorker(onProgress);
                    this.applyLoadedData(workerPayload);
                    // Sauvegarder le cache en arrière-plan (non-bloquant)
                    scheduleIdleTask(() => this.saveCache(workerPayload));
                    this.isLoaded = true;
                    const totalTime = performance.now() - startTime;
                    debugLog(`✅ GTFS chargé via Worker en ${totalTime.toFixed(0)}ms`);
                    return true;
                } catch (workerError) {
                    console.warn('GTFS worker indisponible, fallback inline.', workerError);
                }
            }

            // Fallback: chargement inline
            const freshPayload = await this.loadInline(onProgress);
            this.applyLoadedData(freshPayload);
            scheduleIdleTask(() => this.saveCache(freshPayload));
            this.isLoaded = true;
        } catch (error) {
            console.error('❌ Erreur fatale:', error);
            this.showError('Erreur de chargement', 'Vérifiez les fichiers GTFS dans /public/data/gtfs/');
            this.isLoaded = false;
        }
        return this.isLoaded;
    }

    async loadViaWorker(onProgress) {
        return new Promise((resolve, reject) => {
            const workerUrl = new URL('./workers/gtfsWorker.js', import.meta.url);
            const worker = new Worker(workerUrl, { type: 'module' });

            worker.onmessage = (event) => {
                const { type, payload, message, error } = event.data || {};
                if (type === 'progress') {
                    this.reportProgress(onProgress, message || 'Chargement des données GTFS...');
                } else if (type === 'loaded') {
                    worker.terminate();
                    resolve(payload);
                } else if (type === 'error') {
                    worker.terminate();
                    reject(new Error(error || 'GTFS worker error'));
                }
            };

            worker.onerror = (event) => {
                worker.terminate();
                reject(event.error || new Error('GTFS worker crashed'));
            };

            worker.postMessage({ type: 'load' });
        });
    }

    async loadInline(onProgress) {
        this.reportProgress(onProgress, 'Chargement des fichiers GTFS...');
        const [routes, trips, stopTimes, stops, calendar, calendarDates, shapes, geoJson] = await Promise.all([
            this.loadGTFSFile('routes.txt'),
            this.loadGTFSFile('trips.txt'),
            this.loadGTFSFile('stop_times.txt'),
            this.loadGTFSFile('stops.txt'),
            this.loadGTFSFile('calendar.txt'), 
            this.loadGTFSFile('calendar_dates.txt'), 
            this.loadGTFSFile('shapes.txt'),
            this.loadGeoJSON()
        ]);

        this.reportProgress(onProgress, 'Nettoyage des fichiers...');
        const dataset = cleanDataset({
            routes,
            trips,
            stopTimes,
            stops,
            calendar,
            calendarDates,
            shapes,
            geoJson
        });

        this.reportProgress(onProgress, 'Construction des index...');
        const indexes = buildGtfsIndexes(dataset);
        return { dataset, indexes, source: 'inline' };
    }

    reportProgress(onProgress, message) {
        if (typeof onProgress === 'function' && message) {
            onProgress(message);
        }
    }

    applyLoadedData(payload) {
        const dataset = payload?.dataset || payload || {};
        const indexes = payload?.indexes || buildGtfsIndexes(dataset);

        this.routes = dataset.routes || [];
        this.trips = dataset.trips || [];
        this.stopTimes = dataset.stopTimes || [];
        this.stops = dataset.stops || [];
        this.calendar = dataset.calendar || [];
        this.calendarDates = dataset.calendarDates || [];
        this.geoJson = dataset.geoJson || null;
        this.shapes = dataset.shapes || [];
        this._shapesIndexPromise = null;
        this.buildRouteGeometryIndex();

        this.applyIndexes(indexes);

        debugLog('🛠️  Index GTFS prêts.');
        debugLog('✅ Données chargées:');
        debugLog(`  - ${this.routes.length} routes`);
        debugLog(`  - ${this.trips.length} trips`);
        debugLog(`  - ${this.stopTimes.length} stop_times`);
        debugLog(`  - ${this.stops.length} stops`);
        debugLog(`  - ${this.calendar.length} calendriers`);
        debugLog(`  - ${this.calendarDates.length} exceptions`);
        debugLog(`  - ${this.shapes.length} points de shapes`);
    }
    
    applyIndexes(indexes = {}) {
        this.routesById = indexes.routesById || {};
        this.routesByShortName = indexes.routesByShortName || {};
        this.stopsById = indexes.stopsById || {};
        this.stopsByName = indexes.stopsByName || {};
        this.tripsByRoute = indexes.tripsByRoute || {};
        this.tripsByTripId = indexes.tripsByTripId || {};
        this.stopTimesByTrip = indexes.stopTimesByTrip || {};
        this.stopTimesByStop = indexes.stopTimesByStop || {};
        this.groupedStopMap = indexes.groupedStopMap || {};
        this.masterStops = indexes.masterStops || [];
        this.shapesById = indexes.shapesById || {};
        debugLog(`📍 ${this.masterStops.length} arrêts maîtres`);
        
        // Diagnostic stopTimesByStop
        const stbsKeys = Object.keys(this.stopTimesByStop);
        debugLog(`📊 stopTimesByStop: ${stbsKeys.length} arrêts indexés`);
        if (stbsKeys.length > 0) {
            debugLog(`   Exemples: ${stbsKeys.slice(0, 3).join(', ')}`);
        } else {
            console.warn('⚠️ stopTimesByStop est VIDE - les recherches de correspondances ne fonctionneront pas!');
        }
    }

    hasShapeData() {
        return this.shapesById && Object.keys(this.shapesById).length > 0;
    }

    async ensureShapesIndexLoaded() {
        if (this.hasShapeData()) {
            return true;
        }

        if (this._shapesIndexPromise) {
            return this._shapesIndexPromise;
        }

        this._shapesIndexPromise = (async () => {
            try {
                debugLog('🔁 Recharge des shapes GTFS à partir de shapes.txt (cache incomplet)…');
                let rows = null;
                let localError = null;
                try {
                    rows = await this.loadGTFSFile('shapes.txt');
                } catch (error) {
                    localError = error;
                    console.warn('ensureShapesIndexLoaded: shapes.txt introuvable localement');
                }

                if (!rows) {
                    if (this.allowRemoteGtfs && this.remoteGtfsBaseUrl) {
                        try {
                            const remoteUrl = `${this.remoteGtfsBaseUrl.replace(/\/+$/, '')}/shapes.txt`;
                            rows = await this.loadGTFSFile('shapes.txt', remoteUrl);
                            debugLog('ensureShapesIndexLoaded: shapes chargés depuis la source distante configurée.');
                        } catch (remoteError) {
                            throw localError || remoteError;
                        }
                    } else {
                        // Remote fallback désactivé (prod-safe)
                        if (localError) throw localError;
                    }
                }
                if (!Array.isArray(rows) || rows.length === 0) {
                    console.warn('ensureShapesIndexLoaded: shapes.txt vide ou introuvable.');
                    return false;
                }

                const shapesById = {};
                const sanitize = (value) => {
                    if (value == null) return '';
                    if (typeof value === 'number') return value;
                    return String(value).replace(/^['"]|['"]$/g, '').trim();
                };

                rows.forEach((row) => {
                    const shapeId = sanitize(row.shape_id);
                    if (!shapeId) return;
                    const seq = parseInt(sanitize(row.shape_pt_sequence), 10);
                    const lat = parseFloat(sanitize(row.shape_pt_lat));
                    const lon = parseFloat(sanitize(row.shape_pt_lon));
                    if (!Number.isFinite(seq) || Number.isNaN(lat) || Number.isNaN(lon)) return;
                    if (!shapesById[shapeId]) {
                        shapesById[shapeId] = [];
                    }
                    shapesById[shapeId].push({ seq, coord: [lon, lat] });
                });

                Object.keys(shapesById).forEach((shapeId) => {
                    shapesById[shapeId]
                        .sort((a, b) => a.seq - b.seq);
                    shapesById[shapeId] = shapesById[shapeId].map(entry => entry.coord);
                });

                this.shapesById = shapesById;
                this.shapes = rows;
                debugLog(`✅ Shapes rechargés (${Object.keys(shapesById).length} shape_id, ${rows.length} points).`);
                return true;
            } catch (error) {
                console.warn('ensureShapesIndexLoaded: échec du rechargement', error);
                return false;
            } finally {
                this._shapesIndexPromise = null;
            }
        })();

        return this._shapesIndexPromise;
    }

    buildRouteGeometryIndex() {
        const cache = {};
        if (this.geoJson && Array.isArray(this.geoJson.features)) {
            this.geoJson.features.forEach((feature) => {
                const routeId = feature?.properties?.route_id;
                if (!routeId || cache[routeId]) return;
                const normalized = this.normalizeRouteGeometry(feature.geometry);
                if (normalized) {
                    cache[routeId] = normalized;
                }
            });
        }
        this.routeGeometriesById = cache;
    }

    normalizeRouteGeometry(geometry) {
        if (!geometry || !geometry.type || !geometry.coordinates) return null;
        const toLonLat = (pair) => {
            if (!Array.isArray(pair) || pair.length < 2) return null;
            const lon = Number(pair[0]);
            const lat = Number(pair[1]);
            if (Number.isNaN(lon) || Number.isNaN(lat)) return null;
            return [lon, lat];
        };

        if (geometry.type === 'LineString') {
            const coords = geometry.coordinates.map(toLonLat).filter(Boolean);
            return coords.length ? { type: 'LineString', coordinates: coords } : null;
        }

        if (geometry.type === 'MultiLineString') {
            const flattened = geometry.coordinates.flat().map(toLonLat).filter(Boolean);
            return flattened.length ? { type: 'LineString', coordinates: flattened } : null;
        }

        return null;
    }

    createRoutingSnapshot() {
        return {
            dataset: {
                routes: this.routes,
                trips: this.trips,
                stopTimes: this.stopTimes,
                stops: this.stops,
                calendar: this.calendar,
                calendarDates: this.calendarDates,
                geoJson: this.geoJson,
                shapes: this.shapes
            },
            indexes: {
                routesById: this.routesById,
                routesByShortName: this.routesByShortName,
                stopsById: this.stopsById,
                stopsByName: this.stopsByName,
                tripsByRoute: this.tripsByRoute,
                tripsByTripId: this.tripsByTripId,
                stopTimesByTrip: this.stopTimesByTrip,
                stopTimesByStop: this.stopTimesByStop,
                groupedStopMap: this.groupedStopMap,
                masterStops: this.masterStops,
                shapesById: this.shapesById
            }
        };
    }

    async optimizeStopTimesStorage() {
        try {
            if (!this.stopTimesStore) {
                this.stopTimesStore = new StopTimesStore();
            }
            await this.stopTimesStore.seedFromTripMap(this.stopTimesByTrip);
            if (Array.isArray(this.stopTimes)) {
                this.stopTimes.length = 0;
            }
            debugLog('💾 StopTimes stockés dans IndexedDB et relâchés de la RAM.');
        } catch (error) {
            console.warn('optimizeStopTimesStorage failed', error);
        }
    }

    async restoreCache() {
        try {
            // Vérification rapide du meta en localStorage (synchrone)
            const meta = this.getCacheMeta();
            if (!meta) return null;
            
            // Vérification version et expiration avant d'accéder à IndexedDB
            if (meta.version !== this.cacheVersion) {
                console.info('GTFS cache version mismatch, purge.');
                // Purge en arrière-plan
                scheduleIdleTask(() => this.clearCacheStorage());
                return null;
            }
            if ((Date.now() - meta.timestamp) > this.cacheTtlMs) {
                console.info('GTFS cache expiré, purge.');
                scheduleIdleTask(() => this.clearCacheStorage());
                return null;
            }
            
            // Cache valide, lecture depuis IndexedDB
            const payload = await this.readCacheFromIndexedDb();
            if (!payload) {
                scheduleIdleTask(() => this.clearCacheStorage());
                return null;
            }
            return payload;
        } catch (error) {
            console.warn('restoreCache failed', error);
            scheduleIdleTask(() => this.clearCacheStorage());
            return null;
        }
    }

    async saveCache(payload) {
        try {
            await this.writeCacheToIndexedDb(payload);
            this.setCacheMeta({
                version: this.cacheVersion,
                timestamp: Date.now()
            });
            debugLog('💾 GTFS mis en cache pour les prochaines sessions.');
        } catch (error) {
            console.warn('Impossible de mettre les données GTFS en cache (IndexedDB ?)', error);
            await this.clearCacheStorage();
        }
    }

    getCacheMeta() {
        try {
            const raw = localStorage.getItem(this.cacheMetaKey);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            console.warn('getCacheMeta failed', error);
            return null;
        }
    }

    setCacheMeta(meta) {
        try {
            localStorage.setItem(this.cacheMetaKey, JSON.stringify(meta));
        } catch (error) {
            console.warn('setCacheMeta failed', error);
        }
    }

    clearCacheMeta() {
        try {
            localStorage.removeItem(this.cacheMetaKey);
        } catch (error) {
            console.warn('clearCacheMeta failed', error);
        }
    }

    async clearCacheStorage() {
        await this.clearCacheFromIndexedDb();
        this.clearCacheMeta();
        this.clearLegacyLocalCache();
    }

    clearLegacyLocalCache() {
        try {
            localStorage.removeItem(this.cacheKey);
        } catch (error) {
            console.warn('clearLegacyLocalCache failed', error);
        }
    }

    async ensureCacheDb() {
        if (this.cacheDbPromise) return this.cacheDbPromise;
        if (typeof indexedDB === 'undefined') {
            this.cacheDbPromise = Promise.resolve(null);
            return this.cacheDbPromise;
        }
        this.cacheDbPromise = new Promise((resolve, reject) => {
            try {
                const request = indexedDB.open(GTFS_CACHE_DB, 1);
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(GTFS_CACHE_STORE)) {
                        db.createObjectStore(GTFS_CACHE_STORE);
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(error);
            }
        }).catch((error) => {
            console.warn('ensureCacheDb failed', error);
            return null;
        });
        return this.cacheDbPromise;
    }

    async readCacheFromIndexedDb() {
        const db = await this.ensureCacheDb();
        if (!db) return null;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(GTFS_CACHE_STORE, 'readonly');
            const store = tx.objectStore(GTFS_CACHE_STORE);
            const request = store.get(this.cacheKey);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        }).then(entry => entry && entry.data ? entry.data : null).catch(error => {
            console.warn('readCacheFromIndexedDb failed', error);
            return null;
        });
    }

    async writeCacheToIndexedDb(dataset) {
        const db = await this.ensureCacheDb();
        if (!db) return;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(GTFS_CACHE_STORE, 'readwrite');
            const store = tx.objectStore(GTFS_CACHE_STORE);
            const request = store.put({ data: dataset }, this.cacheKey);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    async clearCacheFromIndexedDb() {
        const db = await this.ensureCacheDb();
        if (!db) return;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(GTFS_CACHE_STORE, 'readwrite');
            const store = tx.objectStore(GTFS_CACHE_STORE);
            const request = store.delete(this.cacheKey);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        }).catch(error => {
            console.warn('clearCacheFromIndexedDb failed', error);
        });
    }

    async loadGTFSFile(filename, urlOverride = null) {
        const url = urlOverride || `/data/gtfs/${filename}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Impossible de charger ${filename}: ${response.statusText}`);
        }
        const csv = await response.text();
        return new Promise((resolve) => {
            Papa.parse(csv, {
                header: true,
                skipEmptyLines: true,
                worker: true,
                complete: (results) => {
                    resolve(results.data);
                }
            });
        });
    }

    async loadGeoJSON() {
        const response = await fetch('/data/map.geojson');
        if (!response.ok) {
            console.warn(`⚠️  map.geojson non trouvé`);
            return null;
        }
        return await response.json();
    }

    showError(title, message) {
        const errorElement = document.getElementById('instructions');
        if (errorElement) {
            errorElement.classList.remove('hidden');
            errorElement.querySelector('h3').textContent = title;
            const ol = errorElement.querySelector('ol');
            ol.innerHTML = `<li>${message}</li>`;
            
            const defaultItems = errorElement.querySelectorAll('ol li:not(:first-child)');
            defaultItems.forEach(item => item.style.display = 'none');
        }
    }

    /**
     * 🔑 FONCTION CLÉE : Récupère TOUS les services actifs (pluriel!)
     */
    getServiceIds(date) {
        const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];
        const dateString = date.getFullYear() +
                           String(date.getMonth() + 1).padStart(2, '0') +
                           String(date.getDate()).padStart(2, '0');

        const activeServiceIds = new Set();

        // Étape 1: Suppressions (exception_type = 2)
        const removedServiceIds = new Set();
        this.calendarDates.forEach(d => {
            if (d.date === dateString && d.exception_type === '2') {
                removedServiceIds.add(d.service_id);
            }
        });

        // Étape 2: Services réguliers (calendar.txt)
        this.calendar.forEach(s => {
            const dayActive = s[dayOfWeek] === '1' || s[dayOfWeek] === 1;
            const inRange = s.start_date <= dateString && s.end_date >= dateString;
            const notRemoved = !removedServiceIds.has(s.service_id);
            
            if (dayActive && inRange && notRemoved) {
                activeServiceIds.add(s.service_id);
            }
        });

        // Étape 3: Ajouts spéciaux (exception_type = 1)
        this.calendarDates.forEach(d => {
            if (d.date === dateString && d.exception_type === '1') {
                activeServiceIds.add(d.service_id);
            }
        });

        if (activeServiceIds.size === 0) {
            console.warn(`⚠️  AUCUN SERVICE ACTIF pour le ${dateString}`);
        }
        
        return activeServiceIds;
    }

    /**
     * Compare un service_id de trip avec les services actifs
     */
    serviceIdsMatch(tripServiceId, activeServiceId) {
        if (!tripServiceId || !activeServiceId) return false;
        if (tripServiceId === activeServiceId) return true;

        // Autorise seulement un suffixe après ":" (ex: service_id étendu)
        const [base] = tripServiceId.split(':', 4); // base = avant premier ":" supplémentaire
        return base === activeServiceId;
    }

    /**
     * Prochains départs (gère PLUSIEURS services actifs)
     */
    getUpcomingDepartures(stopIds, currentSeconds, date, limit = 5) {
        const serviceIdSet = this.getServiceIds(date);
        
        if (serviceIdSet.size === 0) {
            console.warn('⚠️  Aucun service actif');
            return [];
        }

        let allDepartures = [];

        stopIds.forEach(stopId => {
            const stops = this.stopTimesByStop[stopId] || [];
            stops.forEach(st => {
                const trip = this.tripsByTripId[st.trip_id];
                if (!trip) return;

                // Vérifie si le trip appartient à UN des services actifs
                const isServiceActive = Array.from(serviceIdSet).some(activeServiceId => {
                    return this.serviceIdsMatch(trip.service_id, activeServiceId);
                });

                if (isServiceActive) {
                    const departureSeconds = this.timeToSeconds(st.departure_time);
                    if (departureSeconds >= currentSeconds) {
                        allDepartures.push({
                            tripId: st.trip_id,
                            stopId: stopId,
                            time: st.departure_time,
                            departureSeconds: departureSeconds
                        });
                    }
                }
            });
        });

        allDepartures.sort((a, b) => a.departureSeconds - b.departureSeconds);
        allDepartures = allDepartures.slice(0, limit);

        return allDepartures.map(dep => {
            const trip = this.tripsByTripId[dep.tripId];
            const route = this.routesById[trip.route_id];
            const stopTimes = this.stopTimesByTrip[dep.tripId];
            const destination = this.getTripDestination(stopTimes);
            
            return {
                ...dep,
                routeShortName: route.route_short_name,
                routeColor: route.route_color,
                routeTextColor: route.route_text_color,
                destination: destination
            };
        });
    }

    /**
     * Départs sur 1 heure groupés par ligne (pour popup arrêt style TBM)
     * V99: Si aucun départ dans l'heure, cherche les premiers départs de la journée
     * Retourne { departuresByLine, isNextDayDepartures, firstDepartureTime }
     */
    getDeparturesForOneHour(stopIds, currentSeconds, date) {
        const serviceIdSet = this.getServiceIds(date);
        
        debugLog(`🔍 getDeparturesForOneHour: ${stopIds.length} stopIds, heure=${Math.floor(currentSeconds/3600)}:${String(Math.floor((currentSeconds%3600)/60)).padStart(2,'0')}`);
        debugLog(`📅 Services actifs:`, Array.from(serviceIdSet));
        
        if (serviceIdSet.size === 0) {
            console.warn('⚠️  Aucun service actif pour cette date');
            return { departuresByLine: {}, isNextDayDepartures: false, firstDepartureTime: null };
        }

        const oneHourLater = currentSeconds + 3600;
        
        // Collecter TOUS les départs futurs du jour (pas seulement 1h)
        const allFutureDepartures = [];
        
        stopIds.forEach(stopId => {
            const stops = this.stopTimesByStop[stopId] || [];
            
            stops.forEach(st => {
                const trip = this.tripsByTripId[st.trip_id];
                if (!trip) return;

                const isServiceActive = Array.from(serviceIdSet).some(activeServiceId => {
                    return this.serviceIdsMatch(trip.service_id, activeServiceId);
                });

                if (isServiceActive) {
                    const departureSeconds = this.timeToSeconds(st.departure_time);
                    
                    // Tous les départs FUTURS (pas passés)
                    if (departureSeconds >= currentSeconds) {
                        const route = this.routesById[trip.route_id];
                        if (!route) return;
                        
                        const stopTimes = this.stopTimesByTrip[st.trip_id];
                        const destination = this.getTripDestination(stopTimes);
                        
                        allFutureDepartures.push({
                            departureSeconds,
                            time: st.departure_time,
                            route,
                            destination
                        });
                    }
                }
            });
        });
        
        // Trier par heure de départ
        allFutureDepartures.sort((a, b) => a.departureSeconds - b.departureSeconds);
        
        // V107: Pas de limite d'1h, on prend tous les départs futurs
        // et on limite à 4 par ligne/destination
        let departuresToUse = allFutureDepartures;
        let isNextDayDepartures = false;
        let firstDepartureTime = null;
        
        // Si aucun départ immédiat mais il y en a plus tard
        if (allFutureDepartures.length > 0 && allFutureDepartures[0].departureSeconds > oneHourLater) {
            isNextDayDepartures = true;
            firstDepartureTime = allFutureDepartures[0].time;
            debugLog(`🌅 Premiers départs à partir de ${firstDepartureTime}`);
        }
        
        // Grouper par ligne + destination
        const departuresByLine = {};
        
        departuresToUse.forEach(dep => {
            const lineKey = `${dep.route.route_short_name}_${dep.destination}`;
            
            if (!departuresByLine[lineKey]) {
                departuresByLine[lineKey] = {
                    routeId: dep.route.route_id,
                    routeShortName: dep.route.route_short_name,
                    routeColor: dep.route.route_color,
                    routeTextColor: dep.route.route_text_color,
                    destination: dep.destination,
                    departures: []
                };
            }
            
            // Ne pas limiter : pousser tous les départs trouvés pour afficher la fréquence complète
            departuresByLine[lineKey].departures.push({
                time: dep.time,
                departureSeconds: dep.departureSeconds
            });
        });
        
        debugLog(`📊 Stats: ${allFutureDepartures.length} départs futurs, isNextDay=${isNextDayDepartures}`);

        return { departuresByLine, isNextDayDepartures, firstDepartureTime };
    }

    /**
     * Trips actifs (gère PLUSIEURS services actifs)
     */
    getActiveTrips(currentSeconds, date) {
        const serviceIdSet = this.getServiceIds(date);
        
        if (serviceIdSet.size === 0) {
            // console.warn("⚠️  Aucun service actif");
            return [];
        }

        // console.log(`🚌 Recherche trips actifs à ${this.formatTime(currentSeconds)}`);

        const activeTrips = [];
        let matchCount = 0;

        this.trips.forEach(trip => {
            // Vérifie si le trip appartient à UN des services actifs
            const isServiceActive = Array.from(serviceIdSet).some(activeServiceId => {
                return this.serviceIdsMatch(trip.service_id, activeServiceId);
            });

            if (isServiceActive) {
                matchCount++;
                const stopTimes = this.stopTimesByTrip[trip.trip_id];
                if (!stopTimes || stopTimes.length < 2) return;

                const firstStop = stopTimes[0];
                const lastStop = stopTimes[stopTimes.length - 1];
                
                const startTime = this.timeToSeconds(firstStop.arrival_time);
                const endTime = this.timeToSeconds(lastStop.arrival_time);

                if (currentSeconds >= startTime && currentSeconds <= endTime) {
                    activeTrips.push({
                        tripId: trip.trip_id,
                        trip: trip,
                        stopTimes: stopTimes,
                        route: this.routesById[trip.route_id]
                    });
                }
            }
        });

        // console.log(`📊 Trips avec service actif: ${matchCount}`);
        // console.log(`✅ Trips actifs maintenant: ${activeTrips.length}`);

        return activeTrips;
    }

    getRoute(routeId) {
        return this.routesById[routeId] || null;
    }

    getStop(stopId) {
        return this.stopsById[stopId] || null;
    }

    getStopTimes(tripId) {
        return this.stopTimesByTrip[tripId] || [];
    }
    
    /**
     * Géométrie de route (gère LineString et MultiLineString)
     */
    getRouteGeometry(routeId) {
        if (!routeId) return null;
        if (this.routeGeometriesById && this.routeGeometriesById[routeId]) {
            return this.routeGeometriesById[routeId];
        }

        if (!this.geoJson || !Array.isArray(this.geoJson.features)) {
            return null;
        }

        const feature = this.geoJson.features.find(f => f?.properties?.route_id === routeId);
        if (!feature) return null;

        const normalized = this.normalizeRouteGeometry(feature.geometry);
        if (normalized) {
            this.routeGeometriesById[routeId] = normalized;
            return normalized;
        }

        return null;
    }

    timeToSeconds(timeStr) {
        const [hours, minutes, seconds] = timeStr.split(':').map(Number);
        return hours * 3600 + minutes * 60 + seconds;
    }
    
    formatTime(seconds, withSeconds = false) {
        if (seconds === null || seconds === undefined) {
            return '--:--';
        }
        const totalSeconds = Number(seconds);
        if (Number.isNaN(totalSeconds)) {
            return '--:--';
        }

        // Normalise l'heure sur 24h sans écraser les valeurs négatives (trajets veille ↦ 23hxx)
        const normalized = ((Math.floor(totalSeconds) % 86400) + 86400) % 86400;
        const hours = Math.floor(normalized / 3600);
        const minutes = Math.floor((normalized % 3600) / 60);
        const pad = (value) => String(value).padStart(2, '0');

        if (!withSeconds) {
            return `${pad(hours)}:${pad(minutes)}`;
        }
        const secs = normalized % 60;
        return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
    }

    toRad(value) {
        return value * Math.PI / 180;
    }

    /**
     * Calcule la distance Haversine entre deux points
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const φ1 = this.toRad(lat1);
        const φ2 = this.toRad(lat2);
        const Δφ = this.toRad(lat2 - lat1);
        const Δλ = this.toRad(lon2 - lon1);

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    /**
     * Trouve le point le plus proche sur un tracé
     */
    findNearestPointOnRoute(routeCoordinates, lat, lon) {
        let minDistance = Infinity;
        let nearestIndex = null;

        routeCoordinates.forEach(([pointLon, pointLat], index) => {
            const distance = this.calculateDistance(lat, lon, pointLat, pointLon);
            if (distance < minDistance) {
                minDistance = distance;
                nearestIndex = index;
            }
        });

        if (minDistance > 500) {
            return null;
        }

        return nearestIndex;
    }

    getTripDestination(stopTimes) {
        if (!stopTimes || stopTimes.length === 0) {
            return 'Destination inconnue';
        }

        const lastStop = stopTimes[stopTimes.length - 1];
        const stopInfo = this.getStop(lastStop.stop_id);
        
        return stopInfo ? stopInfo.stop_name : 'Destination inconnue';
    }

    getDailyServiceBounds() {
        let earliestStart = Infinity;
        let latestEnd = -Infinity;

        Object.values(this.stopTimesByTrip).forEach(stopTimes => {
            if (stopTimes.length < 2) return;
            const firstStop = stopTimes[0];
            const lastStop = stopTimes[stopTimes.length - 1];

            const startTime = this.timeToSeconds(firstStop.departure_time || firstStop.arrival_time);
            const endTime = this.timeToSeconds(lastStop.arrival_time || lastStop.departure_time);

            if (startTime < earliestStart) earliestStart = startTime;
            if (endTime > latestEnd) latestEnd = endTime;
        });

        if (earliestStart === Infinity) earliestStart = 0;
        if (latestEnd === -Infinity) latestEnd = 86400;

        return { earliestStart, latestEnd };
    }

    findFirstActiveSecond() {
        const bounds = this.getDailyServiceBounds();
        return bounds.earliestStart;
    }

    findNextActiveSecond(currentSeconds) {
        let nextActiveTime = Infinity;

        Object.values(this.stopTimesByTrip).forEach(stopTimes => {
            if (stopTimes.length < 2) return;

            const firstStop = stopTimes[0];
            const startTime = this.timeToSeconds(firstStop.departure_time || firstStop.arrival_time);

            if (startTime > currentSeconds && startTime < nextActiveTime) {
                nextActiveTime = startTime;
            }
        });

        if (nextActiveTime === Infinity) {
            return this.findFirstActiveSecond();
        }

        return nextActiveTime;
    }

    formatDuration(totalSeconds) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        
        let str = "";
        if (hours > 0) {
            str += `${hours} h `;
        }
        if (minutes > 0 || hours === 0) {
            str += `${minutes} min`;
        }
        return str.trim();
    }
    
    /**
     * *** FONCTION V39 - AMÉLIORÉE ***
     * Tente de trouver la liste des arrêts intermédiaires en utilisant
     * les données GTFS locales, avec matching flexible des noms.
     */
    getIntermediateStops(routeShortName, headsign, departureStopName, arrivalStopName) {
        // 1. Trouver la route
        const route = this.routesByShortName[routeShortName];
        if (!route) {
            console.warn(`[GTFS Match] Route "${routeShortName}" non trouvée.`);
            return null;
        }

        // 2. Fonction de normalisation avancée
        const normalize = (name) => {
            if (!name) return "";
            return name
                .toLowerCase()
                .replace(/[àáâãäå]/g, 'a')
                .replace(/[èéêë]/g, 'e')
                .replace(/[ìíîï]/g, 'i')
                .replace(/[òóôõö]/g, 'o')
                .replace(/[ùúûü]/g, 'u')
                .replace(/[ç]/g, 'c')
                .replace(/[^a-z0-9]/g, '') // Enlever ponctuation et espaces
                .trim();
        };

        // 3. Trouver les arrêts avec matching flexible
        const findStopsByName = (searchName) => {
            const normalized = normalize(searchName);
            // Recherche par nom normalisé (optimisé)
            const exactMatches = this.stopsByName[normalized];
            if (exactMatches) return exactMatches;
            
            // Fallback: recherche "includes" plus lente
            return this.stops.filter(stop => {
                const stopNormalized = normalize(stop.stop_name);
                // Match exact OU contient le nom recherché
                return stopNormalized === normalized || stopNormalized.includes(normalized) || normalized.includes(stopNormalized);
            });
        };

        const depStops = findStopsByName(departureStopName);
        const arrStops = findStopsByName(arrivalStopName);

        if (depStops.length === 0 || arrStops.length === 0) {
            console.warn(`[GTFS Match] Arrêt non trouvé: "${departureStopName}" (${depStops.length} résultats) -> "${arrivalStopName}" (${arrStops.length} résultats)`);
            return null;
        }
        
        const depStopIds = new Set(depStops.map(s => s.stop_id));
        const arrStopIds = new Set(arrStops.map(s => s.stop_id));

        // 4. Trouver les trajets correspondants
        const tripsForRoute = this.tripsByRoute[route.route_id] || [];
        
        // 4a. Essayer avec un headsign normalisé
        const searchHeadsign = normalize(headsign || '');
        let candidateTrips = tripsForRoute.filter(trip => {
            const tripHeadsign = normalize(trip.trip_headsign || '');
            return tripHeadsign.includes(searchHeadsign) || searchHeadsign.includes(tripHeadsign);
        });
        
        // 4b. Si échec, essayer sans headsign (moins précis)
        if (candidateTrips.length === 0) {
            console.warn(`[GTFS Match] Aucun trip trouvé pour ${routeShortName} direction "${headsign}". Essai sans headsign.`);
            candidateTrips = tripsForRoute;
        }

        // 5. Parcourir les trajets et trouver un "pattern" valide
        for (const trip of candidateTrips) {
            const stopTimes = this.stopTimesByTrip[trip.trip_id];
            if (!stopTimes) continue;

            const depIndex = stopTimes.findIndex(st => depStopIds.has(st.stop_id));
            const arrIndex = stopTimes.findIndex(st => arrStopIds.has(st.stop_id));

            // Si on trouve les deux arrêts DANS LE BON ORDRE
            if (depIndex !== -1 && arrIndex !== -1 && depIndex < arrIndex) {
                // On a trouvé un trajet !
                const intermediateStopTimes = stopTimes.slice(depIndex + 1, arrIndex);
                
                debugLog(`[GTFS Match] ✅ SUCCÈS: Trip ${trip.trip_id} trouvé (${intermediateStopTimes.length} arrêts intermédiaires)`);
                
                // On retourne la liste des noms d'arrêts
                return intermediateStopTimes.map(st => this.stopsById[st.stop_id].stop_name);
            }
        }

        // 6. Échec de la recherche
        console.warn(`[GTFS Match] Aucun pattern de trip trouvé pour ${departureStopName} -> ${arrivalStopName}.`);
        return null;
    }

    /**
     * Retourne les arrêts proches d'une coordonnée (lat, lon)
     * @param {{lat:number, lon:number}} coord
     * @param {number} radiusMeters
     * @param {number} limit
     */
    getNearestStops(coord, radiusMeters = 1000, limit = 10) {
        if (!coord || typeof coord.lat !== 'number' || typeof coord.lon !== 'number') return [];
        const candidates = this.stops.map(s => {
            const dist = this.calculateDistance(coord.lat, coord.lon, parseFloat(s.stop_lat), parseFloat(s.stop_lon));
            return { stop: s, distance: dist };
        }).filter(x => !isNaN(x.distance) && x.distance <= radiusMeters);

        candidates.sort((a, b) => a.distance - b.distance);
        return candidates.slice(0, limit).map(c => c.stop);
    }

    /**
     * Recherche de trips GTFS qui vont d'un des arrêts de départ à un des arrêts d'arrivée
     * startStopIds / endStopIds: Array or Set of stop_id strings
     * date: Date object
     * windowStartSeconds/windowEndSeconds: optional seconds-since-midnight window to filter departures/arrivals
     * searchMode: 'partir' (défaut) filtre sur l'heure de départ, 'arriver' filtre sur l'heure d'arrivée
     */
    getTripsBetweenStops(startStopIds, endStopIds, date, windowStartSeconds = 0, windowEndSeconds = 86400, searchMode = 'partir') {
        const startSet = new Set(Array.isArray(startStopIds) ? startStopIds : Array.from(startStopIds || []));
        const endSet = new Set(Array.isArray(endStopIds) ? endStopIds : Array.from(endStopIds || []));

        // Étendre avec les arrêts du cluster (StopPlace -> Quays) pour éviter les faux "noBoarding"
        const expandCluster = (idSet) => {
            const extra = [];
            idSet.forEach(id => {
                const grouped = this.groupedStopMap[id];
                if (Array.isArray(grouped)) {
                    grouped.forEach(gid => extra.push(gid));
                }

                // Fallback: si c'est un StopPlace sans mapping groupé, ajouter ses enfants connus via stopsById
                const stop = this.stopsById[id];
                if (stop && stop.location_type === '1') { // StopPlace
                    Object.values(this.stopsById).forEach(s => {
                        if (s.parent_station === id) {
                            extra.push(s.stop_id);
                        }
                    });
                }
            });
            extra.forEach(x => idSet.add(x));
        };
        expandCluster(startSet);
        expandCluster(endSet);

        // Normalise la date demandée et prépare les jours voisins (veille/len lendemain)
        const reqDate = (date instanceof Date) ? new Date(date) : new Date(date);
        const prevDate = new Date(reqDate); prevDate.setDate(reqDate.getDate() - 1);
        const nextDate = new Date(reqDate); nextDate.setDate(reqDate.getDate() + 1);

        // Récupère les services pour chaque jour utile (gestion fenêtre qui chevauche minuit)
        const serviceSetCurrent = this.getServiceIds(reqDate);
        const serviceSetPrev = this.getServiceIds(prevDate);
        const serviceSetNext = this.getServiceIds(nextDate);

        // Fenêtre brute (peut chevaucher minuit, on conserve la valeur négative/>
        const windowStart = windowStartSeconds;
        const windowEnd = windowEndSeconds;

        // Inclure la veille si la recherche est très tôt le matin même si windowStart > 0
        // (les services avec horaires 24:xx appartiennent à la veille et doivent être décalés)
        const EARLY_MORNING_CUTOFF = 5 * 3600; // 05:00 local
        const includePrevDay = (windowStart < 0) || (windowStart < EARLY_MORNING_CUTOFF);

        // Prépare les fenêtres de service (veille / jour J / lendemain)
        const serviceWindows = [];
        if (includePrevDay && serviceSetPrev.size) {
            serviceWindows.push({ label: 'prev', offset: -86400, serviceSet: serviceSetPrev });
        }
        // Toujours inclure la journée demandée
        if (serviceSetCurrent.size) {
            serviceWindows.push({ label: 'current', offset: 0, serviceSet: serviceSetCurrent });
        }
        if (windowEnd > 86400 && serviceSetNext.size) {
            serviceWindows.push({ label: 'next', offset: 86400, serviceSet: serviceSetNext });
        }

        // DEBUG: Log uniquement pour la première recherche directe
        if (!globalThis._gtfsDebugLogged) {
            globalThis._gtfsDebugLogged = true;
            
            // Vérifier si les IDs cherchés existent dans stop_times
            const allStopTimeIds = new Set();
            Object.values(this.stopTimesByTrip).forEach(stArr => {
                stArr.forEach(st => allStopTimeIds.add(st.stop_id));
            });
            const startFound = Array.from(startSet).filter(id => allStopTimeIds.has(id));
            const endFound = Array.from(endSet).filter(id => allStopTimeIds.has(id));
            
            debugLog('🔬 Recherche GTFS directe:');
            debugLog(`   Départ: ${startFound.length}/${startSet.size} IDs valides`, startFound.slice(0, 2));
            debugLog(`   Arrivée: ${endFound.length}/${endSet.size} IDs valides`, endFound.slice(0, 2));
            const fmt = (d) => d.toLocaleDateString('fr-CA'); // YYYY-MM-DD en local
            debugLog(`   Services veille (${fmt(prevDate)}):`, Array.from(serviceSetPrev));
            debugLog(`   Services jour J (${fmt(reqDate)}):`, Array.from(serviceSetCurrent));
            debugLog(`   Services lendemain (${fmt(nextDate)}):`, Array.from(serviceSetNext));
            debugLog(`   Fenêtre brute: ${windowStart}s → ${windowEnd}s`);
            
            // Sauvegarder les IDs valides pour comparaison ultérieure
            globalThis._validEndIds = endFound;
        }

        const results = [];
        const debugStats = { serviceRejected: 0, noStopTimes: 0, noBoardingFound: 0, noAlightFound: 0, wrongOrder: 0, outOfWindow: 0, accepted: 0 };

        // Iterate over all trips (could be optimized later)
        for (const trip of this.trips) {
            const stopTimes = this.stopTimesByTrip[trip.trip_id];
            if (!stopTimes || stopTimes.length < 2) { debugStats.noStopTimes++; continue; }

            let boardingIndex = -1;
            let alightIndex = -1;

            for (let i = 0; i < stopTimes.length; i++) {
                const st = stopTimes[i];
                if (boardingIndex === -1 && startSet.has(st.stop_id)) {
                    boardingIndex = i;
                }
                if (alightIndex === -1 && endSet.has(st.stop_id)) {
                    alightIndex = i;
                }
                if (boardingIndex !== -1 && alightIndex !== -1) break;
            }

            if (boardingIndex === -1) { debugStats.noBoardingFound++; continue; }
            if (alightIndex === -1) { debugStats.noAlightFound++; continue; }
            if (boardingIndex >= alightIndex) { debugStats.wrongOrder++; continue; } // must be in order

            const boardingST = stopTimes[boardingIndex];
            const alightST = stopTimes[alightIndex];

            const depSec = this.timeToSeconds(boardingST.departure_time || boardingST.arrival_time);
            const arrSec = this.timeToSeconds(alightST.arrival_time || alightST.departure_time);

            // Vérifie sur quelle journée le service est actif (veille / jour J / lendemain)
            let serviceMatched = false;
            let accepted = false;

            for (const svcWindow of serviceWindows) {
                const isServiceActive = Array.from(svcWindow.serviceSet).some(activeServiceId => this.serviceIdsMatch(trip.service_id, activeServiceId));
                if (!isServiceActive) {
                    continue;
                }

                serviceMatched = true;

                // Repositionne les secondes par rapport à la date demandée
                const depShifted = depSec + svcWindow.offset;
                const arrShifted = arrSec + svcWindow.offset;

                const inWindow = (searchMode === 'arriver')
                    ? (arrShifted >= windowStart && arrShifted <= windowEnd)
                    : (depShifted >= windowStart && depShifted <= windowEnd);

                if (!inWindow) {
                    debugStats.outOfWindow++;
                    continue;
                }

                accepted = true;
                debugStats.accepted++;
                results.push({
                    tripId: trip.trip_id,
                    routeId: trip.route_id,
                    shapeId: trip.shape_id || null,
                    boardingStopId: boardingST.stop_id,
                    alightingStopId: alightST.stop_id,
                    // On conserve l'heure décalée pour garder l'ordre chronologique à cheval sur minuit
                    departureSeconds: depShifted,
                    arrivalSeconds: arrShifted,
                    stopTimes: stopTimes.slice(boardingIndex, alightIndex + 1),
                    trip: trip,
                    route: this.getRoute(trip.route_id)
                });
                break; // éviter les doublons si le trip matche plusieurs fenêtres
            }

            if (!serviceMatched) {
                debugStats.serviceRejected++;
            } else if (!accepted) {
                // Service actif mais horaire hors fenêtre
                debugStats.outOfWindow++;
            }
            // Si serviceMatched mais pas accepted, l'itinéraire est juste hors fenêtre (déjà compté outOfWindow)
        }

        // Sort by departure time
        results.sort((a, b) => a.departureSeconds - b.departureSeconds);
        
        // Log stats uniquement pour le premier appel (pas pour les correspondances)
        if (!globalThis._gtfsStatsLogged && results.length === 0) {
            globalThis._gtfsStatsLogged = true;
            debugLog('📊 getTripsBetweenStops STATS:', JSON.stringify(debugStats));
            if (debugStats.noBoardingFound > 0 && debugStats.noAlightFound > 0 && debugStats.accepted === 0) {
                debugLog('⚠️ AUCUN trajet DIRECT: les arrêts départ/arrivée ne sont pas sur la même ligne.');
                debugLog('💡 Une correspondance sera nécessaire.');
            }
        }
        
        // Log pour les recherches de second leg (correspondances)
        if (globalThis._gtfsStatsLogged && !globalThis._secondLegStatsLogged) {
            globalThis._secondLegCallCount = (globalThis._secondLegCallCount || 0) + 1;
            // Logger seulement les 3 premières recherches de second leg en détail
            if (globalThis._secondLegCallCount <= 3 && results.length === 0) {
                debugLog(`🔍 Second leg #${globalThis._secondLegCallCount} STATS:`, JSON.stringify(debugStats));
                debugLog(`   StartIds (${startSet.size}):`, Array.from(startSet).slice(0, 3));
                debugLog(`   EndIds (${endSet.size}):`, Array.from(endSet).slice(0, 3));
                debugLog(`   Window: ${Math.floor(windowStartSeconds/3600)}:${String(Math.floor((windowStartSeconds%3600)/60)).padStart(2,'0')} - ${Math.floor(windowEndSeconds/3600)}:${String(Math.floor((windowEndSeconds%3600)/60)).padStart(2,'0')}`);
            }
            if (globalThis._secondLegCallCount === 3) {
                globalThis._secondLegStatsLogged = true;
            }
        }
        
        return results;
    }

    findStopsByName(searchName, limit = 10) {
        if (!searchName || typeof searchName !== 'string') return [];
        const normalize = (name) => {
            if (!name) return '';
            return name
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]/g, '')
                .trim();
        };

        const normalizedQuery = normalize(searchName);
        if (!normalizedQuery) return [];

        const unique = new Map();
        const pushStop = (stop) => {
            if (!stop || unique.has(stop.stop_id)) return;
            unique.set(stop.stop_id, stop);
        };

        const exactMatches = this.stopsByName[normalizedQuery];
        if (exactMatches && exactMatches.length) {
            exactMatches.forEach(pushStop);
        }

        if (unique.size < limit) {
            for (const stop of this.stops) {
                if (!stop || !stop.stop_name) continue;
                if (normalize(stop.stop_name).includes(normalizedQuery)) {
                    pushStop(stop);
                    if (unique.size >= limit) break;
                }
            }
        }

        return Array.from(unique.values()).slice(0, limit);
    }

    getShapeLatLngs(shapeId) {
        if (!shapeId || !this.shapesById) return null;
        const coords = this.shapesById[shapeId];
        if (!coords || !coords.length) return null;
        return coords.map(([lon, lat]) => [lat, lon]);
    }

    /**
     * Recherche une géométrie (GeoJSON geometry) pour un shape_id ou routeId
     */
    getShapeGeoJSON(shapeId, routeId = null) {
        if (shapeId && this.shapesById && this.shapesById[shapeId] && this.shapesById[shapeId].length) {
            return {
                type: 'LineString',
                coordinates: this.shapesById[shapeId]
            };
        }

        if (routeId && this.tripsByRoute && this.tripsByRoute[routeId]) {
            const fallbackTrip = this.tripsByRoute[routeId].find(t => t.shape_id && this.shapesById[t.shape_id]);
            if (fallbackTrip) {
                return {
                    type: 'LineString',
                    coordinates: this.shapesById[fallbackTrip.shape_id]
                };
            }
        }

        if (!this.geoJson || !this.geoJson.features) return null;

        if (shapeId) {
            const f = this.geoJson.features.find(feat => feat.properties && (feat.properties.shape_id === shapeId || feat.properties.shapeid === shapeId));
            if (f && f.geometry) return f.geometry;
        }

        if (routeId) {
            const f2 = this.geoJson.features.find(feat => feat.properties && feat.properties.route_id === routeId);
            if (f2 && f2.geometry) return f2.geometry;
        }

        return null;
    }
}
