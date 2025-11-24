const LAYOUT_PLAN = [
    { url: './views/hall.html', target: '#app-view-root' },
    { url: './views/horaires.html', target: '#dashboard-content-view .content-cards' },
    { url: './views/trafic.html', target: '#dashboard-content-view .content-cards' },
    { url: './views/carte.html', target: '#app-view-root' },
    { url: './views/itineraire.html', target: '#app-view-root' }
];

async function injectFragment({ url, target: targetSelector, position = 'beforeend' }) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
        throw new Error(`Impossible de charger le fragment ${url} (${response.status})`);
    }

    const target = document.querySelector(targetSelector);
    if (!target) {
        throw new Error(`Impossible de trouver la cible ${targetSelector} pour le fragment ${url}`);
    }

    const html = await response.text();
    target.insertAdjacentHTML(position, html.trim());
}

export async function loadBaseLayout() {
    try {
        for (const fragment of LAYOUT_PLAN) {
            await injectFragment(fragment);
        }
    } catch (error) {
        console.error('[viewLoader] Chargement de layout impossible', error);
        const root = document.querySelector('#app-view-root');
        if (root) {
            root.innerHTML = `
                <section class="card error-card">
                    <h3>Chargement impossible</h3>
                    <p>Un probleme empeche l'interface de se charger. Merci de recharger la page.</p>
                    <pre>${error.message}</pre>
                </section>
            `;
        }
        throw error;
    }
}
