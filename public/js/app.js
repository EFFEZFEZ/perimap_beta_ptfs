import { loadBaseLayout } from './viewLoader.js';
import { bootstrapApp } from './main.js';

async function startApplication() {
    try {
        await loadBaseLayout();
        await bootstrapApp();
    } catch (error) {
        console.error("[app] Echec du demarrage de l'interface", error);
    }
}

startApplication();
