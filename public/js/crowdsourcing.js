/**
 * Crowdsourcing Module - Système de partage de position des bus
 * Inspiré de Transit App "GO" mode
 * 
 * Permet aux utilisateurs de partager leur position GPS quand ils sont dans un bus,
 * ce qui améliore le suivi en temps réel pour tous les autres utilisateurs.
 */

const CrowdsourcingManager = (function() {
    'use strict';

    // Configuration
    const CONFIG = {
        // Intervalle d'envoi de position (en ms)
        POSITION_INTERVAL: 5000, // 5 secondes
        
        // Précision GPS minimale requise (en mètres)
        MIN_ACCURACY: 50,
        
        // Durée max d'une session GO (en ms) - auto-stop après 2h
        MAX_SESSION_DURATION: 2 * 60 * 60 * 1000,
        
        // Distance min pour considérer un mouvement (en mètres)
        MIN_MOVEMENT: 10,
        
        // URL du serveur de crowdsourcing (à configurer)
        SERVER_URL: '/api/crowdsource',
        
        // Clé de stockage local
        STORAGE_KEY: 'peribus_go_stats',
        
        // Points de contribution
        POINTS_PER_MINUTE: 1,
        POINTS_BONUS_PEAK_HOUR: 2
    };

    // État
    let state = {
        isActive: false,
        currentTrip: null,
        currentRoute: null,
        watchId: null,
        intervalId: null,
        sessionStart: null,
        lastPosition: null,
        positionHistory: [],
        contributors: new Map(), // tripId -> [{lat, lng, timestamp, accuracy}]
        userStats: {
            totalMinutes: 0,
            totalTrips: 0,
            totalPoints: 0,
            level: 1
        }
    };

    // Niveaux de contribution
    const LEVELS = [
        { name: 'Débutant', minPoints: 0, icon: '🚌' },
        { name: 'Régulier', minPoints: 100, icon: '⭐' },
        { name: 'Contributeur', minPoints: 500, icon: '🌟' },
        { name: 'Expert', minPoints: 1500, icon: '💫' },
        { name: 'Champion', minPoints: 5000, icon: '🏆' },
        { name: 'Légende', minPoints: 15000, icon: '👑' }
    ];

    /**
     * Initialise le module de crowdsourcing
     */
    function init() {
        loadUserStats();
        setupUI();
        console.log('🚌 Crowdsourcing initialisé. Niveau:', getUserLevel().name);
    }

    /**
     * Charge les stats utilisateur depuis le stockage local
     */
    function loadUserStats() {
        try {
            const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (saved) {
                state.userStats = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('Erreur chargement stats crowdsourcing:', e);
        }
    }

    /**
     * Sauvegarde les stats utilisateur
     */
    function saveUserStats() {
        try {
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.userStats));
        } catch (e) {
            console.warn('Erreur sauvegarde stats crowdsourcing:', e);
        }
    }

    /**
     * Retourne le niveau actuel de l'utilisateur
     */
    function getUserLevel() {
        const points = state.userStats.totalPoints;
        let currentLevel = LEVELS[0];
        for (const level of LEVELS) {
            if (points >= level.minPoints) {
                currentLevel = level;
            }
        }
        return currentLevel;
    }

    /**
     * Configure l'interface utilisateur
     * V60: Suppression du bouton GO flottant - maintenant intégré dans le bottom sheet
     */
    function setupUI() {
        // Plus de bouton flottant - le GO est maintenant dans le bottom sheet
        console.log('🚌 Crowdsourcing UI initialisé (mode intégré au bottom sheet)');
    }

    /**
     * Démarre le partage depuis un itinéraire affiché
     * V60: Nouvelle fonction pour démarrer depuis le bottom sheet
     */
    async function startSharingFromItinerary(itinerary) {
        if (!itinerary || !itinerary.steps) {
            console.warn('Itinéraire invalide pour le partage');
            return;
        }

        // Trouver le premier step de type BUS
        const busStep = itinerary.steps.find(step => step.type === 'BUS');
        if (!busStep) {
            console.warn('Aucune étape bus trouvée dans cet itinéraire');
            return;
        }

        // Extraire les infos du bus
        const tripId = busStep.tripId || busStep.trip?.trip_id || `trip_${Date.now()}`;
        const routeId = busStep.routeId || busStep.route?.route_id || '';
        const routeName = busStep.routeShortName || busStep.routeName || 'Bus';
        const direction = busStep.headsign || busStep.direction || busStep.instruction || '';

        console.log('🚌 Démarrage GO depuis itinéraire:', { tripId, routeId, routeName, direction });

        // Démarrer le partage
        startSharing(tripId, routeId, routeName, direction);
    }

    /**
     * Gère le clic sur le bouton GO
     */
    async function handleGoButtonClick() {
        if (state.isActive) {
            stopSharing();
        } else {
            // Demander à l'utilisateur de sélectionner son bus
            const tripInfo = await promptTripSelection();
            if (tripInfo) {
                startSharing(tripInfo.tripId, tripInfo.routeId, tripInfo.routeName, tripInfo.direction);
            }
        }
    }

    /**
     * Affiche une boîte de dialogue pour sélectionner le bus
     */
    async function promptTripSelection() {
        return new Promise((resolve) => {
            // Supprimer tout modal existant d'abord
            const existingModal = document.getElementById('go-trip-modal');
            if (existingModal) existingModal.remove();

            // Créer la modal de sélection
            const modalHTML = `
                <div id="go-trip-modal" class="go-modal">
                    <div class="go-modal-content">
                        <h3>🚌 Quel bus prenez-vous ?</h3>
                        <p class="go-modal-subtitle">Aidez les autres usagers en partageant votre position</p>
                        <div id="go-trip-list" class="go-trip-list">
                            <div class="go-loading">Recherche des bus à proximité...</div>
                        </div>
                        <button id="go-modal-cancel" class="go-modal-cancel">Annuler</button>
                    </div>
                </div>
            `;

            const modal = document.createElement('div');
            modal.innerHTML = modalHTML;
            document.body.appendChild(modal.firstElementChild);

            const modalEl = document.getElementById('go-trip-modal');
            const listEl = document.getElementById('go-trip-list');

            // Fermer la modal en cliquant sur le backdrop
            modalEl?.addEventListener('click', (e) => {
                if (e.target === modalEl) {
                    modalEl?.remove();
                    resolve(null);
                }
            });

            // Fermer la modal
            document.getElementById('go-modal-cancel')?.addEventListener('click', () => {
                modalEl?.remove();
                resolve(null);
            });

            // Charger les bus à proximité
            loadNearbyTrips().then(trips => {
                if (trips.length === 0) {
                    listEl.innerHTML = `
                        <div class="go-no-trips">
                            <p>Aucun bus détecté à proximité.</p>
                            <p class="go-hint">Assurez-vous d'être près d'un arrêt de bus.</p>
                        </div>
                    `;
                } else {
                    listEl.innerHTML = trips.map(trip => `
                        <button class="go-trip-option" data-trip='${JSON.stringify(trip)}'>
                            <span class="go-trip-route" style="background-color: ${trip.routeColor || '#1976D2'}">
                                ${trip.routeName}
                            </span>
                            <span class="go-trip-direction">${trip.direction}</span>
                            <span class="go-trip-time">${trip.nextDeparture || ''}</span>
                        </button>
                    `).join('');

                    // Event listeners pour la sélection
                    listEl.querySelectorAll('.go-trip-option').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const tripData = JSON.parse(btn.dataset.trip);
                            modalEl?.remove();
                            resolve(tripData);
                        });
                    });
                }
            });
        });
    }

    /**
     * Charge les bus à proximité de l'utilisateur
     */
    async function loadNearbyTrips() {
        try {
            // Obtenir la position actuelle
            const position = await getCurrentPosition();
            if (!position) return [];

            // Chercher les arrêts proches
            const nearbyStops = await findNearbyStops(position.coords.latitude, position.coords.longitude);
            
            // Obtenir les prochains départs pour ces arrêts
            const trips = [];
            for (const stop of nearbyStops.slice(0, 5)) { // Max 5 arrêts
                const departures = await getNextDepartures(stop.id);
                for (const dep of departures.slice(0, 3)) { // Max 3 départs par arrêt
                    trips.push({
                        tripId: dep.tripId,
                        routeId: dep.routeId,
                        routeName: dep.routeName,
                        routeColor: dep.routeColor,
                        direction: dep.headsign || dep.direction,
                        nextDeparture: dep.departureTime,
                        stopId: stop.id,
                        stopName: stop.name
                    });
                }
            }

            // Dédupliquer par tripId
            const unique = [];
            const seen = new Set();
            for (const trip of trips) {
                if (!seen.has(trip.tripId)) {
                    seen.add(trip.tripId);
                    unique.push(trip);
                }
            }

            return unique.slice(0, 10); // Max 10 options
        } catch (e) {
            console.error('Erreur chargement bus à proximité:', e);
            return [];
        }
    }

    /**
     * Obtient la position GPS actuelle
     */
    function getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Géolocalisation non supportée'));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                resolve,
                reject,
                { enableHighAccuracy: true, timeout: 10000 }
            );
        });
    }

    /**
     * Trouve les arrêts proches d'une position
     */
    async function findNearbyStops(lat, lng, radiusMeters = 300) {
        // Utiliser le dataManager existant
        if (typeof dataManager !== 'undefined' && dataManager.findNearbyStops) {
            return dataManager.findNearbyStops(lat, lng, radiusMeters);
        }
        
        // Fallback: chercher dans les stops chargés
        if (typeof window.stopsData !== 'undefined') {
            return window.stopsData
                .filter(stop => {
                    const dist = haversineDistance(lat, lng, stop.stop_lat, stop.stop_lon);
                    return dist <= radiusMeters;
                })
                .sort((a, b) => {
                    const distA = haversineDistance(lat, lng, a.stop_lat, a.stop_lon);
                    const distB = haversineDistance(lat, lng, b.stop_lat, b.stop_lon);
                    return distA - distB;
                })
                .map(s => ({ id: s.stop_id, name: s.stop_name, lat: s.stop_lat, lng: s.stop_lon }));
        }

        return [];
    }

    /**
     * Calcule la distance entre deux points GPS (formule de Haversine)
     */
    function haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Rayon de la Terre en mètres
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    /**
     * Obtient les prochains départs pour un arrêt
     */
    async function getNextDepartures(stopId) {
        // Utiliser le dataManager existant
        if (typeof dataManager !== 'undefined' && dataManager.getNextDeparturesForStop) {
            return dataManager.getNextDeparturesForStop(stopId);
        }
        return [];
    }

    /**
     * Démarre le partage de position
     */
    function startSharing(tripId, routeId, routeName, direction) {
        if (state.isActive) {
            console.warn('Partage déjà actif');
            return;
        }

        console.log(`🚌 GO Mode activé: ${routeName} → ${direction}`);

        state.isActive = true;
        state.currentTrip = tripId;
        state.currentRoute = routeId;
        state.sessionStart = Date.now();
        state.positionHistory = [];

        // Mettre à jour l'UI
        updateGoUI(true, routeName, direction);

        // Démarrer le suivi GPS
        if (navigator.geolocation) {
            state.watchId = navigator.geolocation.watchPosition(
                handlePositionUpdate,
                handlePositionError,
                {
                    enableHighAccuracy: true,
                    maximumAge: 3000,
                    timeout: 10000
                }
            );
        }

        // Démarrer l'envoi périodique
        state.intervalId = setInterval(sendPositionToServer, CONFIG.POSITION_INTERVAL);

        // Timer de sécurité (auto-stop après 2h)
        setTimeout(() => {
            if (state.isActive) {
                console.log('⏱️ Session GO auto-stoppée après 2h');
                stopSharing();
            }
        }, CONFIG.MAX_SESSION_DURATION);

        // Notification
        showNotification('GO Mode activé', `Vous partagez votre position sur la ligne ${routeName}`);
    }

    /**
     * Arrête le partage de position
     */
    function stopSharing() {
        if (!state.isActive) return;

        console.log('🛑 GO Mode désactivé');

        // Calculer les points gagnés
        const durationMinutes = Math.floor((Date.now() - state.sessionStart) / 60000);
        const isPeakHour = isCurrentlyPeakHour();
        const pointsEarned = durationMinutes * (isPeakHour ? CONFIG.POINTS_BONUS_PEAK_HOUR : CONFIG.POINTS_PER_MINUTE);

        // Mettre à jour les stats
        state.userStats.totalMinutes += durationMinutes;
        state.userStats.totalTrips += 1;
        state.userStats.totalPoints += pointsEarned;
        state.userStats.level = getUserLevel().name;
        saveUserStats();

        // Arrêter le suivi GPS
        if (state.watchId) {
            navigator.geolocation.clearWatch(state.watchId);
            state.watchId = null;
        }

        // Arrêter l'envoi périodique
        if (state.intervalId) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }

        // Réinitialiser l'état
        state.isActive = false;
        state.currentTrip = null;
        state.currentRoute = null;
        state.sessionStart = null;
        state.lastPosition = null;
        state.positionHistory = [];

        // Mettre à jour l'UI
        updateGoUI(false);

        // Notification
        showNotification('Merci !', `+${pointsEarned} points gagnés. Total: ${state.userStats.totalPoints} pts`);
    }

    /**
     * Vérifie si c'est une heure de pointe
     */
    function isCurrentlyPeakHour() {
        const hour = new Date().getHours();
        return (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
    }

    /**
     * Gère la mise à jour de position GPS
     */
    function handlePositionUpdate(position) {
        if (!state.isActive) return;

        const { latitude, longitude, accuracy, speed, heading } = position.coords;

        // Ignorer les positions trop imprécises
        if (accuracy > CONFIG.MIN_ACCURACY) {
            console.log(`📍 Position ignorée (précision: ${accuracy}m)`);
            return;
        }

        // Vérifier le mouvement minimum
        if (state.lastPosition) {
            const distance = haversineDistance(
                state.lastPosition.lat, state.lastPosition.lng,
                latitude, longitude
            );
            if (distance < CONFIG.MIN_MOVEMENT) {
                return; // Pas assez de mouvement
            }
        }

        const positionData = {
            lat: latitude,
            lng: longitude,
            accuracy,
            speed: speed || 0,
            heading: heading || 0,
            timestamp: Date.now()
        };

        state.lastPosition = positionData;
        state.positionHistory.push(positionData);

        // Garder seulement les 60 dernières positions (5 minutes)
        if (state.positionHistory.length > 60) {
            state.positionHistory.shift();
        }

        console.log(`📍 Position: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (±${accuracy}m)`);
    }

    /**
     * Gère les erreurs de géolocalisation
     */
    function handlePositionError(error) {
        console.error('❌ Erreur GPS:', error.message);
        
        if (error.code === 1) { // Permission refusée
            showNotification('Erreur', 'Permission GPS refusée. Impossible de partager votre position.');
            stopSharing();
        }
    }

    /**
     * Envoie la position au serveur
     */
    async function sendPositionToServer() {
        if (!state.isActive || !state.lastPosition) return;

        const payload = {
            tripId: state.currentTrip,
            routeId: state.currentRoute,
            position: state.lastPosition,
            sessionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            userLevel: getUserLevel().name
        };

        try {
            // En mode production, envoyer au serveur
            // await fetch(CONFIG.SERVER_URL, {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify(payload)
            // });

            // Pour l'instant, stocker localement pour simulation
            storeLocalPosition(payload);
            
            console.log('📤 Position envoyée:', payload.position.lat.toFixed(5), payload.position.lng.toFixed(5));
        } catch (e) {
            console.warn('Erreur envoi position:', e);
        }
    }

    /**
     * Stocke la position localement (pour simulation sans serveur)
     */
    function storeLocalPosition(payload) {
        const key = `crowdsource_${payload.tripId}`;
        let tripData = [];
        
        try {
            const saved = sessionStorage.getItem(key);
            if (saved) tripData = JSON.parse(saved);
        } catch (e) {}

        tripData.push({
            ...payload.position,
            receivedAt: Date.now()
        });

        // Garder seulement les 5 dernières minutes
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        tripData = tripData.filter(p => p.timestamp > fiveMinutesAgo);

        sessionStorage.setItem(key, JSON.stringify(tripData));

        // Mettre à jour la map des contributeurs
        state.contributors.set(payload.tripId, tripData);
    }

    /**
     * Récupère les positions crowdsourcées pour un trip
     */
    function getCrowdsourcedPositions(tripId) {
        // D'abord vérifier le cache local
        if (state.contributors.has(tripId)) {
            return state.contributors.get(tripId);
        }

        // Sinon charger depuis sessionStorage
        try {
            const saved = sessionStorage.getItem(`crowdsource_${tripId}`);
            if (saved) {
                const positions = JSON.parse(saved);
                state.contributors.set(tripId, positions);
                return positions;
            }
        } catch (e) {}

        return [];
    }

    /**
     * Retourne la dernière position connue pour un trip
     */
    function getLatestPosition(tripId) {
        const positions = getCrowdsourcedPositions(tripId);
        if (positions.length === 0) return null;

        // Retourner la plus récente
        return positions.reduce((latest, pos) => {
            return pos.timestamp > (latest?.timestamp || 0) ? pos : latest;
        }, null);
    }

    /**
     * Met à jour l'interface GO
     */
    function updateGoUI(isActive, routeName = '', direction = '') {
        const container = document.getElementById('go-crowdsource-container');
        const button = document.getElementById('go-button');
        const panel = document.getElementById('go-active-panel');
        const routeBadge = container?.querySelector('.go-route-badge');
        const directionEl = container?.querySelector('.go-direction');

        if (!container) return;

        if (isActive) {
            button?.classList.add('hidden');
            panel?.classList.remove('hidden');
            container.classList.add('active');
            
            if (routeBadge) routeBadge.textContent = routeName;
            if (directionEl) directionEl.textContent = `→ ${direction}`;

            // Démarrer le compteur de durée
            startDurationCounter();
        } else {
            button?.classList.remove('hidden');
            panel?.classList.add('hidden');
            container.classList.remove('active');
        }
    }

    /**
     * Démarre le compteur de durée affiché
     */
    function startDurationCounter() {
        const durationEl = document.querySelector('.go-duration');
        const pointsEl = document.querySelector('.go-points');

        const updateCounter = () => {
            if (!state.isActive || !state.sessionStart) return;

            const elapsed = Date.now() - state.sessionStart;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            
            if (durationEl) {
                durationEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }

            const isPeak = isCurrentlyPeakHour();
            const points = minutes * (isPeak ? CONFIG.POINTS_BONUS_PEAK_HOUR : CONFIG.POINTS_PER_MINUTE);
            if (pointsEl) {
                pointsEl.textContent = `+${points} pts${isPeak ? ' 🔥' : ''}`;
            }

            requestAnimationFrame(updateCounter);
        };

        updateCounter();
    }

    /**
     * Affiche le bouton GO (appelé quand l'utilisateur est sur un itinéraire)
     */
    function showGoButton() {
        const container = document.getElementById('go-crowdsource-container');
        if (container) {
            container.classList.remove('hidden');
        }
    }

    /**
     * Cache le bouton GO
     */
    function hideGoButton() {
        const container = document.getElementById('go-crowdsource-container');
        if (container && !state.isActive) {
            container.classList.add('hidden');
        }
    }

    /**
     * Affiche une notification
     */
    function showNotification(title, message) {
        // Utiliser l'API Notification si disponible
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body: message, icon: '/icons/icon-192x192.png' });
        }

        // Aussi afficher un toast dans l'app
        if (typeof uiManager !== 'undefined' && uiManager.showToast) {
            uiManager.showToast(`${title}: ${message}`);
        } else {
            console.log(`📢 ${title}: ${message}`);
        }
    }

    /**
     * Retourne les statistiques de l'utilisateur
     */
    function getUserStats() {
        return {
            ...state.userStats,
            level: getUserLevel(),
            isActive: state.isActive,
            currentTrip: state.currentTrip
        };
    }

    // API publique
    return {
        init,
        startSharing,
        stopSharing,
        startSharingFromItinerary,
        getUserStats,
        getUserLevel,
        getLatestPosition,
        getCrowdsourcedPositions,
        isActive: () => state.isActive,
        getState: () => state,
        haversineDistance
    };
})();

// Auto-initialisation
document.addEventListener('DOMContentLoaded', () => {
    CrowdsourcingManager.init();
});

// Export pour utilisation dans d'autres modules
if (typeof window !== 'undefined') {
    window.CrowdsourcingManager = CrowdsourcingManager;
}
