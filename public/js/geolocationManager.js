function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function waitForGeocodingCompletion(state) {
    if (!state.isGeocoding) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const intervalId = setInterval(() => {
            if (!state.isGeocoding) {
                clearInterval(intervalId);
                resolve();
            }
        }, 100);
    });
}

export function createGeolocationManager({ apiManager, icons = {}, onUserLocationUpdate, onUserLocationError } = {}) {
    const state = {
        userLocation: null,
        userPlaceId: null,
        isGeocoding: false,
        lastGeocodeTime: 0,
        lastGeocodePos: null,
        hallButton: null,
        resultsButton: null,
        watchId: null
    };

    const iconLocate = icons.GEOLOCATE || '';
    const iconSpinner = icons.GEOLOCATE_SPINNER || '';

    const enableButtons = () => {
        if (state.hallButton) state.hallButton.disabled = false;
        if (state.resultsButton) state.resultsButton.disabled = false;
    };

    const disableButtons = () => {
        if (state.hallButton) state.hallButton.disabled = true;
        if (state.resultsButton) state.resultsButton.disabled = true;
    };

    const setButtonIdle = (btn) => {
        if (!btn) return;
        btn.innerHTML = iconLocate;
        btn.disabled = false;
    };

    const setButtonBusy = (btn) => {
        if (!btn) return;
        btn.innerHTML = iconSpinner;
        btn.disabled = true;
    };

    const reverseGeocodeUserLocation = async (lat, lng) => {
        if (!apiManager || typeof apiManager.reverseGeocode !== 'function') {
            console.warn('Aucun apiManager.reverseGeocode disponible');
            return;
        }
        if (state.isGeocoding) {
            return;
        }
        state.isGeocoding = true;
        try {
            const placeId = await apiManager.reverseGeocode(lat, lng);
            state.userPlaceId = placeId || null;
            if (placeId) {
                console.log('Géolocalisation inversée réussie, place_id:', placeId);
            }
        } catch (error) {
            console.error('Erreur lors de la géolocalisation inversée:', error);
            state.userPlaceId = null;
        } finally {
            state.isGeocoding = false;
        }
    };

    const handleGeolocationSuccess = (position) => {
        const newLat = position.coords.latitude;
        const newLng = position.coords.longitude;

        if (state.userLocation) {
            const dist = getDistanceFromLatLonInM(state.userLocation.lat, state.userLocation.lng, newLat, newLng);
            if (dist < 10) {
                return;
            }
        }

        state.userLocation = { lat: newLat, lng: newLng };
        enableButtons();

        if (typeof onUserLocationUpdate === 'function') {
            onUserLocationUpdate(state.userLocation);
        }

        const now = Date.now();
        const MIN_TIME_BETWEEN_CALLS = 60000;
        const MIN_DIST_BETWEEN_CALLS = 200;
        let shouldCallApi = false;

        if (!state.lastGeocodeTime) {
            shouldCallApi = true;
        } else if (state.userPlaceId === null && !state.isGeocoding) {
            shouldCallApi = true;
        } else {
            const timeElapsed = now - state.lastGeocodeTime;
            let distFromLastCall = 0;
            if (state.lastGeocodePos) {
                distFromLastCall = getDistanceFromLatLonInM(state.lastGeocodePos.lat, state.lastGeocodePos.lng, newLat, newLng);
            }
            if (timeElapsed > MIN_TIME_BETWEEN_CALLS || distFromLastCall > MIN_DIST_BETWEEN_CALLS) {
                shouldCallApi = true;
            }
        }

        if (shouldCallApi && !state.isGeocoding) {
            reverseGeocodeUserLocation(newLat, newLng);
            state.lastGeocodeTime = now;
            state.lastGeocodePos = { lat: newLat, lng: newLng };
        }
    };

    const handleGeolocationError = (error) => {
        console.warn(`Erreur de géolocalisation (code ${error.code}): ${error.message}`);
        disableButtons();
        if (typeof onUserLocationError === 'function') {
            onUserLocationError(error);
        }
    };

    const startWatching = ({ hallButton, resultsButton } = {}) => {
        state.hallButton = hallButton || state.hallButton;
        state.resultsButton = resultsButton || state.resultsButton;

        if (state.hallButton) {
            state.hallButton.innerHTML = iconLocate;
        }
        if (state.resultsButton) {
            state.resultsButton.innerHTML = iconLocate;
        }

        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            console.warn("La géolocalisation n'est pas supportée par ce navigateur.");
            disableButtons();
            return;
        }

        if (state.watchId !== null) {
            return;
        }

        state.watchId = navigator.geolocation.watchPosition(
            handleGeolocationSuccess,
            handleGeolocationError,
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    };

    const useCurrentLocationAsDeparture = async ({ fromInput, toInput, geolocateBtn, onPlaceResolved } = {}) => {
        if (!state.userLocation) {
            alert('Impossible de récupérer votre position. Avez-vous autorisé la géolocalisation ?');
            return;
        }

        const targetBtn = geolocateBtn || state.hallButton || state.resultsButton;
        setButtonBusy(targetBtn);

        if (!state.userPlaceId || state.isGeocoding) {
            console.log('Attente du reverse geocoding...');
            await waitForGeocodingCompletion(state);
        }

        if (!state.userPlaceId) {
            alert("Impossible de convertir votre position en adresse pour le planificateur. Veuillez réessayer.");
            setButtonIdle(targetBtn);
            return;
        }

        if (typeof onPlaceResolved === 'function') {
            onPlaceResolved(state.userPlaceId);
        }

        if (fromInput) {
            fromInput.value = 'Ma Position';
        }
        if (toInput) {
            toInput.focus();
        }

        setButtonIdle(targetBtn);
    };

    const getUserLocation = () => state.userLocation ? { ...state.userLocation } : null;
    const getUserPlaceId = () => state.userPlaceId;

    return {
        startWatching,
        useCurrentLocationAsDeparture,
        handleGeolocationSuccess,
        handleGeolocationError,
        getUserLocation,
        getUserPlaceId
    };
}
