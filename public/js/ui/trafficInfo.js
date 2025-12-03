/**
 * trafficInfo.js - Affichage des infos trafic et fiches horaires
 * 
 * Ce module gère le rendu des informations de trafic réseau
 * et la liste des fiches horaires.
 */

import { getCategoryForRoute, PDF_FILENAME_MAP, ROUTE_LONG_NAME_MAP } from '../config/routes.js';

// Stockage des données de ligne pour le modal
let lineDataCache = {};
let perturbationsData = []; // Données des perturbations pour le popup du bandeau

/**
 * Rend la carte d'info trafic avec l'état des lignes
 * @param {Object} dataManager - Instance du DataManager
 * @param {Object} lineStatuses - État des lignes {route_id: {status, message}}
 * @param {HTMLElement} container - Conteneur pour les lignes
 * @param {HTMLElement} countElement - Élément pour afficher le nombre d'alertes
 */
export function renderInfoTraficCard(dataManager, lineStatuses, container, countElement) {
    if (!dataManager || !container) return;
    container.innerHTML = '';
    lineDataCache = {}; // Reset le cache
    let alertCount = 0;
    
    const groupedRoutes = {
        'majeures': { name: 'Lignes majeures', routes: [] },
        'express': { name: 'Lignes express', routes: [] },
        'quartier': { name: 'Lignes de quartier', routes: [] },
        'navettes': { name: 'Navettes', routes: [] }
    };
    const allowedCategories = ['majeures', 'express', 'quartier', 'navettes'];

    dataManager.routes.forEach(route => {
        const category = getCategoryForRoute(route.route_short_name);
        if (allowedCategories.includes(category)) {
            groupedRoutes[category].routes.push(route);
        }
    });

    for (const [categoryId, categoryData] of Object.entries(groupedRoutes)) {
        if (categoryData.routes.length === 0) continue;

        const groupDiv = document.createElement('div');
        groupDiv.className = 'trafic-group';
        
        let badgesHtml = '';
        categoryData.routes.sort((a, b) => {
            return a.route_short_name.localeCompare(b.route_short_name, undefined, { numeric: true });
        });

        categoryData.routes.forEach(route => {
            const state = lineStatuses[route.route_id] || { status: 'normal', message: '' };
            const routeColor = route.route_color ? `#${route.route_color}` : '#3388ff';
            const textColor = route.route_text_color ? `#${route.route_text_color}` : '#ffffff';
            let statusIcon = '';
            let statusColor = 'transparent';
            
            if (state.status !== 'normal') {
                alertCount++;
                if (state.status === 'annulation') statusColor = 'var(--color-red)';
                else if (state.status === 'retard') statusColor = 'var(--color-yellow)';
                else statusColor = 'var(--color-orange)';
                statusIcon = `<div class="status-indicator-triangle type-${state.status}" style="border-bottom-color: ${statusColor};"></div>`;
            }
            
            // Stocker les données de la ligne pour le modal
            const lineKey = route.route_short_name;
            lineDataCache[lineKey] = {
                routeId: route.route_id,
                shortName: route.route_short_name,
                longName: ROUTE_LONG_NAME_MAP[route.route_short_name] || route.route_long_name || '',
                color: routeColor,
                textColor: textColor,
                status: state.status,
                message: state.message,
                category: categoryData.name
            };
            
            badgesHtml += `
                <div class="trafic-badge-item status-${state.status}" data-line="${lineKey}">
                    <span class="line-badge" style="background-color: ${routeColor}; color: ${textColor};">
                        ${route.route_short_name}
                    </span>
                    ${statusIcon}
                </div>
            `;
        });

        groupDiv.innerHTML = `
            <h4>${categoryData.name}</h4>
            <div class="trafic-badge-list">
                ${badgesHtml}
            </div>
        `;
        container.appendChild(groupDiv);
    }
    
    // Ajouter les événements de clic sur les badges
    setupLineClickListeners(container);
    
    if (countElement) {
        countElement.textContent = alertCount;
        countElement.classList.toggle('hidden', alertCount === 0);
    }
    
    return alertCount;
}

/**
 * Configure les listeners de clic sur les badges de ligne
 */
function setupLineClickListeners(container) {
    container.querySelectorAll('.trafic-badge-item').forEach(badge => {
        badge.addEventListener('click', () => {
            const lineKey = badge.dataset.line;
            const lineData = lineDataCache[lineKey];
            if (lineData) {
                showLineDetailModal(lineData);
            }
        });
    });
}

/**
 * Affiche le modal de détail d'une ligne
 */
