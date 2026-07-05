/**
 * Environment detection, evaluated once at module load. Both values are
 * stable for the lifetime of the page, so they're safe to read during render
 * and in conditional JSX.
 */

/** Running inside the Lala Electron desktop client (preload bridge present). */
export const IS_ELECTRON = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

/** Device has a touchscreen — used to hide keyboard-centric UI. */
export const IS_TOUCH = typeof window !== 'undefined' && navigator.maxTouchPoints > 0;
