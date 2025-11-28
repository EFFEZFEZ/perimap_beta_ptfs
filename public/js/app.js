import { loadBaseLayout } from './viewLoader.js';
import { bootstrapApp } from './main.js';

/**
 * Enregistre le Service Worker avec détection automatique des mises à jour
 */
async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        console.log('[App] Service Worker non supporté');
        return;
    }

    try {
        const registration = await navigator.serviceWorker.register('/service-worker.js');
        console.log('[App] Service Worker enregistré');

        // Vérifie les mises à jour au démarrage
        registration.update();

        // Écoute les mises à jour du SW
        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            console.log('[App] Nouvelle version du Service Worker détectée');

            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    // Nouvelle version prête, afficher notification
                    showUpdateNotification();
                }
            });
        });

        // Si le SW est déjà installé et qu'il y a une mise à jour en attente
        if (registration.waiting) {
            showUpdateNotification();
        }

        // Recharge automatiquement quand le nouveau SW prend le contrôle
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                refreshing = true;
                console.log('[App] Nouveau Service Worker actif, rechargement...');
                window.location.reload();
            }
        });

    } catch (error) {
        console.warn('[App] Erreur enregistrement Service Worker:', error);
    }
}

/**
 * Affiche une notification discrète pour informer de la mise à jour
 */
function showUpdateNotification() {
    // Évite les doublons
    if (document.getElementById('update-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.innerHTML = `
        <div class="update-banner-content">
            <span>🔄 Une nouvelle version est disponible</span>
            <button id="update-btn" class="btn btn-primary btn-sm">Mettre à jour</button>
            <button id="update-dismiss" class="btn-icon-round" aria-label="Fermer">×</button>
        </div>
    `;
    banner.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--bg-main, #fff);
        border: 2px solid var(--primary, #22c55e);
        border-radius: 12px;
        padding: 12px 16px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        z-index: 10000;
        animation: slideUp 0.3s ease;
    `;

    document.body.appendChild(banner);

    // Bouton "Mettre à jour" - force le rechargement
    document.getElementById('update-btn').addEventListener('click', () => {
        // Demande au SW d'activer la nouvelle version
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage('skipWaiting');
        }
        // Force le rechargement
        window.location.reload(true);
    });

    // Bouton fermer
    document.getElementById('update-dismiss').addEventListener('click', () => {
        banner.remove();
    });
}

async function startApplication() {
    try {
        // Enregistre le SW en premier (non-bloquant)
        registerServiceWorker();
        
        await loadBaseLayout();
        await bootstrapApp();
    } catch (error) {
        console.error("[app] Echec du demarrage de l'interface", error);
    }
}

startApplication();
