/**
 * mapRenderer.js - VERSION V25 (Badge ligne style unifié)
 *
 * *** V25 - Badge de ligne dans popup arrêt ***
 * - Badge coloré avec fond et couleur de texte de la ligne
 * - Style identique à l'état des lignes (line-badge)
 * - Maximum 4 prochains départs affichés
 *
 * *** SOLUTION DÉFINITIVE V24 ***
 * - Le bug est que marker.bindPopup() est incompatible
 * avec setLatLng() appelé à chaque tick.
 *
 * - SOLUTION :
 * 1. Ne PLUS utiliser marker.bindPopup().
 * 2. Créer UN SEUL popup global (this.busPopup).
 * 3. Utiliser marker.on('click') pour ouvrir ce popup global.
 * 4. Mettre à jour la position du marqueur ET du popup
 * séparément dans updateBusMarkers().
 *
 * - RÉSULTAT :
 * Le bus bouge (setLatLng sur le marqueur).
 * Le popup suit (setLatLng sur le popup).
 * L'ETA se met à jour (setContent sur le popup).
 * ZÉRO CLIGNOTEMENT.
 *
 * *** MODIFICATION V57 (Géolocalisation) ***
 * 1. Ajout de `userLocationMarker` et `locateControl` au constructeur.
 * 2. Ajout de `addLocateControl()` pour initialiser L.Control.Locate.
 * 3. Ajout de `updateUserLocation()` pour afficher/déplacer le point bleu.
 * 4. Ajout de `onLocateError()` pour gérer les erreurs.
 * 5. Ajout de `panToUserLocation()` pour centrer la carte.
 */

const LIGHT_TILE_CONFIG = Object.freeze({
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }
});

const DARK_TILE_CONFIG = Object.freeze({
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: {
        attribution: '© OpenStreetMap contributors, © CARTO',
        maxZoom: 19,
        subdomains: 'abcd'
    }
});

