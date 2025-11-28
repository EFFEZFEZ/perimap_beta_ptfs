/**
 * detailRenderer.js - Rendu des détails d'itinéraire
 * 
 * Ce module gère la génération du HTML pour les détails d'itinéraire
 * (accordéon PC et vue mobile) ainsi que les tracés sur la carte.
 */

import { 
    getSafeStopLabel, 
    getSafeTimeLabel, 
    getSafeRouteBadgeLabel,
    isMissingTextValue 
} from '../utils/formatters.js';

// === Constantes ===

/**
 * Priorité des rôles d'arrêt pour les marqueurs
 */
export const STOP_ROLE_PRIORITY = {
    boarding: 3,
    alighting: 3,
    transfer: 2,
    intermediate: 1
};

// === Fonctions utilitaires ===

/**
 * Vérifie si une étape est une étape d'attente/correspondance
 * @param {Object} step - Étape à vérifier
 * @returns {boolean}
 */
export function isWaitStep(step) {
    if (!step) return false;
    if (step.type === 'WAIT') return true;
    const instruction = (step.instruction || '').toLowerCase();
    const looksLikeWait = instruction.includes('correspondance') || 
                          instruction.includes('attente') || 
                          instruction.includes('transfert');
    const missingRoute = isMissingTextValue(step.routeShortName);
    const missingStops = isMissingTextValue(step.departureStop) && isMissingTextValue(step.arrivalStop);
    return looksLikeWait && (missingRoute || missingStops);
}

/**
 * Vérifie si une étape BUS doit être supprimée (données incomplètes)
 * @param {Object} step - Étape à vérifier
 * @returns {boolean}
 */
export function shouldSuppressBusStep(step) {
    if (!step || step.type !== 'BUS') return false;
    // Supprimer si pas de nom de ligne valide
    if (isMissingTextValue(step.routeShortName)) return true;
    // Supprimer si pas d'arrêts
    if (isMissingTextValue(step.departureStop) && isMissingTextValue(step.arrivalStop)) return true;
    return false;
}

/**
 * Récupère l'icône de manœuvre pour les étapes de marche
 * @param {string} maneuver - Type de manœuvre
 * @param {Object} icons - Objet contenant les icônes SVG
 * @returns {string} - HTML de l'icône
 */
export function getManeuverIcon(maneuver, icons) {
    if (!icons?.MANEUVER) return '';
    switch(maneuver) {
        case 'TURN_LEFT': return icons.MANEUVER.TURN_LEFT;
        case 'TURN_RIGHT': return icons.MANEUVER.TURN_RIGHT;
        case 'TURN_SLIGHT_LEFT': return icons.MANEUVER.TURN_SLIGHT_LEFT;
        case 'TURN_SLIGHT_RIGHT': return icons.MANEUVER.TURN_SLIGHT_RIGHT;
        case 'ROUNDABOUT_LEFT': return icons.MANEUVER.ROUNDABOUT_LEFT;
        case 'ROUNDABOUT_RIGHT': return icons.MANEUVER.ROUNDABOUT_RIGHT;
        case 'STRAIGHT': return icons.MANEUVER.STRAIGHT;
        default: return icons.MANEUVER.DEFAULT || '';
    }
}

// === Fonction principale de rendu ===

/**
 * Génère le HTML des détails d'itinéraire (pour accordéon PC ou vue mobile)
 * @param {Object} itinerary - L'itinéraire à afficher
 * @param {Object} options - Options de rendu
 * @param {Object} options.icons - Objet contenant les icônes SVG
 * @param {boolean} options.includeGoButton - Si true, ajoute le bouton GO à la fin
 * @returns {string} - HTML des détails
 */
export function renderItineraryStepsHTML(itinerary, options = {}) {
    const { icons = {}, includeGoButton = false } = options;
    
    if (!itinerary || !Array.isArray(itinerary.steps)) {
        return '<p class="no-steps">Aucune étape disponible</p>';
    }
    
    const stepsHtml = itinerary.steps.map((step, index) => {
        const lineColor = (step.type === 'BUS') 
            ? (step.routeColor || 'var(--border)') 
            : 'var(--text-secondary)';
        
        // Étapes de marche/vélo
        if (step.type === 'WALK' || step.type === 'BIKE') {
            return renderWalkBikeStep(step, { icons, lineColor });
        }
        
        // Étapes d'attente - masquées
        if (isWaitStep(step)) {
            return '';
        }
        
        // Étapes BUS supprimées
        if (shouldSuppressBusStep(step)) {
            return '';
        }
        
        // Étapes BUS normales
        return renderBusStep(step, { icons, lineColor });
        
    }).join('');
    
    // Ajouter le bouton GO si demandé
    let goButtonHtml = '';
    if (includeGoButton) {
        const hasBusStep = itinerary.steps?.some(step => step.type === 'BUS');
        if (hasBusStep) {
            goButtonHtml = renderGoContributionSection();
        }
    }
    
    return stepsHtml + goButtonHtml;
}

/**
 * Génère le HTML pour une étape de marche ou vélo
 */
