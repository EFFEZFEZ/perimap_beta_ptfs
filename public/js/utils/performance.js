/**
 * Utilitaires de performance pour PériMap
 * - requestIdleCallback polyfill
 * - Throttle et debounce optimisés
 * - Lazy loading helpers
 */

// requestIdleCallback polyfill pour Safari et anciens navigateurs
export const scheduleIdleTask = typeof requestIdleCallback !== 'undefined' 
    ? requestIdleCallback 
    : (fn, options = {}) => setTimeout(fn, options.timeout || 1);

export const cancelIdleTask = typeof cancelIdleCallback !== 'undefined'
    ? cancelIdleCallback
    : clearTimeout;

/**
 * Throttle: Limite l'exécution d'une fonction à une fois par intervalle
 * @param {Function} fn - Fonction à limiter
 * @param {number} wait - Intervalle en ms
 */
export function throttle(fn, wait) {
    let lastTime = 0;
    let timeoutId = null;
    
    return function throttled(...args) {
        const now = performance.now();
        const remaining = wait - (now - lastTime);
        
        if (remaining <= 0) {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            lastTime = now;
            fn.apply(this, args);
        } else if (!timeoutId) {
            timeoutId = setTimeout(() => {
                lastTime = performance.now();
                timeoutId = null;
                fn.apply(this, args);
            }, remaining);
        }
    };
}

/**
 * Debounce: Retarde l'exécution jusqu'à la fin des appels
 * @param {Function} fn - Fonction à retarder
 * @param {number} wait - Délai en ms
 * @param {boolean} immediate - Exécuter immédiatement au premier appel
 */
export function debounce(fn, wait, immediate = false) {
    let timeoutId = null;
    
    return function debounced(...args) {
        const callNow = immediate && !timeoutId;
        
        if (timeoutId) clearTimeout(timeoutId);
        
        timeoutId = setTimeout(() => {
            timeoutId = null;
            if (!immediate) fn.apply(this, args);
        }, wait);
        
        if (callNow) fn.apply(this, args);
    };
}

/**
 * Mesure le temps d'exécution d'une fonction async
 * @param {string} label - Nom pour le log
 * @param {Function} fn - Fonction async à mesurer
 */
export async function measureAsync(label, fn) {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    console.log(`⏱️ ${label}: ${duration.toFixed(0)}ms`);
    return result;
}

/**
 * Lazy loader pour modules ES
 * @param {Function} importFn - Fonction d'import dynamique
 * @returns {Promise} Module chargé
 */
export async function lazyLoad(importFn) {
    try {
        return await importFn();
    } catch (error) {
        console.error('Lazy load failed:', error);
        throw error;
    }
}

/**
 * Précharge les ressources critiques
 * @param {string[]} urls - URLs à précharger
 * @param {string} as - Type de ressource (script, style, fetch)
 */
export function preloadResources(urls, as = 'fetch') {
    urls.forEach(url => {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.href = url;
        link.as = as;
        if (as === 'script') link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
    });
}

/**
 * Exécute une fonction quand le navigateur est idle
 * @param {Function} fn - Fonction à exécuter
 * @param {number} maxWait - Timeout max en ms
 */
export function whenIdle(fn, maxWait = 2000) {
    return new Promise((resolve) => {
        scheduleIdleTask(() => {
            resolve(fn());
        }, { timeout: maxWait });
    });
}
