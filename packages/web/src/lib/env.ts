/**
 * Environment detection, evaluated once at module load. Both values are
 * stable for the lifetime of the page, so they're safe to read during render
 * and in conditional JSX.
 */

/** Running inside the Lala Electron desktop client (preload bridge present). */
export const IS_ELECTRON = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

/** Device has a touchscreen — used to hide keyboard-centric UI. */
export const IS_TOUCH = typeof window !== 'undefined' && navigator.maxTouchPoints > 0;

/** Desktop Linux (not Android) — system audio capture there includes the call's own playout. */
export const IS_LINUX = typeof navigator !== 'undefined' && /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);

/**
 * The static demo build (`vite build --mode demo`): the API is answered in the page by
 * features/demo/server.ts and calls are not placed. A build-time constant, so the
 * regular build drops every demo branch and never bundles the demo code.
 */
export const IS_DEMO = import.meta.env.MODE === 'demo';
