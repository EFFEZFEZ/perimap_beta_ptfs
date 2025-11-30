/**
 * Crowdsourcing Module - Système de partage de position des bus
 * Inspiré de Transit App "GO" mode
 * 
 * V62 - Détection automatique de fin de trajet
 * 
 * Permet aux utilisateurs de partager leur position GPS quand ils sont dans un bus,
 * ce qui améliore le suivi en temps réel pour tous les autres utilisateurs.
 * 
 * DÉTECTION AUTOMATIQUE D'ARRÊT:
 * - Immobilité prolongée (> 3 min sans mouvement significatif)
 * - Vitesse de marche détectée (< 2 m/s pendant > 1 min)
 * - Sortie de zone du trajet (> 500m de l'itinéraire prévu)
 * - Fermeture de l'application/onglet
 * - Arrivée à destination (proche du dernier arrêt)
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
        POINTS_BONUS_PEAK_HOUR: 2,

        // === DÉTECTION AUTOMATIQUE D'ARRÊT ===
        
        // Durée d'immobilité avant auto-stop (en ms) - 3 minutes
        IMMOBILITY_TIMEOUT: 3 * 60 * 1000,
        
        // Vitesse max considérée comme "marche" (en m/s) - environ 7 km/h
        WALKING_SPEED_THRESHOLD: 2.0,
        
        // Durée de marche avant auto-stop (en ms) - 1 minute
        WALKING_TIMEOUT: 60 * 1000,
        
        // Distance max du trajet prévu avant alerte (en mètres)
        OFF_ROUTE_THRESHOLD: 500,
        
        // Distance du dernier arrêt pour considérer arrivée (en mètres)
        ARRIVAL_THRESHOLD: 100,
        
        // Intervalle de vérification des conditions d'arrêt (en ms)
        CHECK_INTERVAL: 10000 // 10 secondes
    };

    // État
    let state = {
        isActive: false,
        currentTrip: null,
        currentRoute: null,
        currentRouteName: '',
        currentDirection: '',
        watchId: null,
        intervalId: null,
        checkIntervalId: null, // Nouveau: vérification auto-stop
        sessionStart: null,
        lastPosition: null,
        lastMovementTime: null, // Nouveau: timestamp du dernier mouvement
        walkingStartTime: null, // Nouveau: début de détection marche
        positionHistory: [],
        contributors: new Map(),
        animationFrameId: null,
        
        // Infos du trajet pour détection
        destinationStop: null,
        routeStops: [],
        
        userStats: {
            totalMinutes: 0,
            totalTrips: 0,
            totalPoints: 0,
            level: 1
        }
    };

    // Référence au dataManager
    let dataManagerRef = null;

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
        
        // Essayer de récupérer le dataManager global
        if (typeof window !== 'undefined' && window.dataManager) {
            dataManagerRef = window.dataManager;
        }
        
        console.log('🚌 Crowdsourcing initialisé. Niveau:', getUserLevel().name);
    }

    /**
     * Injecte la référence au dataManager
     */
    function setDataManager(dm) {
        dataManagerRef = dm;
    }

    /**
     * Charge les stats utilisateur depuis le stockage local
     */
    function loadUserStats() {
        try {
            const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (saved) {
                state.userStats = { ...state.userStats, ...JSON.parse(saved) };
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
     * Démarre le partage depuis un itinéraire affiché
     * Appelé depuis le bouton GO dans le detail panel
     */
    function startSharingFromItinerary(itinerary) {
        if (!itinerary || !itinerary.steps) {
            console.warn('❌ Crowdsourcing: Itinéraire invalide pour le partage');
            showToast('Impossible de démarrer le partage', 'error');
            return false;
        }

        // Trouver le premier step de type BUS
        const busStep = itinerary.steps.find(step => step.type === 'BUS');
        if (!busStep) {
            console.warn('❌ Crowdsourcing: Aucune étape bus trouvée');
            showToast('Aucun trajet bus dans cet itinéraire', 'warning');
            return false;
        }

        // Extraire les infos du bus
        const tripId = busStep.tripId || busStep.trip?.trip_id || `trip_${Date.now()}`;
        const routeId = busStep.routeId || busStep.route?.route_id || '';
        const routeName = busStep.routeShortName || busStep.routeName || busStep.line || 'Bus';
        const direction = busStep.headsign || busStep.direction || busStep.instruction || 'Direction inconnue';
        const routeColor = busStep.routeColor || busStep.route?.route_color || '#1976D2';

        // ======== EXTRACTION DES DONNÉES POUR DÉTECTION AUTOMATIQUE ========
        // Stocker la destination (dernier arrêt du trajet bus)
        if (busStep.endLocation || busStep.to) {
            const dest = busStep.endLocation || busStep.to;
            state.destinationStop = {
                lat: dest.lat || dest.latitude,
                lng: dest.lng || dest.longitude,
                name: dest.name || dest.stopName || 'Destination'
            };
            console.log('🎯 Destination enregistrée:', state.destinationStop.name);
        }
        
        // Stocker les arrêts intermédiaires si disponibles
        if (busStep.stops && Array.isArray(busStep.stops)) {
            state.routeStops = busStep.stops.map(s => ({
                lat: s.lat || s.stop_lat,
                lng: s.lng || s.stop_lon,
                name: s.name || s.stop_name
            })).filter(s => s.lat && s.lng);
            console.log(`🚏 ${state.routeStops.length} arrêts enregistrés pour détection`);
        } else if (busStep.polyline || busStep.path) {
            // Utiliser les points du polyline comme approximation
            const points = busStep.path || [];
            state.routeStops = points.filter((_, i) => i % 5 === 0).map(p => ({
                lat: p.lat || p[0],
                lng: p.lng || p[1]
            }));
        }

        console.log('🚌 Démarrage GO depuis itinéraire:', { tripId, routeId, routeName, direction });

        // Démarrer le partage
        return startSharing(tripId, routeId, routeName, direction, routeColor);
    }

    /**
     * Démarre le partage de position
     */
    function startSharing(tripId, routeId, routeName, direction, routeColor = '#1976D2') {
        if (state.isActive) {
            console.warn('⚠️ Partage déjà actif');
            return false;
        }

        // Vérifier la géolocalisation
        if (!navigator.geolocation) {
            showToast('Géolocalisation non disponible', 'error');
            return false;
        }

        console.log(`🚌 GO Mode activé: ${routeName} → ${direction}`);

        state.isActive = true;
        state.currentTrip = tripId;
        state.currentRoute = routeId;
        state.currentRouteName = routeName;
        state.currentDirection = direction;
        state.sessionStart = Date.now();
        state.positionHistory = [];
        state.lastPosition = null;

        // Mettre à jour l'UI du bouton
        updateButtonUI(true, routeName, direction, routeColor);

        // Démarrer le suivi GPS
        state.watchId = navigator.geolocation.watchPosition(
            handlePositionUpdate,
            handlePositionError,
            {
                enableHighAccuracy: true,
                maximumAge: 3000,
                timeout: 10000
            }
        );

        // Démarrer l'envoi périodique
        state.intervalId = setInterval(sendPositionToServer, CONFIG.POSITION_INTERVAL);

        // Timer de sécurité (auto-stop après 2h)
        setTimeout(() => {
            if (state.isActive) {
                console.log('⏱️ Session GO auto-stoppée après 2h');
                stopSharing('timeout');
            }
        }, CONFIG.MAX_SESSION_DURATION);

        // ======== DÉTECTION AUTOMATIQUE D'ARRÊT ========
        // Initialiser les timestamps de détection
        state.lastMovementTime = Date.now();
        state.walkingStartTime = null;
        
        // Démarrer la vérification périodique des conditions d'arrêt
        state.checkIntervalId = setInterval(checkAutoStopConditions, CONFIG.CHECK_INTERVAL);
        
        // Écouter la fermeture de l'onglet/app
        window.addEventListener('beforeunload', handlePageUnload);
        window.addEventListener('pagehide', handlePageUnload);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Notification
        showToast(`GO activé sur ligne ${routeName}`, 'success');

        return true;
    }

    /**
     * Vérifie les conditions d'arrêt automatique
     * Appelé toutes les 10 secondes
     */
    function checkAutoStopConditions() {
        if (!state.isActive) return;

        const now = Date.now();
        const history = state.positionHistory;
        
        // 1. DÉTECTION D'IMMOBILITÉ
        if (state.lastMovementTime && (now - state.lastMovementTime) > CONFIG.IMMOBILITY_TIMEOUT) {
            console.log('🛑 Auto-stop: Immobilité détectée (> 3 min sans mouvement)');
            showToast('Vous semblez être descendu du bus', 'info');
            stopSharing('immobility');
            return;
        }

        // 2. DÉTECTION DE MARCHE (vitesse faible prolongée)
        if (history.length >= 3) {
            const recentPositions = history.slice(-6); // Dernière minute environ
            const avgSpeed = calculateAverageSpeed(recentPositions);
            
            if (avgSpeed > 0 && avgSpeed < CONFIG.WALKING_SPEED_THRESHOLD) {
                // Vitesse de marche détectée
                if (!state.walkingStartTime) {
                    state.walkingStartTime = now;
                    console.log('👟 Vitesse de marche détectée, surveillance...');
                } else if ((now - state.walkingStartTime) > CONFIG.WALKING_TIMEOUT) {
                    console.log('🛑 Auto-stop: Marche détectée (vitesse < 2 m/s pendant > 1 min)');
                    showToast('Vous semblez marcher, arrêt du partage', 'info');
                    stopSharing('walking');
                    return;
                }
            } else {
                // Vitesse normale, réinitialiser
                state.walkingStartTime = null;
            }
        }

        // 3. DÉTECTION D'ARRIVÉE À DESTINATION
        if (state.destinationStop && state.lastPosition) {
            const distToDestination = haversineDistance(
                state.lastPosition.lat, state.lastPosition.lng,
                state.destinationStop.lat, state.destinationStop.lng
            );
            
            if (distToDestination < CONFIG.ARRIVAL_THRESHOLD) {
                console.log('🎯 Auto-stop: Arrivée à destination détectée');
                showToast('Arrivée à destination !', 'success');
                stopSharing('arrival');
                return;
            }
        }

        // 4. DÉTECTION DE SORTIE DE ZONE (trop loin du trajet)
        if (state.routeStops.length > 0 && state.lastPosition) {
            const minDistToRoute = findMinDistanceToRoute(state.lastPosition);
            
            if (minDistToRoute > CONFIG.OFF_ROUTE_THRESHOLD) {
                console.log('🛑 Auto-stop: Sortie de zone (> 500m du trajet)');
                showToast('Vous semblez avoir quitté le bus', 'info');
                stopSharing('off_route');
                return;
            }
        }
    }

    /**
     * Calcule la vitesse moyenne à partir de positions récentes
     */
    function calculateAverageSpeed(positions) {
        if (positions.length < 2) return 0;
        
        let totalSpeed = 0;
        let validCount = 0;
        
        for (let i = 1; i < positions.length; i++) {
            const prev = positions[i - 1];
            const curr = positions[i];
            
            const distance = haversineDistance(prev.lat, prev.lng, curr.lat, curr.lng);
            const timeDiff = (curr.timestamp - prev.timestamp) / 1000; // en secondes
            
            if (timeDiff > 0) {
                const speed = distance / timeDiff;
                // Utiliser la vitesse GPS si disponible et valide
                if (curr.speed > 0) {
                    totalSpeed += curr.speed;
                } else {
                    totalSpeed += speed;
                }
                validCount++;
            }
        }
        
        return validCount > 0 ? totalSpeed / validCount : 0;
    }

    /**
     * Trouve la distance minimale entre la position actuelle et le trajet
     */
    function findMinDistanceToRoute(position) {
        if (!state.routeStops || state.routeStops.length === 0) {
            return 0; // Pas de données, on ne peut pas vérifier
        }
        
        let minDist = Infinity;
        
        for (const stop of state.routeStops) {
            const dist = haversineDistance(
                position.lat, position.lng,
                stop.lat, stop.lng
            );
            if (dist < minDist) {
                minDist = dist;
            }
        }
        
        return minDist;
    }

    /**
     * Gère la fermeture de page/onglet
     */
    function handlePageUnload(event) {
        if (state.isActive) {
            console.log('🛑 Auto-stop: Fermeture de page détectée');
            stopSharing('page_close');
        }
    }

    /**
     * Gère le changement de visibilité (app en arrière-plan)
     */
    function handleVisibilityChange() {
        if (document.hidden && state.isActive) {
            // App passée en arrière-plan - on continue mais on note
            console.log('📱 App en arrière-plan, GO mode continue...');
            // On pourrait aussi arrêter si l'app reste en arrière-plan trop longtemps
        }
    }

    /**
     * Arrête le partage de position
     * @param {string} reason - Raison de l'arrêt (optionnel pour logging)
     */
    function stopSharing(reason = 'manual') {
        if (!state.isActive) return;

        console.log(`🛑 GO Mode désactivé (raison: ${reason})`);

        // Arrêter l'animation
        if (state.animationFrameId) {
            cancelAnimationFrame(state.animationFrameId);
            state.animationFrameId = null;
        }

        // ======== NETTOYAGE DÉTECTION AUTOMATIQUE ========
        // Arrêter la vérification périodique
        if (state.checkIntervalId) {
            clearInterval(state.checkIntervalId);
            state.checkIntervalId = null;
        }
        
        // Retirer les listeners
        window.removeEventListener('beforeunload', handlePageUnload);
        window.removeEventListener('pagehide', handlePageUnload);
        document.removeEventListener('visibilitychange', handleVisibilityChange);

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
        if (state.watchId !== null) {
            navigator.geolocation.clearWatch(state.watchId);
            state.watchId = null;
        }

        // Arrêter l'envoi périodique
        if (state.intervalId) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }

        // Réinitialiser l'état
        const routeName = state.currentRouteName;
        state.isActive = false;
        state.currentTrip = null;
        state.currentRoute = null;
        state.currentRouteName = '';
        state.currentDirection = '';
        state.sessionStart = null;
        state.lastPosition = null;
        state.positionHistory = [];
        
        // Réinitialiser les données de détection automatique
        state.lastMovementTime = null;
        state.walkingStartTime = null;
        state.destinationStop = null;
        state.routeStops = [];

        // Mettre à jour l'UI du bouton
        updateButtonUI(false);

        // Notification
        if (pointsEarned > 0) {
            showToast(`Merci ! +${pointsEarned} points (Total: ${state.userStats.totalPoints})`, 'success');
        } else {
            showToast('Partage arrêté', 'info');
        }
    }

    /**
     * Met à jour l'UI du bouton GO dans le detail panel
     */
    function updateButtonUI(isActive, routeName = '', direction = '', routeColor = '#4CAF50') {
        const btn = document.getElementById('go-start-sharing-btn');
        const container = btn?.closest('.go-contribution-content');
        
        if (!btn) return;

        if (isActive) {
            btn.innerHTML = `
                <span class="go-btn-icon" style="background: #f44336;">✕</span>
                <span>Arrêter</span>
            `;
            btn.style.background = 'linear-gradient(135deg, #f44336, #d32f2f)';
            btn.onclick = () => stopSharing();

            // Ajouter indicateur de durée
            const textDiv = container?.querySelector('.go-contribution-text');
            if (textDiv) {
                textDiv.innerHTML = `
                    <strong style="color: #4CAF50;">🟢 GO actif - Ligne ${routeName}</strong>
                    <span class="go-active-info">
                        <span class="go-duration">0:00</span> • 
                        <span class="go-points">+0 pts</span>
                    </span>
                `;
                startDurationCounter();
            }
        } else {
            btn.innerHTML = `
                <span class="go-btn-icon">GO</span>
                <span>Partager</span>
            `;
            btn.style.background = 'linear-gradient(135deg, #4CAF50, #43A047)';
            // Le onclick sera réattaché par main.js lors du prochain rendu

            // Restaurer le texte original
            const textDiv = container?.querySelector('.go-contribution-text');
            if (textDiv) {
                textDiv.innerHTML = `
                    <strong>Vous êtes dans ce bus ?</strong>
                    <span>Aidez les autres usagers en partageant votre position en temps réel</span>
                `;
            }
        }
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
            console.log(`📍 Position ignorée (précision: ${Math.round(accuracy)}m > ${CONFIG.MIN_ACCURACY}m)`);
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
            
            // ======== DÉTECTION DE MOUVEMENT ========
            // Mouvement significatif détecté, mettre à jour le timestamp
            state.lastMovementTime = Date.now();
        } else {
            // Première position, initialiser le timestamp
            state.lastMovementTime = Date.now();
        }

        const positionData = {
            lat: latitude,
            lng: longitude,
            accuracy: Math.round(accuracy),
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

        console.log(`📍 Position: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (±${Math.round(accuracy)}m, ${speed ? (speed * 3.6).toFixed(1) + ' km/h' : 'vitesse N/A'})`);
    }

    /**
     * Gère les erreurs de géolocalisation
     */
    function handlePositionError(error) {
        console.error('❌ Erreur GPS:', error.message);
        
        if (error.code === 1) { // Permission refusée
            showToast('Permission GPS refusée', 'error');
            stopSharing();
        } else if (error.code === 2) { // Position indisponible
            console.warn('⚠️ Position GPS temporairement indisponible');
        } else if (error.code === 3) { // Timeout
            console.warn('⚠️ Timeout GPS');
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
            routeName: state.currentRouteName,
            position: state.lastPosition,
            sessionId: `session_${state.sessionStart}`,
            userLevel: getUserLevel().name
        };

        try {
            // Stocker localement (simulation sans serveur backend)
            storeLocalPosition(payload);
            
            console.log('📤 Position stockée:', payload.position.lat.toFixed(5), payload.position.lng.toFixed(5));

            // TODO: Activer quand le backend sera prêt
            // const response = await fetch(CONFIG.SERVER_URL, {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify(payload)
            // });
            // if (!response.ok) throw new Error(`HTTP ${response.status}`);

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
        } catch (e) {
            tripData = [];
        }

        tripData.push({
            ...payload.position,
            routeName: payload.routeName,
            receivedAt: Date.now()
        });

        // Garder seulement les 5 dernières minutes
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        tripData = tripData.filter(p => p.timestamp > fiveMinutesAgo);

        try {
            sessionStorage.setItem(key, JSON.stringify(tripData));
        } catch (e) {
            console.warn('Erreur stockage sessionStorage:', e);
        }

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
        } catch (e) {
            console.warn('Erreur lecture crowdsource:', e);
        }

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
     * Démarre le compteur de durée affiché
     */
    function startDurationCounter() {
        // Annuler l'animation précédente si elle existe
        if (state.animationFrameId) {
            cancelAnimationFrame(state.animationFrameId);
        }

        const updateCounter = () => {
            if (!state.isActive || !state.sessionStart) {
                return; // Arrêter la boucle
            }

            const durationEl = document.querySelector('.go-duration');
            const pointsEl = document.querySelector('.go-points');

            if (!durationEl && !pointsEl) {
                return; // Éléments non trouvés, arrêter
            }

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

            state.animationFrameId = requestAnimationFrame(updateCounter);
        };

        state.animationFrameId = requestAnimationFrame(updateCounter);
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
     * Affiche une notification toast
     */
    function showToast(message, type = 'info') {
        // Utiliser le uiManager si disponible
        if (typeof window !== 'undefined' && window.uiManager?.showToast) {
            window.uiManager.showToast(message);
            return;
        }

        // Fallback: créer un toast simple
        const existingToast = document.querySelector('.go-toast');
        if (existingToast) existingToast.remove();

        const toast = document.createElement('div');
        toast.className = `go-toast go-toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4CAF50' : '#333'};
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: fadeInUp 0.3s ease;
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    /**
     * Retourne les statistiques de l'utilisateur
     */
    function getUserStats() {
        return {
            ...state.userStats,
            level: getUserLevel(),
            isActive: state.isActive,
            currentTrip: state.currentTrip,
            currentRouteName: state.currentRouteName
        };
    }

    // API publique
    return {
        init,
        setDataManager,
        startSharing,
        stopSharing,
        startSharingFromItinerary,
        getUserStats,
        getUserLevel,
        getLatestPosition,
        getCrowdsourcedPositions,
        isActive: () => state.isActive,
        getState: () => ({ ...state }),
        haversineDistance
    };
})();

// Auto-initialisation après chargement du DOM
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => CrowdsourcingManager.init());
    } else {
        CrowdsourcingManager.init();
    }
}

// Export pour utilisation dans d'autres modules
if (typeof window !== 'undefined') {
    window.CrowdsourcingManager = CrowdsourcingManager;
}
