/**
 * constants.js
 * Regroupe les constantes transverses (icônes, niveaux, limites pagination, etc.)
 */

export const ICONS = {
  BUS: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="12" rx="3"/><path d="M4 10h16"/><path d="M6 15v2"/><path d="M18 15v2"/><circle cx="8" cy="19" r="1.5"/><circle cx="16" cy="19" r="1.5"/></svg>`,
  BICYCLE: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3.2"/><circle cx="17.5" cy="17" r="3.2"/><path d="M6 17 10 8h3.5l2 5h3"/><path d="M12 8l1.8 9"/><path d="m14 13.5 4 3.5"/></svg>`,
  WALK: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><path d="m9 21 2.2-6.2-2.2-3.8 3-2 3 2 1.2-3.5"/><path d="M13 14.5 16 21"/></svg>`,
  ALL: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27z"/></svg>`,
  LEAF_ICON: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-4-4 1.41-1.41L10 16.17l6.59-6.59L18 11l-8 8z" opacity=".3"/><path d="M17.8 7.29c-.39-.39-1.02-.39-1.41 0L10 13.17l-1.88-1.88c-.39-.39-1.02-.39-1.41 0-.39.39-.39 1.02 0 1.41l2.59 2.59c.39.39 1.02.39 1.41 0L17.8 8.7c.39-.39.39-1.02 0-1.41z" transform="translate(0, 0)" opacity=".1"/><path d="M12 4.14c-4.33 0-7.86 3.53-7.86 7.86s3.53 7.86 7.86 7.86 7.86-3.53 7.86-7.86S16.33 4.14 12 4.14zm5.8 4.57 c0 .28-.11.53-.29.71L12 15.01l-2.59-2.59c-.39-.39-1.02-.39-1.41 0-.39.39-.39 1.02 0 1.41l3.29 3.29c.39.39 1.02.39 1.41 0l6.29-6.29c.18-.18.29-.43.29-.71 0-1.04-1.2-1.57-2-1.57-.42 0-.8.13-1.1.33-.29.2-.6.4-.9.6z" fill="#1e8e3e"/></svg>`
};

export const BOTTOM_SHEET_LEVELS = [0.4, 0.6, 0.8];
export const BOTTOM_SHEET_DEFAULT_INDEX = 0;
export const ARRIVAL_PAGE_SIZE_DEFAULT = 5; // fallback si config ne fournit pas
