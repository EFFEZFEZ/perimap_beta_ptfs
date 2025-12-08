// Copyright © 2025 Périmap - Tous droits réservés
/**
 * tripScheduler.js
 * Nouveau rôle: poller temps réel (GTFS-RT) fourni par le backend
 */

export class TripScheduler {
    constructor(dataManager) {
        this.dataManager = dataManager;
        this.realtimeUrl = '/api/realtime';
    }

    async getActiveTrips() {
        if (!this.dataManager?.isLoaded) return [];
        const resp = await fetch(this.realtimeUrl);
        if (!resp.ok) return [];
        const json = await resp.json();
        const vehicles = json.vehicles || [];

        return vehicles.map((v) => {
            const route = v.routeId ? this.dataManager.getRoute(v.routeId) : null;
            return {
                tripId: v.tripId || v.id,
                route,
                position: { lat: v.latitude, lon: v.longitude },
                currentStatus: v.currentStatus || 'realtime',
                currentSeconds: Math.floor(Date.now() / 1000),
                segment: null
            };
        });
    }

    getNextStopETA() {
        return null;
    }

    getTripDestination() {
        return 'Temps réel';
    }
}