function renderWalkBikeStep(step, { icons, lineColor }) {
    const hasSubSteps = step.subSteps && step.subSteps.length > 0;
    const icon = (step.type === 'BIKE') ? (icons.BICYCLE || '') : (icons.WALK || '');
    const stepClass = (step.type === 'BIKE') ? 'bicycle' : 'walk';
    
    // Filtrer les étapes "STRAIGHT" trop courtes
    const filteredSubSteps = (step.subSteps || []).filter(subStep => {
        const distanceMatch = subStep.distance?.match(/(\d+)\s*m/);
        if (subStep.maneuver === 'STRAIGHT' && distanceMatch && parseInt(distanceMatch[1]) < 100) {
            return false;
        }
        return true;
    });
    
    return `
        <div class="step-detail ${stepClass}" style="--line-color: ${lineColor};">
            <div class="step-icon">
                ${icon}
            </div>
            <div class="step-info">
                <span class="step-instruction">${step.instruction} <span class="step-duration-inline">(${step.duration})</span></span>
                
                ${hasSubSteps ? `
                <details class="intermediate-stops">
                    <summary>
                        <span>Voir les étapes</span>
                        <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    </summary>
                    <ul class="intermediate-stops-list walk-steps">
                        ${filteredSubSteps.map(subStep => `
                            <li>
                                ${getManeuverIcon(subStep.maneuver, icons)}
                                <div class="walk-step-info">
                                    <span>${subStep.instruction}</span>
                                    <span class="walk-step-meta">${subStep.distance} ${subStep.duration ? `(${subStep.duration})` : ''}</span>
                                </div>
                            </li>
                        `).join('')}
                    </ul>
                </details>
                ` : `<span class="step-sub-instruction">${step.instruction}</span>`}
            </div>
        </div>
    `;
}

/**
 * Génère le HTML pour une étape de bus
 */
function renderBusStep(step, { icons, lineColor }) {
    const hasIntermediateStops = step.intermediateStops && step.intermediateStops.length > 0;
    const intermediateStopCount = hasIntermediateStops 
        ? step.intermediateStops.length 
        : (step.numStops > 1 ? step.numStops - 1 : 0);
    
    let stopCountLabel = 'Direct';
    if (intermediateStopCount > 1) {
        stopCountLabel = `${intermediateStopCount} arrêts`;
    } else if (intermediateStopCount === 1) {
        stopCountLabel = `1 arrêt`;
    }
    
    const badgeLabel = getSafeRouteBadgeLabel(step.routeShortName);
    const badgeBg = step.routeColor || 'var(--primary)';
    const badgeText = step.routeTextColor || '#ffffff';
    const departureStopLabel = getSafeStopLabel(step.departureStop);
    const arrivalStopLabel = getSafeStopLabel(step.arrivalStop);
    const departureTimeLabel = getSafeTimeLabel(step.departureTime);
    const arrivalTimeLabel = getSafeTimeLabel(step.arrivalTime);
    
    return `
        <div class="step-detail bus" style="--line-color: ${lineColor};">
            <div class="step-icon">
                <div class="route-line-badge" style="background-color: ${badgeBg}; color: ${badgeText};">${badgeLabel}</div>
            </div>
            <div class="step-info">
                <span class="step-instruction">${step.instruction} <span class="step-duration-inline">(${step.duration})</span></span>
                
                <div class="step-stop-point">
                    <span class="step-time">Montée à <strong>${departureStopLabel}</strong></span>
                    <span class="step-time-detail">(${departureTimeLabel})</span>
                </div>
                
                ${(intermediateStopCount > 0) ? `
                <details class="intermediate-stops">
                    <summary>
                        <span>${stopCountLabel}</span>
                        <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    </summary>
                    ${hasIntermediateStops ? `
                    <ul class="intermediate-stops-list" style="--line-color: ${lineColor};">
                        ${step.intermediateStops.map(stopName => `<li>${stopName}</li>`).join('')}
                    </ul>
                    ` : `<ul class="intermediate-stops-list" style="--line-color: ${lineColor};"><li>(La liste détaillée des arrêts n'est pas disponible)</li></ul>`}
                </details>
                ` : ''}
                
                <div class="step-stop-point">
                    <span class="step-time">Descente à <strong>${arrivalStopLabel}</strong></span>
                    <span class="step-time-detail">(${arrivalTimeLabel})</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * Génère le HTML pour la section GO (crowdsourcing)
 */
function renderGoContributionSection() {
    return `
        <div class="go-contribution-section">
            <div class="go-contribution-divider"></div>
            <div class="go-contribution-content">
                <div class="go-contribution-icon">🚌</div>
                <div class="go-contribution-text">
                    <strong>Vous êtes dans ce bus ?</strong>
                    <span>Aidez les autres usagers en partageant votre position en temps réel</span>
                </div>
                <button class="go-contribution-button" id="go-start-sharing-btn">
                    <span class="go-btn-icon">GO</span>
                    <span>Partager</span>
                </button>
            </div>
        </div>
    `;
}

/**
 * Génère le HTML du résumé d'itinéraire (pour le header de la vue détail)
 * @param {Object} itinerary - L'itinéraire
 * @returns {string} - HTML du résumé
 */
export function renderItinerarySummaryHTML(itinerary) {
    if (!itinerary) return '';
    
    const timeHtml = (itinerary.departureTime === '~')
        ? `<span class="route-time" style="color: var(--text-secondary); font-weight: 500;">(Trajet)</span>`
        : `<span class="route-time">${itinerary.departureTime} &gt; ${itinerary.arrivalTime}</span>`;
    
    return `
        ${timeHtml}
        <span class="route-duration">${itinerary.duration}</span>
    `;
}

// === Export par défaut ===

export default {
    STOP_ROLE_PRIORITY,
    isWaitStep,
    shouldSuppressBusStep,
    getManeuverIcon,
    renderItineraryStepsHTML,
    renderItinerarySummaryHTML
};
