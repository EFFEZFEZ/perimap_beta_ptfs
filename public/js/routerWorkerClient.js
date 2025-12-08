// Copyright © 2025 Périmap - Tous droits réservés
/**
 * routerWorkerClient.js
 * Compat shim: redirige les calculs vers le backend /api/routes
 */

export class RouterWorkerClient {
    constructor() {}

    async computeHybridItinerary(params) {
        // Params: { fromCoords, toCoords, searchTime }
        const { fromCoords, toCoords, searchTime } = params || {};
        if (!fromCoords || !toCoords) {
            throw new Error('Coordonnées manquantes');
        }

        const body = {
            origin: { lat: fromCoords.lat, lon: fromCoords.lng },
            destination: { lat: toCoords.lat, lon: toCoords.lng },
            time: buildIso(searchTime),
            timeType: searchTime?.type === 'arriver' ? 'arrival' : 'departure',
            mode: 'TRANSIT'
        };

        const resp = await fetch('/api/routes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!resp.ok) {
            const err = await safeJson(resp);
            throw new Error(`Routes error ${resp.status}: ${err?.error || ''}`);
        }
        const json = await resp.json();
        return json.routes || [];
    }

    terminate() {}
}

function buildIso(searchTime) {
    if (!searchTime) return new Date().toISOString();
    const now = new Date();
    const dateStr = searchTime.date && searchTime.date !== "Aujourd'hui"
        ? searchTime.date
        : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const hour = String(searchTime.hour || '00').padStart(2, '0');
    const minute = String(searchTime.minute || '00').padStart(2, '0');
    return `${dateStr}T${hour}:${minute}:00`;
}

async function safeJson(resp) {
    try {
        return await resp.json();
    } catch (e) {
        return null;
    }
}
