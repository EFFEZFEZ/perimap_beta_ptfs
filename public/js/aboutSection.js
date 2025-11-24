(function initInstallCTA() {
    const installBtn = document.getElementById('install-pwa-btn');
    if (!installBtn) return;

    const helper = document.getElementById('install-helper');
    const ua = navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);
    const isAndroid = !isIOS && ua.includes('android');
    let deferredPrompt = null;

    const setHelper = (text) => {
        if (helper) helper.textContent = text;
    };

    if (isAndroid) {
        setHelper('Android détecté : si le bouton reste grisé, utilisez le menu ⋮ ▸ Ajouter à l\'écran d\'accueil.');
    } else if (!isIOS) {
        setHelper('Depuis un navigateur compatible (Chrome, Edge), cliquez sur Installer pour l\'ancrer à l\'accueil.');
    }

    if (isIOS) {
        installBtn.disabled = false;
        installBtn.textContent = 'Guide iOS';
        setHelper('iOS détecté : ouvrez le menu Partager ▸ Sur l\'écran d\'accueil.');
        installBtn.addEventListener('click', () => {
            alert('Sur iOS : ouvrez Safari ▸ Partager ▸ Sur l\'écran d\'accueil.');
        });
        return;
    }

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferredPrompt = event;
        installBtn.disabled = false;
        installBtn.textContent = 'Installer PériMap';
        setHelper(isAndroid ? 'Android détecté : appuyez sur Installer ou utilisez le menu ⋮.' : 'Compatible navigateurs Chrome/Edge : utilisez le bouton Installer.');
    });

    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) {
            setHelper('Installation non disponible sur ce navigateur.');
            return;
        }
        installBtn.disabled = true;
        installBtn.textContent = 'Demande envoyée…';
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        setHelper(choice.outcome === 'accepted' ? 'Installation en cours sur votre écran d\'accueil.' : 'Installation annulée.');
        deferredPrompt = null;
    });
})();

(function initTileObserver() {
    const tiles = document.querySelectorAll('[data-animate]');
    if (!tiles.length) return;

    const reveal = (tile) => tile.classList.add('is-visible');

    if (!('IntersectionObserver' in window)) {
        tiles.forEach(reveal);
        return;
    }

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            reveal(entry.target);
            obs.unobserve(entry.target);
        });
    }, { threshold: 0.35 });

    tiles.forEach((tile) => observer.observe(tile));
})();
