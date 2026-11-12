import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AccessGate } from './features/access/AccessGate';
import { takeFromHash, takeInviteFromHash } from './features/access/inviteLink';
import { setPendingClaim } from './lib/adminClaim';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ThemeProvider } from './features/settings/ThemeProvider';
import { initSecureStore } from './lib/secureStore';
import './themes';
import './globals.css';
import '@livekit/components-styles';

/**
 * React entry point.
 * Imports LiveKit styles and our global CSS.
 */
// Only a built app gets the service worker. Under the dev server it would serve Vite's
// unhashed modules from its cache, mixing old and new ones (two copies of React among them),
// so one left over from a build on the same address is removed.
if ('serviceWorker' in navigator) {
    if (import.meta.env.PROD) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {/* sw optional */});
        });
    } else {
        navigator.serviceWorker.getRegistrations()
            .then(regs => regs.forEach(r => r.unregister()))
            .catch(() => {/* nothing registered */});
    }
}

// Taken out of the URL before the router reads it, once: render effects may run twice.
const invite = takeInviteFromHash();
setPendingClaim(takeFromHash('claim'));

// The secret store's sync API requires hydration before first render.
// initSecureStore never rejects (degrades to memory-only), so render always runs.
initSecureStore().then(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <ErrorBoundary>
                <ThemeProvider>
                    <AccessGate invite={invite}>
                        <App />
                    </AccessGate>
                </ThemeProvider>
            </ErrorBoundary>
        </React.StrictMode>
    );
});
