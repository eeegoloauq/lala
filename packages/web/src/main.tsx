import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ThemeProvider } from './features/settings/ThemeProvider';
import { initSecureStore } from './lib/secureStore';
import './globals.css';
import '@livekit/components-styles';

/**
 * React entry point.
 * Imports LiveKit styles and our global CSS.
 */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {/* sw optional */});
    });
}

// The secret store's sync API requires hydration before first render.
// initSecureStore never rejects (degrades to memory-only), so render always runs.
initSecureStore().then(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <ErrorBoundary>
                <ThemeProvider>
                    <App />
                </ThemeProvider>
            </ErrorBoundary>
        </React.StrictMode>
    );
});