// V161 - Icône localisation
const LOCATE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
</svg>`;

export class MapRenderer {
    /**
     * @param {string} mapElementId - L'ID de l'élément HTML de la carte
     * @param {DataManager} dataManager - L'instance de DataManager
     * @param {TimeManager} timeManager - L'instance de TimeManager
     */
    constructor(mapElementId, dataManager, timeManager) {
        this.mapElementId = mapElementId;
        this.map = null;
        this.busMarkers = {}; // Garde la trace de nos marqueurs (clé: tripId)
        this.routeLayer = null;
        this.routeLayersById = {};
        this.selectedRoute = null;
        this.centerCoordinates = [45.1833, 0.7167]; // Périgueux
        this.zoomLevel = 16;
        this.tempStopMarker = null;

        this.stopLayer = null;

        /* Garder une référence aux managers */
        this.dataManager = dataManager;
        this.timeManager = timeManager;

        /* V24 - Initialisation du Popup Indépendant */
        this.busPopup = null;
        this.busPopupDomElement = null; // Le DOM stable (V18)
        this.selectedBusId = null; // Savoir quel bus est cliqué

        /* ✅ V57 - Géolocalisation */
        this.userLocationMarker = null; // Le "point bleu"
        this.locateControl = null; // Le contrôle Leaflet.Locate
        this.locateButtonElement = null;

        this.activeTileLayer = null;
        this.currentTheme = null;
        this.isDarkTheme = false;

        /* Initialisation du groupe de clusters */
        this.clusterGroup = L.markerClusterGroup({
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            disableClusteringAtZoom: 16 
        });
    }

    /**
     * Initialise la carte Leaflet
     */
    initializeMap(useClusters = true) {
        this.map = L.map(this.mapElementId, {
            zoomControl: false // ✅ V57: On désactive le zoom par défaut pour le repositionner
        }).setView(this.centerCoordinates, this.zoomLevel);

        const prefersDark = typeof document !== 'undefined' && document.body?.classList?.contains('dark-theme');
        this.applyTheme(prefersDark);
        
        // ✅ V57: Ajout du contrôle de zoom en haut à droite
        L.control.zoom({ position: 'topright' }).addTo(this.map);

        /* Initialisation des couches */
        this.stopLayer = L.layerGroup().addTo(this.map);
        
        if (useClusters) {
            this.map.addLayer(this.clusterGroup);
        }
        
        console.log(`🗺️ Carte ${this.mapElementId} initialisée`);
        this.map.on('click', () => {
            if (this.tempStopMarker) {
                this.map.removeLayer(this.tempStopMarker);
                this.tempStopMarker = null;
            }
        });

        /* V24 - Créer le popup global et son DOM */
        this.busPopupDomElement = this.createBusPopupDomElement(); // Crée la structure
        this.busPopup = L.popup({
            autoClose: true,
            closeOnClick: true,
            closeButton: true,
            autoPan: true
        });

        // Quand le popup est fermé, on désélectionne le bus
        this.busPopup.on('remove', () => {
            this.selectedBusId = null;
        });
    }

    applyTheme(useDarkTheme) {
        if (!this.map) return;
        const desiredTheme = useDarkTheme ? 'dark' : 'light';
        const themeChanged = this.currentTheme !== desiredTheme;

        if (this.activeTileLayer) {
            this.map.removeLayer(this.activeTileLayer);
            this.activeTileLayer = null;
        }

        const config = useDarkTheme ? DARK_TILE_CONFIG : LIGHT_TILE_CONFIG;
        this.activeTileLayer = L.tileLayer(config.url, config.options).addTo(this.map);
        this.currentTheme = desiredTheme;
        this.isDarkTheme = useDarkTheme;

        if (themeChanged) {
            this.restyleRouteLayers();
        }
    }

    getRouteStyle(baseColor) {
        return {
            color: this.getRouteColorForTheme(baseColor),
            weight: this.isDarkTheme ? 3.5 : 4,
            opacity: this.isDarkTheme ? 0.72 : 0.85,
            lineCap: 'round',
            lineJoin: 'round'
        };
    }

    getRouteColorForTheme(color) {
        const hex = this.normalizeHexColor(color);
        if (!hex) return '#3388ff';
        if (!this.isDarkTheme) return hex;
        return this.lightenColor(hex, 0.2);
    }

    normalizeHexColor(color) {
        if (!color) return null;
        const cleaned = color.startsWith('#') ? color : `#${color}`;
        if (/^#([0-9a-fA-F]{6})$/.test(cleaned)) {
            return cleaned.toUpperCase();
        }
        return null;
    }

    lightenColor(hex, amount = 0.15) {
        const clean = hex.replace('#', '');
        if (clean.length !== 6) return hex;
        const num = parseInt(clean, 16);
        const r = (num >> 16) & 0xff;
        const g = (num >> 8) & 0xff;
        const b = num & 0xff;
        const newR = Math.round(r + (255 - r) * amount);
        const newG = Math.round(g + (255 - g) * amount);
        const newB = Math.round(b + (255 - b) * amount);
        return `#${(newR << 16 | newG << 8 | newB).toString(16).padStart(6, '0')}`;
    }

    restyleRouteLayers() {
        if (!this.routeLayersById) return;
        Object.values(this.routeLayersById).forEach(layers => {
            layers.forEach(layer => {
                if (!layer || !layer.__baseColor) return;
                layer.setStyle(this.getRouteStyle(layer.__baseColor));
            });
        });
    }

    offsetPoint(lat1, lon1, lat2, lon2, offsetMeters, index, total) {
        const earthRadius = 6371000;
        const lat1Rad = lat1 * Math.PI / 180;
        const lon1Rad = lon1 * Math.PI / 180;
        const lat2Rad = lat2 * Math.PI / 180;
        const lon2Rad = lon2 * Math.PI / 180;
        const bearing = Math.atan2(
            Math.sin(lon2Rad - lon1Rad) * Math.cos(lat2Rad),
            Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad)
        );
        const perpBearing = bearing + Math.PI / 2;
        const offsetDistance = offsetMeters * (index - (total - 1) / 2);
        const angularDistance = offsetDistance / earthRadius;
        const newLat = Math.asin(
            Math.sin(lat1Rad) * Math.cos(angularDistance) +
            Math.cos(lat1Rad) * Math.sin(angularDistance) * Math.cos(perpBearing)
        );
        const newLon = lon1Rad + Math.atan2(
            Math.sin(perpBearing) * Math.sin(angularDistance) * Math.cos(lat1Rad),
            Math.cos(angularDistance) - Math.sin(lat1Rad) * Math.sin(newLat)
        );
        return [newLat * 180 / Math.PI, newLon * 180 / Math.PI];
    }
    
    offsetLineString(coordinates, offsetMeters, index, total) {
        const offsetCoords = [];
        for (let i = 0; i < coordinates.length; i++) {
            const [lon, lat] = coordinates[i];
            let lon2, lat2;
            if (i < coordinates.length - 1) {
                [lon2, lat2] = coordinates[i + 1];
            } else {
                [lon2, lat2] = coordinates[i - 1];
            }
            const [newLat, newLon] = this.offsetPoint(lat, lon, lat2, lon2, offsetMeters, index, total);
            offsetCoords.push([newLon, newLat]);
        }
        return offsetCoords;
    }
    
    displayMultiColorRoutes(geoJsonData, dataManager, visibleRoutes) {
        if (!geoJsonData) {
            console.warn('Aucune donnée GeoJSON à afficher');
            return;
        }
        if (this.routeLayer) {
            this.map.removeLayer(this.routeLayer);
        }
        this.routeLayer = L.layerGroup().addTo(this.map);
        this.routeLayersById = {};
        const geometryMap = new Map();
        geoJsonData.features.forEach(feature => {
            if (feature.geometry && feature.geometry.type === 'LineString') {
                const routeId = feature.properties?.route_id;
                if (!visibleRoutes.has(routeId)) {
                    return;
                }
                const geomKey = JSON.stringify(feature.geometry.coordinates);
                if (!geometryMap.has(geomKey)) {
                    geometryMap.set(geomKey, []);
                }
                geometryMap.get(geomKey).push(feature);
            }
        });
        geometryMap.forEach((features, geomKey) => {
            const numRoutes = features.length;
            const baseWidth = 4;
            const offsetMeters = 3;
            if (numRoutes === 1) {
                const feature = features[0];
                const routeId = feature.properties?.route_id;
                const route = routeId ? dataManager.getRoute(routeId) : null;
                const rawColor = route?.route_color || feature.properties?.route_color;
                const baseColor = this.normalizeHexColor(rawColor) || '#3388FF';
                const layer = L.geoJSON(feature, {
                    style: this.getRouteStyle(baseColor)
                });
                layer.__baseColor = baseColor;
                if (routeId) {
                    if (!this.routeLayersById[routeId]) this.routeLayersById[routeId] = [];
                    this.routeLayersById[routeId].push(layer);
                }
                this.addRoutePopup(layer, features, dataManager);
                layer.addTo(this.routeLayer);
            } else {
                features.forEach((feature, index) => {
                    const routeId = feature.properties?.route_id;
                    const route = routeId ? dataManager.getRoute(routeId) : null;
                    const rawColor = route?.route_color || feature.properties?.route_color;
                    const baseColor = this.normalizeHexColor(rawColor) || '#3388FF';
                    const offsetCoords = this.offsetLineString(
                        feature.geometry.coordinates,
                        offsetMeters,
                        index,
                        numRoutes
                    );
                    const offsetFeature = {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: offsetCoords
                        },
                        properties: feature.properties
                    };
                    const layer = L.geoJSON(offsetFeature, {
                        style: this.getRouteStyle(baseColor)
                    });
                    layer.__baseColor = baseColor;
                    if (routeId) {
                        if (!this.routeLayersById[routeId]) this.routeLayersById[routeId] = [];
                        this.routeLayersById[routeId].push(layer);
                    }
                    layer.addTo(this.routeLayer);
                    this.addRoutePopup(layer, features, dataManager);
                });
            }
        });
    }
    
    addRoutePopup(layer, features, dataManager) {
        let content = '<b>Ligne(s) sur ce tracé:</b><br>';
        const routeNames = new Set();
        features.forEach(feature => {
            const routeId = feature.properties?.route_id;
            const route = dataManager.getRoute(routeId);
            if (route) {
                routeNames.add(route.route_short_name || routeId);
            }
        });
        content += Array.from(routeNames).join(', ');
        layer.bindPopup(content);
    }

    /**
     * V24 - Logique de Popup Indépendant
     */
    updateBusMarkers(busesWithPositions, tripScheduler, currentSeconds) {
        const markersToAdd = [];
        const markersToRemove = [];
        const activeBusIds = new Set();
        
        // 1. Trouver les marqueurs à supprimer
        busesWithPositions.forEach(bus => activeBusIds.add(bus.tripId));

        Object.keys(this.busMarkers).forEach(busId => {
            if (!activeBusIds.has(busId)) {
                // Si le bus sélectionné disparaît, fermer le popup
                if (busId === this.selectedBusId) {
                    this.busPopup.close();
                    this.selectedBusId = null;
                }
                const markerData = this.busMarkers[busId];
                markersToRemove.push(markerData.marker);
                delete this.busMarkers[busId];
            }
        });

        // 2. Mettre à jour les marqueurs existants et ajouter les nouveaux
        busesWithPositions.forEach(bus => {
            const busId = bus.tripId;
            if (!busId) return;
            
            const { lat, lon } = bus.position;
            
            if (this.busMarkers[busId]) {
                // Marqueur existant
                const markerData = this.busMarkers[busId];
                markerData.bus = bus;
                
                // On met TOUJOURS à jour la position du marqueur
                markerData.marker.setLatLng([lat, lon]);

            } else {
                // Nouveau marqueur
                const markerData = this.createBusMarker(bus, tripScheduler, busId);
                this.busMarkers[busId] = markerData;
                if (this.clusterGroup) {
                    markersToAdd.push(markerData.marker);
                } else {
                    markerData.marker.addTo(this.map);
                }
            }
        });
        
        // 3. (V24) Mettre à jour le popup s'il est ouvert
        if (this.selectedBusId && this.busMarkers[this.selectedBusId]) {
            const selectedMarkerData = this.busMarkers[this.selectedBusId];
            
            // Mettre à jour le contenu
            this.updateBusPopupContent(this.busPopupDomElement, selectedMarkerData.bus, tripScheduler);
            
            // Mettre à jour la position du popup
            this.busPopup.setLatLng(selectedMarkerData.marker.getLatLng());
        }

        // Nettoyage final des couches
        if (this.clusterGroup) {
            if (markersToRemove.length > 0) {
                this.clusterGroup.removeLayers(markersToRemove);
            }
            if (markersToAdd.length > 0) {
                this.clusterGroup.addLayers(markersToAdd);
            }
        } else {
             if (markersToRemove.length > 0) {
                markersToRemove.forEach(m => this.map.removeLayer(m));
            }
        }
    }

    /**
     * V24 - Mise à jour du DOM du popup global
     */
    updateBusPopupContent(domElement, bus, tripScheduler) {
        try {
            const route = bus.route;
            const routeShortName = route?.route_short_name || route?.route_id || '?';
            const routeColor = route?.route_color ? `#${route.route_color}` : '#3B82F6';
            const textColor = route?.route_text_color ? `#${route.route_text_color}` : '#ffffff';
            
            const destination = tripScheduler?.getTripDestination ? tripScheduler.getTripDestination() : 'Temps réel';
            const nextStopName = bus.segment?.toStopInfo?.stop_name || 'Temps réel';
            const nextStopETA = tripScheduler?.getNextStopETA ? tripScheduler.getNextStopETA(bus.segment, bus.currentSeconds) : null;

            const stateText = `En Ligne (vers ${destination})`;
            const nextStopText = nextStopName;
            const etaText = nextStopETA ? nextStopETA.formatted : '...';

            // Sélectionne les éléments à mettre à jour
            const headerEl = domElement.querySelector('.info-popup-header');
            const stateEl = domElement.querySelector('[data-update="state"]');
            const nextStopEl = domElement.querySelector('[data-update="next-stop-value"]');
            const etaEl = domElement.querySelector('[data-update="eta-value"]');

            // Mettre à jour le Header (couleur + texte)
            if (headerEl) {
                headerEl.style.background = routeColor;
                headerEl.style.color = textColor;
                headerEl.textContent = `Ligne ${routeShortName}`;
            }

            // Mettre à jour le contenu
            if (stateEl && stateEl.textContent !== stateText) stateEl.textContent = stateText;
            if (nextStopEl && nextStopEl.textContent !== nextStopText) nextStopEl.textContent = nextStopText;
            if (etaEl && etaEl.textContent !== etaText) etaEl.textContent = etaText;
            
        } catch (e) {
            console.error("Erreur mise à jour popup:", e);
        }
    }

    /**
     * V24 - Crée la STRUCTURE DOM (vide) du popup global
     */
    createBusPopupDomElement() {
        const container = document.createElement('div');
        container.className = 'info-popup-content';

        // Header
        const header = document.createElement('div');
        header.className = 'info-popup-header';
        container.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'info-popup-body bus-details';

        // Statut
        const statusP = document.createElement('p');
        statusP.innerHTML = '<strong>Statut: </strong><span data-update="state">Chargement...</span>';
        body.appendChild(statusP);

        // Prochain arrêt
        const nextStopP = document.createElement('p');
        nextStopP.innerHTML = '<strong data-update="next-stop-label">Prochain arrêt : </strong><span data-update="next-stop-value">...</span>';
        body.appendChild(nextStopP);

        // Arrivée
        const etaP = document.createElement('p');
        const etaValue = document.createElement('span');
        etaValue.setAttribute('data-update', 'eta-value');
        etaValue.textContent = '...';
        etaValue.style.fontVariantNumeric = 'tabular-nums'; 
        etaValue.style.display = 'inline-block';
        etaValue.style.minWidth = '80px';
        
        etaP.innerHTML = '<strong data-update="eta-label">Arrivée : </strong>';
        etaP.appendChild(etaValue);
        body.appendChild(etaP);
        
        // Notice temps réel
        const noticeP = document.createElement('p');
            noticeP.className = 'realtime-notice live';
            noticeP.innerHTML = '<strong>✅ Temps réel :</strong> Données issues du flux GTFS-RT.';
        body.appendChild(noticeP);

        container.appendChild(body);

        return container;
    }

    /**
     * V24 - Crée un marqueur et lui attache un 'click' event
     */
    createBusMarker(bus, tripScheduler, busId) {
        const { lat, lon } = bus.position;
        const route = bus.route;
        const routeShortName = route?.route_short_name || route?.route_id || '?';
        const routeColor = route?.route_color ? `#${route.route_color}` : '#FFC107';
        const textColor = route?.route_text_color ? `#${route.route_text_color}` : '#ffffff';

        const iconClassName = 'bus-icon-rect';
        const statusClass = bus.currentStatus ? `bus-status-${bus.currentStatus}` : 'bus-status-normal';

        const icon = L.divIcon({
            className: `${iconClassName} ${statusClass}`,
            html: `<div style="background-color: ${routeColor}; color: ${textColor};">${routeShortName}</div>`,
            iconSize: [32, 32],    // Dimensions carrées pour cercle parfait
            iconAnchor: [16, 16],  // Centre du cercle
            popupAnchor: [0, -16]
        });

        const marker = L.marker([lat, lon], { icon });
        
        // *** V24 - NE PAS UTILISER bindPopup ***
        // marker.bindPopup(...);
        
        // Attacher un simple 'click'
        marker.on('click', () => {
            this.selectedBusId = busId;
            const markerData = this.busMarkers[busId];
            
            // Mettre à jour le contenu AVANT de l'ouvrir
            this.updateBusPopupContent(this.busPopupDomElement, markerData.bus, tripScheduler);
            
            // Ouvrir le popup global
            this.busPopup
                .setLatLng(marker.getLatLng())
                .setContent(this.busPopupDomElement)
                .openOn(this.map);
        });
        
        // Créer l'objet markerData (sans popupDomElement, car il est global)
        const markerData = {
            marker: marker,
            bus: bus
        };

        return markerData;
    }

    /**
     * Surligne un tracé sur la carte
     */
    highlightRoute(routeId, state) {
        if (!this.routeLayersById || !this.routeLayersById[routeId]) return;
        const weight = state ? 6 : 4; 
        const opacity = state ? 1 : 0.85;
        this.routeLayersById[routeId].forEach(layer => {
            const baseColor = layer.__baseColor || '#3388FF';
            layer.setStyle({
                color: this.getRouteColorForTheme(baseColor),
                weight: weight,
                opacity: opacity
            });
            if (state) {
                layer.bringToFront(); 
            }
        });
    }

    /**
     * Zoome sur un tracé de ligne
     */
    zoomToRoute(routeId) {
        if (!this.routeLayersById || !this.routeLayersById[routeId] || this.routeLayersById[routeId].length === 0) {
            console.warn(`Aucune couche trouvée pour zoomer sur la route ${routeId}`);
            return;
        }
        const routeGroup = L.featureGroup(this.routeLayersById[routeId]);
        const bounds = routeGroup.getBounds();
        if (bounds && bounds.isValid()) {
            this.map.fitBounds(bounds, { padding: [50, 50] });
        }
    }

    /**
     * Zoome sur un arrêt
     */
    zoomToStop(stop) {
        const lat = parseFloat(stop.stop_lat);
        const lon = parseFloat(stop.stop_lon);
        if (isNaN(lat) || isNaN(lon)) return;
        this.map.setView([lat, lon], 17);
        if (this.tempStopMarker) {
            this.map.removeLayer(this.tempStopMarker);
        }
        const stopIcon = L.divIcon({
            className: 'stop-search-marker',
            html: `<div></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });
        this.tempStopMarker = L.marker([lat, lon], { icon: stopIcon }).addTo(this.map);
    }

    /**
     * Affiche les "master stops" sur la carte, si le zoom est suffisant
     */
    displayStops(minZoom = 13) { 
        this.stopLayer.clearLayers(); 

        const currentZoom = this.map.getZoom();
        if (currentZoom < minZoom) {
            return; 
        }

        const stopIcon = L.divIcon({
            className: 'stop-marker-icon', // Style défini dans style.css
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        });

        const stopsToDisplay = [];
        this.dataManager.masterStops.forEach(stop => {
            const lat = parseFloat(stop.stop_lat);
            const lon = parseFloat(stop.stop_lon);
            if (isNaN(lat) || isNaN(lon)) return;

            // zIndexOffset -100 pour que les bus passent TOUJOURS au-dessus
            const marker = L.marker([lat, lon], { icon: stopIcon, zIndexOffset: -100 });
            
            /* Attache un événement au lieu d'un popup statique */
            marker.on('click', () => this.onStopClick(stop));
            
            stopsToDisplay.push(marker);
        });

        stopsToDisplay.forEach(marker => this.stopLayer.addLayer(marker));
    }

    /**
     * Appelé lorsqu'un marqueur d'arrêt est cliqué
     * V99: Affiche les premiers départs si rien dans l'heure
     * V110: Sur mobile, décale la carte vers le haut pour mieux voir la popup
     */
    onStopClick(masterStop) {
        const currentSeconds = this.timeManager.getCurrentSeconds();
        const currentDate = this.timeManager.getCurrentDate();

        console.log(`🚏 Clic sur arrêt: ${masterStop.stop_name}`);
        
        const associatedStopIds = this.dataManager.groupedStopMap[masterStop.stop_id] || [masterStop.stop_id];

        // V99: Utiliser la nouvelle fonction qui retourne aussi isNextDayDepartures
        const result = this.dataManager.getDeparturesForOneHour(associatedStopIds, currentSeconds, currentDate);
        const { departuresByLine, isNextDayDepartures, firstDepartureTime } = result;
        console.log(`🕐 Départs trouvés:`, Object.keys(departuresByLine).length, 'lignes', isNextDayDepartures ? `(premiers départs à ${firstDepartureTime})` : '');

        const popupContent = this.createStopPopupContent(masterStop, departuresByLine, currentSeconds, isNextDayDepartures, firstDepartureTime);
        
        const lat = parseFloat(masterStop.stop_lat);
        const lon = parseFloat(masterStop.stop_lon);
        
        // V110: Sur mobile, décaler la vue vers le haut pour que la popup soit visible
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            // Calculer un offset pour que l'arrêt soit dans le tiers inférieur de l'écran
            // Cela laisse de la place pour la popup au-dessus
            const mapHeight = this.map.getSize().y;
            const offsetY = mapHeight * 0.25; // Décaler de 25% vers le haut
            
            // Obtenir le point pixel de l'arrêt et l'ajuster
            const point = this.map.latLngToContainerPoint([lat, lon]);
            const newPoint = L.point(point.x, point.y - offsetY);
            const newCenter = this.map.containerPointToLatLng(newPoint);
            
            // Déplacer la carte avec animation
            this.map.panTo(newCenter, { animate: true, duration: 0.3 });
        }
        
        const popup = L.popup({ 
            maxHeight: 350, 
            className: 'stop-schedule-popup',
            autoPan: !isMobile, // V110: Désactiver l'autopan sur mobile car on gère manuellement
            autoPanPaddingTopLeft: isMobile ? [0, 0] : [50, 50],
            autoPanPaddingBottomRight: isMobile ? [0, 0] : [50, 50]
        })
            .setLatLng([lat, lon])
            .setContent(popupContent)
            .openOn(this.map);
        
        // V108: Ajouter les gestionnaires de clic sur les destinations
        setTimeout(() => {
            const destElements = document.querySelectorAll('.popup-dest-clickable');
            destElements.forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const destination = el.dataset.destination;
                    this.goToDestinationStop(destination);
                });
            });
        }, 50);
    }

    /**
     * Formate le contenu HTML pour le popup d'un arrêt
     * V106: Destinations cliquables pour afficher le tracé
     */
    createStopPopupContent(masterStop, departuresByLine, currentSeconds, isNextDayDepartures = false, firstDepartureTime = null) {
        const lineKeys = Object.keys(departuresByLine);
        
        // Regrouper par ligne (route_short_name)
        const lineGroups = {};
        lineKeys.forEach(lineKey => {
            const line = departuresByLine[lineKey];
            const routeName = line.routeShortName;
            if (!lineGroups[routeName]) {
                lineGroups[routeName] = {
                    routeShortName: line.routeShortName,
                    routeColor: line.routeColor,
                    routeTextColor: line.routeTextColor,
                    routeId: line.routeId,
                    destinations: []
                };
            }
            lineGroups[routeName].destinations.push({
                destination: line.destination,
                departures: line.departures,
                tripId: line.tripId,
                routeId: line.routeId
            });
        });

        // Trier les lignes par nom
        const sortedLines = Object.keys(lineGroups).sort((a, b) => 
            a.localeCompare(b, undefined, {numeric: true})
        );

        let html = `<div class="stop-popup-v105">`;
        
        // Notice si premiers départs
        if (isNextDayDepartures) {
            html += `<div class="popup-notice">Ces horaires sont prévisionnels et peuvent changer en cas de perturbation.</div>`;
        }

        if (sortedLines.length === 0) {
            html += `<div class="popup-empty">
                        <span class="popup-empty-icon">🌙</span>
                        <span>Aucun passage prévu</span>
                     </div>`;
        } else {
            // Chaque ligne
            sortedLines.forEach(routeName => {
                const lineGroup = lineGroups[routeName];
                
                html += `<div class="popup-line-block">`;
                
                // Header de la ligne : badge rond coloré + nom arrêt (style cohérent avec état des lignes)
                // Note: routeColor contient déjà le # (ex: #dd1b75)
                html += `<div class="popup-line-header">
                            <span class="popup-line-badge" style="background-color:${lineGroup.routeColor};color:${lineGroup.routeTextColor};">${lineGroup.routeShortName}</span>
                            <span class="popup-stop-name">${masterStop.stop_name}</span>
                         </div>`;
                
                // Destinations avec leurs horaires - CLIQUABLES
                lineGroup.destinations.forEach(dest => {
                    html += `<div class="popup-dest-row">
                                <div class="popup-dest-name popup-dest-clickable" 
                                     data-route-id="${dest.routeId || ''}"
                                     data-route-name="${lineGroup.routeShortName}"
                                     data-route-color="${lineGroup.routeColor}"
                                     data-destination="${dest.destination}"
                                     data-stop-id="${masterStop.stop_id}"
                                     data-stop-name="${masterStop.stop_name}"
                                     data-trip-id="${dest.tripId || ''}">
                                    ${dest.destination}
                                    <span class="dest-arrow">→</span>
                                </div>
                                <div class="popup-times">`;
                    
                    // Limiter à 4 prochains départs maximum
                    const maxDepartures = dest.departures.slice(0, 4);
                    maxDepartures.forEach(dep => {
                        html += `<span class="popup-time">${dep.time.substring(0, 5)}</span>`;
                    });
                    
                    html += `</div></div>`;
                });
                
                html += `</div>`;
            });
        }

        html += `</div>`;
        return html;
    }

    /**
     * V108: Centre la carte sur l'arrêt terminus quand on clique sur une destination
     */
    goToDestinationStop(destinationName) {
        console.log(`🎯 Recherche arrêt: ${destinationName}`);
        
        // Fermer le popup actuel
        this.map.closePopup();
        
        // Chercher l'arrêt par son nom
        const stop = this.findStopByName(destinationName);
        
        if (stop) {
            const lat = parseFloat(stop.stop_lat);
            const lon = parseFloat(stop.stop_lon);
            
            console.log(`✅ Arrêt trouvé: ${stop.stop_name} à [${lat}, ${lon}]`);
            
            // Centrer la carte sur l'arrêt avec animation
            this.map.flyTo([lat, lon], 16, {
                duration: 1
            });
            
            // Ouvrir le popup de l'arrêt après l'animation
            setTimeout(() => {
                this.onStopClick(stop);
            }, 1100);
        } else {
            console.warn(`❌ Arrêt non trouvé: ${destinationName}`);
        }
    }
    
    /**
     * V108: Trouve un arrêt par son nom (recherche flexible)
     */
    findStopByName(name) {
        if (!this.dataManager || !this.dataManager.masterStops) return null;
        
        const normalizedName = name.toLowerCase().trim();
        
        // Recherche exacte d'abord
        let found = this.dataManager.masterStops.find(s => 
            s.stop_name.toLowerCase().trim() === normalizedName
        );
        
        // Sinon recherche partielle
        if (!found) {
            found = this.dataManager.masterStops.find(s => 
                s.stop_name.toLowerCase().includes(normalizedName) ||
                normalizedName.includes(s.stop_name.toLowerCase())
            );
        }
        
        return found;
    }


    /* =========================================
     * ✅ NOUVELLES FONCTIONS V57 (GÉOLOCALISATION)
     * ========================================= */

    /**
     * Ajoute le contrôle de géolocalisation à la carte
     * @param {function} onSuccess - Callback de succès (appelé par main.js)
     * @param {function} onError - Callback d'erreur (appelé par main.js)
     */
    addLocateControl(onSuccess, onError) {
        if (!this.map) {
            console.warn('Carte non initialisée, impossible d\'ajouter le contrôle de localisation.');
            return;
        }
        if (this.locateControl) {
            return;
        }
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            console.warn('API de géolocalisation indisponible dans ce navigateur.');
            return;
        }

        const renderer = this;
        const startLocate = () => {
            if (!renderer.map) return;
            renderer.setLocateButtonState('loading');
            renderer.map.locate({
                enableHighAccuracy: true,
                watch: false,
                setView: false,
                maximumAge: 0
            });
        };

        const handleLocationFound = (event) => {
            renderer.setLocateButtonState('idle');
            if (typeof onSuccess === 'function') {
                onSuccess({ coords: { latitude: event.latitude, longitude: event.longitude } });
            }
            renderer.panToUserLocation();
        };

        const handleLocationError = (event) => {
            renderer.setLocateButtonState('error');
            if (typeof onError === 'function') {
                onError(event);
            }
            setTimeout(() => renderer.setLocateButtonState('idle'), 1800);
        };

        // ✅ V158 - Bouton localisation seul (sans zoom)
        const MapControlsBar = L.Control.extend({
            options: { position: 'bottomright' },
            onAdd(map) {
                const container = L.DomUtil.create('div', 'map-floating-controls');
                
                // Bouton Localisation uniquement
                const btnLocate = L.DomUtil.create('button', 'map-btn-locate', container);
                btnLocate.type = 'button';
                btnLocate.setAttribute('aria-label', 'Me localiser');
                btnLocate.title = 'Me localiser';
                btnLocate.innerHTML = LOCATE_ICON;
                renderer.locateButtonElement = btnLocate;
                renderer.setLocateButtonState('idle');
                
                // Empêcher propagation des clics
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);
                
                // Événement localisation
                L.DomEvent.on(btnLocate, 'click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startLocate();
                });
                
                return container;
            }
        });

        this.locateControl = new MapControlsBar();
        this.locateControl.addTo(this.map);
        this.map.on('locationfound', handleLocationFound);
        this.map.on('locationerror', handleLocationError);
    }

    setLocateButtonState(state) {
        if (!this.locateButtonElement) {
            return;
        }
        this.locateButtonElement.classList.toggle('is-loading', state === 'loading');
        this.locateButtonElement.classList.toggle('has-error', state === 'error');
        if (state === 'idle') {
            this.locateButtonElement.classList.remove('is-loading');
            this.locateButtonElement.classList.remove('has-error');
        }
    }

    /**
     * Met à jour la position du "point bleu" de l'utilisateur sur la carte
     * @param {object} coords - { lat, lng }
     */
    updateUserLocation(coords) {
        if (!this.map) return;

        const latLng = [coords.lat, coords.lng];

        if (!this.userLocationMarker) {
            // Créer le marqueur "point bleu"
            const userIcon = L.divIcon({
                className: 'user-location-marker',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });
            this.userLocationMarker = L.marker(latLng, { 
                icon: userIcon,
                zIndexOffset: 1000 // Toujours au-dessus
            }).addTo(this.map);
        } else {
            // Simplement mettre à jour sa position
            this.userLocationMarker.setLatLng(latLng);
        }
    }

    /**
     * Gère les erreurs de localisation (ex: permission refusée)
     */
    onLocateError() {
        this.setLocateButtonState('error');
        setTimeout(() => this.setLocateButtonState('idle'), 1800);
    }

    /**
     * Centre la carte sur la position de l'utilisateur (si connue)
     */
    panToUserLocation() {
        if (this.userLocationMarker) {
            const latLng = this.userLocationMarker.getLatLng();
            this.map.flyTo(latLng, Math.max(this.map.getZoom(), 17)); // Zoome si nécessaire
        } else if (this.map) {
            this.setLocateButtonState('loading');
            this.map.locate({ enableHighAccuracy: true, watch: false, setView: true });
        }
    }

    /**
     * Ajoute ou met à jour un marqueur de bus en retard sur la carte
     * @param {object} delayInfo - Informations sur le retard
     */
    addDelayedBusMarker(delayInfo) {
        if (!this.map || !delayInfo.position) return;

        const { tripId, routeName, routeColor, delaySeconds, position, isMajorDelay } = delayInfo;
        const markerId = `delay_${tripId}`;
        const delayMinutes = Math.floor(delaySeconds / 60);

        // Supprimer l'ancien marqueur si existant
        if (this.delayedBusMarkers && this.delayedBusMarkers[markerId]) {
            this.map.removeLayer(this.delayedBusMarkers[markerId]);
        }

        if (!this.delayedBusMarkers) {
            this.delayedBusMarkers = {};
        }

        // Créer l'icône personnalisée avec point d'exclamation
        const markerHtml = `
            <div class="delayed-bus-marker ${isMajorDelay ? 'major-delay' : ''}">
                <div class="bus-icon" style="--line-color: ${routeColor || '#1976D2'}">
                    ${routeName}
                </div>
                <div class="delay-indicator">!</div>
                <div class="delay-tooltip">
                    ⚠️ ${routeName}: ~${delayMinutes} min de retard
                </div>
            </div>
        `;

        const delayIcon = L.divIcon({
            className: 'delayed-bus-icon-wrapper',
            html: markerHtml,
            iconSize: [44, 44],
            iconAnchor: [22, 22]
        });

        const marker = L.marker([position.lat, position.lng], {
            icon: delayIcon,
            zIndexOffset: 2000 // Au-dessus des autres marqueurs
        });

        marker.addTo(this.map);
        this.delayedBusMarkers[markerId] = marker;

        // Popup au clic
        marker.on('click', () => {
            const popupContent = `
                <div class="delay-popup">
                    <div class="delay-popup-header" style="background: ${routeColor || '#1976D2'}">
                        <span class="route-name">${routeName}</span>
                        <span class="delay-badge">⚠️ ~${delayMinutes} min</span>
                    </div>
                    <div class="delay-popup-body">
                        <p><strong>Direction:</strong> ${delayInfo.headsign || 'N/A'}</p>
                        <p><strong>Prochain arrêt:</strong> ${delayInfo.nextStopName || 'N/A'}</p>
                        <p><strong>Prévu:</strong> <span class="original-time">${delayInfo.scheduledTime}</span></p>
                        <p><strong>Estimé:</strong> <span class="delayed-time">${delayInfo.estimatedTime}</span></p>
                        <p class="delay-note">
                            ${delayInfo.isPeakHour ? '🚗 Heure de pointe - trafic dense' : ''}
                        </p>
                    </div>
                </div>
            `;
            L.popup()
                .setLatLng([position.lat, position.lng])
                .setContent(popupContent)
                .openOn(this.map);
        });

        console.log(`🚌 Marqueur retard ajouté: ${routeName} à [${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}]`);
    }

    /**
     * Supprime un marqueur de bus en retard
     * @param {string} tripId - ID du trip
     */
    removeDelayedBusMarker(tripId) {
        const markerId = `delay_${tripId}`;
        if (this.delayedBusMarkers && this.delayedBusMarkers[markerId]) {
            this.map.removeLayer(this.delayedBusMarkers[markerId]);
            delete this.delayedBusMarkers[markerId];
        }
    }

    /**
     * Supprime tous les marqueurs de bus en retard
     */
    clearDelayedBusMarkers() {
        if (!this.delayedBusMarkers) return;
        
        for (const markerId in this.delayedBusMarkers) {
            this.map.removeLayer(this.delayedBusMarkers[markerId]);
        }
        this.delayedBusMarkers = {};
    }
}
