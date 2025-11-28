/**
 * formatters.js - Fonctions utilitaires de formatage
 * 
 * Ce module centralise toutes les fonctions de formatage de temps,
 * durées, distances, et autres valeurs textuelles.
 */

// === Constantes ===

const PLACEHOLDER_TIME_VALUES = new Set(['--:--', '~']);
const PLACEHOLDER_TEXT_VALUES = new Set(['undefined', 'null', '--', '--:--', '—', 'n/a', 'na']);

// === Fonctions de validation ===

/**
 * Vérifie si une valeur temporelle est significative
 * @param {string} value - Valeur à vérifier
 * @returns {boolean}
 */
export function isMeaningfulTime(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (trimmed.length === 0) return false;
    return !PLACEHOLDER_TIME_VALUES.has(trimmed);
}

/**
 * Vérifie si une valeur texte est manquante ou placeholder
 * @param {*} value - Valeur à vérifier
 * @returns {boolean}
 */
export function isMissingTextValue(value) {
    if (value === undefined || value === null) return true;
    if (typeof value === 'number') return false;
    const trimmed = String(value).trim();
    if (!trimmed) return true;
    const normalized = trimmed.toLowerCase();
    if (PLACEHOLDER_TEXT_VALUES.has(normalized)) return true;
    if (/^[-–—\s:._]+$/.test(trimmed)) return true;
    return normalized === 'inconnu' || normalized === 'unknown';
}

// === Fonctions de formatage sécurisé ===

/**
 * Retourne un label d'arrêt sécurisé (avec fallback)
 * @param {*} value - Valeur à afficher
 * @param {string} fallback - Valeur par défaut
 * @returns {string}
 */
export function getSafeStopLabel(value, fallback = 'Arrêt à préciser') {
    return isMissingTextValue(value) ? fallback : value;
}

/**
 * Retourne un label de temps sécurisé (avec fallback)
 * @param {*} value - Valeur à afficher
 * @param {string} fallback - Valeur par défaut
 * @returns {string}
 */
export function getSafeTimeLabel(value, fallback = '--:--') {
    return isMissingTextValue(value) ? fallback : value;
}

/**
 * Retourne un label de badge de route sécurisé
 * @param {*} value - Valeur à afficher
 * @param {string} fallback - Valeur par défaut
 * @returns {string}
 */
export function getSafeRouteBadgeLabel(value, fallback = 'BUS') {
    return isMissingTextValue(value) ? fallback : value;
}

/**
 * Vérifie si un arrêt a des métadonnées (nom ou heure)
 * @param {string} stopName - Nom de l'arrêt
 * @param {string} timeValue - Heure
 * @returns {boolean}
 */
export function hasStopMetadata(stopName, timeValue) {
    return !isMissingTextValue(stopName) || !isMissingTextValue(timeValue);
}

// === Fonctions de parsing de temps ===

/**
 * Parse une chaîne de temps (HH:MM) en minutes
 * @param {string} value - Temps au format HH:MM
 * @returns {number|null}
 */
export function parseTimeStringToMinutes(value) {
    if (!isMeaningfulTime(value)) return null;
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 60 + minutes;
}

/**
 * Formate des minutes en chaîne de temps HH:MM
 * @param {number} totalMinutes - Nombre de minutes
 * @returns {string|null}
 */