function showLineDetailModal(lineData) {
    let modal = document.getElementById('line-detail-modal');
    
    // Créer le modal s'il n'existe pas
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'line-detail-modal';
        modal.className = 'line-detail-modal';
        modal.innerHTML = `
            <div class="line-detail-backdrop"></div>
            <div class="line-detail-content">
                <button class="line-detail-close" aria-label="Fermer">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
                <div class="line-detail-header">
                    <span class="line-detail-badge"></span>
                    <span class="line-detail-name"></span>
                </div>
                <div class="line-detail-body">
                    <div class="line-detail-status"></div>
                    <div class="line-detail-section">
                        <h4>Raison :</h4>
                        <p class="line-detail-reason"></p>
                    </div>
                    <div class="line-detail-section">
                        <h4>Informations complémentaires :</h4>
                        <p class="line-detail-info"></p>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Événements de fermeture
        modal.querySelector('.line-detail-backdrop').addEventListener('click', hideLineDetailModal);
        modal.querySelector('.line-detail-close').addEventListener('click', hideLineDetailModal);
    }
    
    // Remplir les données
    const badge = modal.querySelector('.line-detail-badge');
    badge.textContent = lineData.shortName;
    badge.style.backgroundColor = lineData.color;
    badge.style.color = lineData.textColor;
    
    modal.querySelector('.line-detail-name').textContent = lineData.longName || lineData.category;
    
    // Status
    const statusDiv = modal.querySelector('.line-detail-status');
    const statusLabels = {
        'normal': { label: 'Trafic normal', class: 'status-normal', icon: '✓' },
        'perturbation': { label: 'Perturbation en cours', class: 'status-perturbation', icon: '!' },
        'retard': { label: 'Retards signalés', class: 'status-retard', icon: '⏱' },
        'annulation': { label: 'Service annulé', class: 'status-annulation', icon: '✕' },
        'travaux': { label: 'Travaux en cours', class: 'status-travaux', icon: '⚠' }
    };
    const statusInfo = statusLabels[lineData.status] || statusLabels['normal'];
    statusDiv.className = `line-detail-status ${statusInfo.class}`;
    statusDiv.innerHTML = `<span class="status-badge-icon">${statusInfo.icon}</span> ${statusInfo.label}`;
    
    // Raison et informations
    const reasonEl = modal.querySelector('.line-detail-reason');
    const infoEl = modal.querySelector('.line-detail-info');
    
    if (lineData.status === 'normal') {
        reasonEl.textContent = 'Aucune perturbation signalée';
        infoEl.textContent = 'Le trafic est normal sur cette ligne.';
    } else {
        reasonEl.textContent = lineData.message || 'Information non disponible';
        infoEl.textContent = 'Nous vous conseillons de prévoir un temps de trajet supplémentaire. Consultez les horaires en temps réel pour plus de détails.';
    }
    
    // Afficher le modal
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

/**
 * Cache le modal de détail
 */
function hideLineDetailModal() {
    const modal = document.getElementById('line-detail-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Exposer la fonction pour fermer le modal depuis l'extérieur
export { hideLineDetailModal };

/**
 * Met à jour le bandeau d'actualités du hall avec les perturbations
 * @param {Object} dataManager - Instance du DataManager
 * @param {Object} lineStatuses - État des lignes
 */
export function updateNewsBanner(dataManager, lineStatuses) {
    const banner = document.querySelector('.news-banner');
    const textEl = banner?.querySelector('.news-banner-text');
    const labelEl = banner?.querySelector('.news-banner-label');
    const iconEl = banner?.querySelector('.news-banner-icon');
    const linkEl = banner?.querySelector('.news-banner-link');
    
    if (!banner || !textEl) return;
    
    // Collecter les perturbations
    perturbationsData = [];
    let maxSeverity = 'normal';
    
    for (const [routeId, state] of Object.entries(lineStatuses)) {
        if (state.status !== 'normal') {
            const route = dataManager.getRoute(routeId);
            if (route) {
                perturbationsData.push({
                    shortName: route.route_short_name,
                    longName: ROUTE_LONG_NAME_MAP[route.route_short_name] || route.route_long_name || '',
                    color: route.route_color ? `#${route.route_color}` : '#3388ff',
                    textColor: route.route_text_color ? `#${route.route_text_color}` : '#ffffff',
                    status: state.status,
                    message: state.message
                });
                
                // Déterminer la sévérité max
                if (state.status === 'annulation') maxSeverity = 'annulation';
                else if (state.status === 'perturbation' && maxSeverity !== 'annulation') maxSeverity = 'perturbation';
                else if (state.status === 'retard' && maxSeverity === 'normal') maxSeverity = 'retard';
            }
        }
    }
    
    // Appliquer le style selon la sévérité
    banner.classList.remove('severity-normal', 'severity-perturbation', 'severity-retard', 'severity-annulation');
    banner.classList.add(`severity-${maxSeverity}`);
    
    if (perturbationsData.length === 0) {
        // Pas de perturbations
        textEl.textContent = 'Trafic normal sur l\'ensemble du réseau Péribus';
        textEl.classList.remove('marquee-text');
        banner.classList.remove('has-perturbations');
        if (labelEl) labelEl.textContent = 'Actualités';
        if (iconEl) {
            iconEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
        }
    } else {
        // Il y a des perturbations - construire le texte
        const linesText = perturbationsData.map(p => `Ligne ${p.shortName}`).join(' • ');
        textEl.innerHTML = `<span class="marquee-inner">${linesText} — Cliquez pour voir les détails</span>`;
        textEl.classList.add('marquee-text');
        banner.classList.add('has-perturbations');
        if (labelEl) labelEl.textContent = `${perturbationsData.length} alerte${perturbationsData.length > 1 ? 's' : ''}`;
        
        // Icône d'alerte
        if (iconEl) {
            iconEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
        }
        
        // Vérifier si le texte dépasse et activer le défilement
        setTimeout(() => {
            const inner = textEl.querySelector('.marquee-inner');
            if (inner && inner.scrollWidth > textEl.clientWidth) {
                textEl.classList.add('marquee-active');
                // Calculer la durée basée sur la longueur
                const duration = Math.max(10, inner.scrollWidth / 50);
                inner.style.animationDuration = `${duration}s`;
            }
        }, 100);
    }
    
    // Rendre le bandeau cliquable pour voir le détail
    banner.style.cursor = perturbationsData.length > 0 ? 'pointer' : 'default';
    banner.onclick = perturbationsData.length > 0 ? (e) => {
        // Ne pas ouvrir si on clique sur le lien "Voir"
        if (e.target.classList.contains('news-banner-link')) return;
        showBannerDetailModal();
    } : null;
}

