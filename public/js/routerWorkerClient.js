const WORKER_MODULE_PATH = './workers/routerWorker.js';

export class RouterWorkerClient {
    constructor({ dataManager, icons, googleApiKey }) {
        this.worker = null;
        this.isSupported = typeof Worker !== 'undefined';
        this.requestId = 0;
        this.pending = new Map();
        this.readyPromise = null;
        this.icons = icons;
        this.googleApiKey = googleApiKey;
        if (this.isSupported && dataManager) {
            this.readyPromise = this.initializeWorker(dataManager);
        }
    }

    async initializeWorker(dataManager) {
        try {
            this.worker = new Worker(new URL(WORKER_MODULE_PATH, import.meta.url), { type: 'module' });
        } catch (error) {
            console.warn('RouterWorkerClient: impossible de créer le worker', error);
            this.isSupported = false;
            return Promise.reject(error);
        }

        this.worker.onmessage = (event) => {
            const { type, requestId, payload, error } = event.data || {};
            if (type === 'ready') {
                const resolver = this.pending.get('init');
                if (resolver) {
                    resolver.resolve(true);
                    this.pending.delete('init');
                }
                return;
            }
            if (type === 'init-error') {
                const resolver = this.pending.get('init');
                if (resolver) {
                    resolver.reject(new Error(error || 'router worker init error'));
                    this.pending.delete('init');
                }
                return;
            }
            if (!requestId) {
                return;
            }
            const pendingEntry = this.pending.get(requestId);
            if (!pendingEntry) return;
            if (error) {
                pendingEntry.reject(new Error(error));
            } else {
                pendingEntry.resolve(payload);
            }
            this.pending.delete(requestId);
        };

        this.worker.onerror = (event) => {
            const resolver = this.pending.get('init');
            if (resolver) {
                resolver.reject(event.error || new Error('router worker crashed during init'));
                this.pending.delete('init');
            }
            this.rejectAll(event.error || new Error('router worker crashed'));
        };

        const initPromise = new Promise((resolve, reject) => {
            this.pending.set('init', { resolve, reject });
        });

        const snapshot = dataManager.createRoutingSnapshot();
        this.worker.postMessage({
            type: 'init',
            payload: {
                snapshot,
                icons: this.icons,
                googleApiKey: this.googleApiKey
            }
        });

        return initPromise;
    }

    rejectAll(error) {
        this.pending.forEach(({ reject }) => reject(error));
        this.pending.clear();
    }

    async computeHybridItinerary(params) {
        if (!this.isSupported || !this.worker) {
            throw new Error('RouterWorkerClient indisponible');
        }
        await this.readyPromise;
        return this.enqueueRequest('computeItinerary', params);
    }

    enqueueRequest(type, payload) {
        const requestId = `req_${++this.requestId}`;
        const promise = new Promise((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
        });
        this.worker.postMessage({ type, requestId, payload });
        return promise;
    }

    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.rejectAll(new Error('Router worker terminated'));
    }
}