export function formatMinutesToTimeString(totalMinutes) {
    if (!Number.isFinite(totalMinutes)) return null;
    const dayMinutes = 24 * 60;
    while (totalMinutes < 0) totalMinutes += dayMinutes;
    const minutes = Math.abs(totalMinutes) % 60;
    const hours = Math.floor(totalMinutes / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Ajoute des secondes à une chaîne de temps
 * @param {string} timeStr - Temps au format HH:MM
 * @param {number} seconds - Secondes à ajouter
 * @returns {string|null}
 */
export function addSecondsToTimeString(timeStr, seconds) {
    const baseMinutes = parseTimeStringToMinutes(timeStr);
    if (baseMinutes === null || !Number.isFinite(seconds)) return null;
    const totalMinutes = baseMinutes + Math.round(seconds / 60);
    return formatMinutesToTimeString(totalMinutes);
}

/**
 * Soustrait des secondes d'une chaîne de temps
 * @param {string} timeStr - Temps au format HH:MM
 * @param {number} seconds - Secondes à soustraire
 * @returns {string|null}
 */
export function subtractSecondsFromTimeString(timeStr, seconds) {
    const baseMinutes = parseTimeStringToMinutes(timeStr);
    if (baseMinutes === null || !Number.isFinite(seconds)) return null;
    const totalMinutes = baseMinutes - Math.round(seconds / 60);
    return formatMinutesToTimeString(totalMinutes);
}

/**
 * Calcule la différence en minutes entre deux temps
 * @param {string} startTime - Temps de début (HH:MM)
 * @param {string} endTime - Temps de fin (HH:MM)
 * @returns {number|null}
 */
export function computeTimeDifferenceMinutes(startTime, endTime) {
    const startMinutes = parseTimeStringToMinutes(startTime);
    const endMinutes = parseTimeStringToMinutes(endTime);
    if (startMinutes === null || endMinutes === null) return null;
    let diff = endMinutes - startMinutes;
    if (diff < 0) diff += 24 * 60;
    return diff;
}

// === Fonctions de formatage Google ===

/**
 * Formate un temps ISO de Google en HH:MM
 * @param {string} isoTime - Temps ISO
 * @returns {string}
 */
export function formatGoogleTime(isoTime) {
    if (!isoTime) return "--:--";
    try {
        const date = new Date(isoTime);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    } catch (e) {
        return "--:--";
    }
}

/**
 * Formate une durée Google (ex: "1800s") en "30 min"
 * @param {string} durationString - Durée au format Google
 * @returns {string}
 */
export function formatGoogleDuration(durationString) {
    if (!durationString) return "";
    try {
        const seconds = parseInt(durationString.slice(0, -1));
        if (isNaN(seconds) || seconds < 1) return "";
        
        const minutes = Math.round(seconds / 60);
        if (minutes < 1) return "< 1 min";
        if (minutes > 60) {
            const h = Math.floor(minutes / 60);
            const m = minutes % 60;
            return m === 0 ? `${h}h` : `${h}h ${m}min`;
        }
        return `${minutes} min`;
    } catch (e) {
        return "";
    }
}

/**
 * Parse une durée Google (ex: "1800s") en nombre de secondes
 * @param {string} durationString - Durée au format Google
 * @returns {number}
 */
export function parseGoogleDuration(durationString) {
    if (!durationString) return 0;
    try {
        return parseInt(durationString.slice(0, -1)) || 0;
    } catch (e) {
        return 0;
    }
}

// === Fonctions de formatage d'horloge ===

/**
 * Formate des secondes en chaîne HH:MM:SS
 * @param {number} seconds - Secondes depuis minuit
 * @returns {string}
 */
export function formatSecondsToClockString(seconds) {
    const hours = Math.floor(seconds / 3600) % 24;
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Formate une date en chaîne locale courte (ex: "lun. 28 nov.")
 * @param {Date} date - Date à formater
 * @returns {string}
 */
export function formatDateShort(date) {
    return date.toLocaleDateString('fr-FR', { 
        weekday: 'short', 
        day: 'numeric', 
        month: 'short' 
    });
}

/**
 * Formate une date pour le sélecteur de date
 * @param {Date} dateObj - Date à formater
 * @param {number} offset - Offset en jours depuis aujourd'hui
 * @returns {string}
 */
export function formatDateLabel(dateObj, offset) {
    if (offset === 0) return "Aujourd'hui";
    if (offset === 1) return 'Demain';
    const formatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
    return formatter.format(dateObj);
}

export default {
    isMeaningfulTime,
    isMissingTextValue,
    getSafeStopLabel,
    getSafeTimeLabel,
    getSafeRouteBadgeLabel,
    hasStopMetadata,
    parseTimeStringToMinutes,
    formatMinutesToTimeString,
    addSecondsToTimeString,
    subtractSecondsFromTimeString,
    computeTimeDifferenceMinutes,
    formatGoogleTime,
    formatGoogleDuration,
    parseGoogleDuration,
    formatSecondsToClockString,
    formatDateShort,
    formatDateLabel
};