/**
 * Affiche le popup de détail des perturbations du bandeau
 */
function showBannerDetailModal() {
    if (perturbationsData.length === 0) return;
    
    let modal = document.getElementById('banner-detail-modal');
    
    // Créer le modal s'il n'existe pas
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'banner-detail-modal';
        modal.className = 'banner-detail-modal';
        modal.innerHTML = `
            <div class="banner-detail-backdrop"></div>
            <div class="banner-detail-content">
                <button class="banner-detail-close" aria-label="Fermer">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
                <div class="banner-detail-header">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <h3>Perturbations en cours</h3>
                </div>
                <div class="banner-detail-body"></div>
                <div class="banner-detail-footer">
                    <a href="#trafic" class="banner-detail-link">Voir toutes les lignes</a>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Événements de fermeture
        modal.querySelector('.banner-detail-backdrop').addEventListener('click', hideBannerDetailModal);
        modal.querySelector('.banner-detail-close').addEventListener('click', hideBannerDetailModal);
        modal.querySelector('.banner-detail-link').addEventListener('click', hideBannerDetailModal);
    }
    
    // Remplir le contenu
    const body = modal.querySelector('.banner-detail-body');
    body.innerHTML = perturbationsData.map(p => {
        const statusLabels = {
            'perturbation': { label: 'Perturbation', class: 'status-perturbation' },
            'retard': { label: 'Retard', class: 'status-retard' },
            'annulation': { label: 'Annulation', class: 'status-annulation' },
            'travaux': { label: 'Travaux', class: 'status-travaux' }
        };
        const statusInfo = statusLabels[p.status] || { label: 'Info', class: 'status-perturbation' };
        
        return `
            <div class="banner-perturbation-item">
                <div class="banner-perturbation-header">
                    <span class="banner-line-badge" style="background-color: ${p.color}; color: ${p.textColor};">${p.shortName}</span>
                    <span class="banner-status-tag ${statusInfo.class}">${statusInfo.label}</span>
                </div>
                <p class="banner-perturbation-message">${p.message || 'Perturbation signalée sur cette ligne.'}</p>
            </div>
        `;
    }).join('');
    
    // Mettre à jour le header avec le nombre
    modal.querySelector('.banner-detail-header h3').textContent = 
        `${perturbationsData.length} perturbation${perturbationsData.length > 1 ? 's' : ''} en cours`;
    
    // Afficher
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

/**
 * Cache le modal de détail du bandeau
 */
function hideBannerDetailModal() {
    const modal = document.getElementById('banner-detail-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

export { hideBannerDetailModal };

/**
 * Construit la liste des fiches horaires
 * @param {Object} dataManager - Instance du DataManager
 * @param {HTMLElement} container - Conteneur pour les fiches
 */
export function buildFicheHoraireList(dataManager, container) {
    if (!dataManager || !container) return;
    container.innerHTML = '';

    const groupedRoutes = {
        'Lignes A, B, C et D': [],
        'Lignes e': [],
        'Lignes K': [],
        'Lignes N': [],
        'Lignes R': []
    };

    dataManager.routes.forEach(route => {
        const name = route.route_short_name;
        if (['A', 'B', 'C', 'D'].includes(name)) groupedRoutes['Lignes A, B, C et D'].push(route);
        else if (name.startsWith('e')) groupedRoutes['Lignes e'].push(route);
        else if (name.startsWith('K')) groupedRoutes['Lignes K'].push(route);
        else if (name.startsWith('N')) groupedRoutes['Lignes N'].push(route);
        else if (name.startsWith('R')) groupedRoutes['Lignes R'].push(route);
    });

    for (const [groupName, routes] of Object.entries(groupedRoutes)) {
        if (routes.length === 0) continue;
        
        const accordionGroup = document.createElement('div');
        accordionGroup.className = 'accordion-group';
        let linksHtml = '';
        
        if (groupName === 'Lignes R') {
            linksHtml = buildRLinesHtml();
        } else {
            routes.sort((a, b) => a.route_short_name.localeCompare(b.route_short_name, undefined, { numeric: true }));
            routes.forEach(route => {
                const pdfPath = getPdfPathForRoute(route.route_short_name);
                const longName = ROUTE_LONG_NAME_MAP[route.route_short_name] || route.route_long_name || '';
                if (pdfPath) {
                    linksHtml += `<a href="${pdfPath}" target="_blank" rel="noopener noreferrer">Ligne ${route.route_short_name} ${longName}</a>`;
                }
            });
        }
        
        accordionGroup.innerHTML = `
            <button class="accordion-header" aria-expanded="false">
                <span>${groupName}</span>
                <svg class="accordion-chevron" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </button>
            <div class="accordion-content">
                ${linksHtml}
            </div>
        `;
        
        container.appendChild(accordionGroup);
    }

    // Attacher les event listeners aux accordéons
    setupAccordionListeners(container);
}

/**
 * Configure les listeners pour les accordéons
 */
function setupAccordionListeners(container) {
    container.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const isExpanded = header.getAttribute('aria-expanded') === 'true';
            // Fermer tous les autres
            container.querySelectorAll('.accordion-header').forEach(h => {
                h.setAttribute('aria-expanded', 'false');
                h.nextElementSibling?.classList.remove('open');
            });
            // Basculer celui-ci
            if (!isExpanded) {
                header.setAttribute('aria-expanded', 'true');
                header.nextElementSibling?.classList.add('open');
            }
        });
    });
}

/**
 * Obtient le chemin PDF pour une ligne
 */
function getPdfPathForRoute(routeShortName) {
    const fileName = PDF_FILENAME_MAP[routeShortName];
    if (fileName) {
        return `/data/fichehoraire/${fileName}`;
    }
    return null;
}

/**
 * Construit le HTML pour les lignes R (cas spécial avec groupement)
 */
function buildRLinesHtml() {
    return `
        <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R1_R2_R3_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R1, R2, R3 La Feuilleraie <> ESAT / Les Gourdoux <> Trélissac Les Garennes / Les Pinots <> P+R Aquacap</a>
        <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R4_R5_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R4, R5 Route de Payenché <> Collège Jean Moulin / Les Mondines / Clément Laval <> Collège Jean Moulin</a>
        <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R6_R7_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R6, R7 Maison des Compagnons <> Gour de l'Arche poste / Le Charpe <> Gour de l'Arche poste</a>
        <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R8_R9_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R8, R9 Jaunour <> Boulazac centre commercial / Stèle de Lesparat <> Place du 8 mai</a>
        <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R10_R11_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R10, R11 Notre Dame de Sanilhac poste <> Centre de la communication / Héliodore <> Place du 8 mai</a>
        <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R12_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Ligne R12 Le Change <> Boulazac centre commercial</a>
        <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R13_R14_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R13, R14 Coursac <> Razac sur l'Isle / La Chapelle Gonaguet <> Razac sur l'Isle</a>
        <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R15_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Ligne R15 Boulazac Isle Manoire <> Halte ferroviaire Niversac</a>
    `;
}

export default {
    renderInfoTraficCard,
    buildFicheHoraireList
};
