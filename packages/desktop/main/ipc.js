'use strict';

// IPC for the connection page and the loaded web app. Screen share and the
// updater register their own channels.

const { app, ipcMain, net, powerSaveBlocker } = require('electron');
const { IS_WAYLAND, IPC } = require('./constants');
const { state, sendToRenderer } = require('./state');
const { isUrlAllowed, isFileSender, isTrustedSender, isFileOrTrustedSender } = require('./trust');
const { ICON_VARIANTS, getIconPreference, saveIconPreference, applyIcon } = require('./icons');
const { navigateToConnectionPage } = require('./window');
const { setBadgeCount } = require('./tray');
const { saveSession, clearSession } = require('./crash');

function registerIpcHandlers() {
    // Ping a server (health check from connection page, bypasses CORS).
    // File://-only: this is a user-driven "is this server up" probe issued from
    // the connection page before loadUrl(), never from a loaded server page.
    // Combined with the http(s)-only protocol check and the 5s timeout below,
    // restricting the sender closes off using this as a general SSRF proxy.
    ipcMain.handle(IPC.PING_SERVER, async (event, url) => {
        if (!isFileSender(event)) return null;
        if (!isUrlAllowed(url)) return null;
        const endpoint = url.replace(/\/+$/, '') + '/api/health';
        const start = Date.now();
        // net.fetch goes through the window's own network stack (session cookies,
        // system proxy, client certificates), so the probe sees what the page will.
        // Any non-5xx answer means the server is up: a 401 or a redirect comes from
        // an auth layer in front of Lala, which the loaded page then handles.
        try {
            const res = await net.fetch(endpoint, { signal: AbortSignal.timeout(5000) });
            return res.status < 500 ? Date.now() - start : null;
        } catch {
            return null;
        }
    });

    // Load a server URL (from connection page). File://-only: this is how a
    // server origin becomes trusted in the first place, so only the local
    // connection page — never an already-loaded remote page — may call it.
    ipcMain.on(IPC.LOAD_URL, (event, url) => {
        if (!isFileSender(event)) return;
        if (!state.mainWindow) return;
        if (!isUrlAllowed(url)) {
            sendToRenderer(IPC.LOAD_URL_ERROR, { message: 'Invalid URL protocol. Only HTTP(S) is allowed.' });
            return;
        }
        // isUrlAllowed() above already parsed the URL successfully, so this can't throw.
        state.trustedOrigin = new URL(url).origin;
        state.mainWindow.hide();  // Hide to prevent 502 flash
        state.mainWindow.loadURL(url).catch(err => {
            console.error('[Lala] Failed to load URL:', err.message);
            // Error recovery handled by did-fail-load event
        });
        // Safety: ensure window shows after 15s max
        setTimeout(() => {
            if (state.mainWindow && !state.mainWindow.isDestroyed() && !state.mainWindow.isVisible()) {
                state.mainWindow.show();
            }
        }, 15000);
    });

    // Get app info
    ipcMain.handle(IPC.GET_APP_INFO, () => ({
        version: app.getVersion(),
        name: app.getName(),
        platform: process.platform,
        arch: process.arch,
        isWayland: IS_WAYLAND,
    }));

    // Update window title
    ipcMain.on(IPC.SET_TITLE_SUFFIX, (_event, suffix) => {
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
            const safe = typeof suffix === 'string' ? suffix.slice(0, 200) : '';
            state.mainWindow.setTitle(safe ? `Lala — ${safe}` : 'Lala');
        }
    });

    // Show window (used by renderer to restore from tray)
    ipcMain.on(IPC.SHOW_WINDOW, () => {
        if (state.mainWindow) {
            state.mainWindow.show();
            state.mainWindow.focus();
        }
    });

    // Badge count for unread messages
    ipcMain.on(IPC.SET_BADGE_COUNT, (event, count) => {
        if (!isFileOrTrustedSender(event)) return;
        if (typeof count !== 'number' || !Number.isFinite(count)) return;
        setBadgeCount(Math.max(0, Math.floor(count)));
    });

    // Auto-launch — only used by the web app's SettingsModal, but harmless to
    // also allow from the connection page for consistency with the rest of
    // the settings-style channels.
    ipcMain.handle(IPC.GET_AUTO_LAUNCH, (event) => {
        if (!isFileOrTrustedSender(event)) return false;
        return app.getLoginItemSettings().openAtLogin;
    });

    ipcMain.handle(IPC.SET_AUTO_LAUNCH, (event, enabled) => {
        if (!isFileOrTrustedSender(event)) return false;
        app.setLoginItemSettings({ openAtLogin: enabled });
        return true;
    });

    // Icon preference
    ipcMain.handle(IPC.GET_APP_ICON, (event) => {
        if (!isFileOrTrustedSender(event)) return null;
        return getIconPreference();
    });

    ipcMain.handle(IPC.SET_APP_ICON, (event, name) => {
        if (!isFileOrTrustedSender(event)) return false;
        if (!ICON_VARIANTS.includes(name)) return false;
        saveIconPreference(name);
        applyIcon(name, { forceRedraw: true });
        return true;
    });

    ipcMain.on(IPC.RELAUNCH, (event) => {
        if (!isFileOrTrustedSender(event)) return;
        const options = { args: process.argv.slice(1) };
        if (process.env.APPIMAGE) {
            options.execPath = process.env.APPIMAGE;
            options.args.unshift('--appimage-extract-and-run');
        }
        app.relaunch(options);
        app.exit(0);
    });

    // Session persistence
    ipcMain.on(IPC.SAVE_SESSION, (event, data) => {
        if (!isFileOrTrustedSender(event)) return;
        if (data) saveSession(data);
        else clearSession();
    });

    // Navigate back to connection page (server switching)
    ipcMain.on(IPC.NAVIGATE_BACK, (event) => {
        if (!isFileOrTrustedSender(event)) return;
        navigateToConnectionPage();
    });

    // Power save blocker for active calls. Trusted-origin-only: this is only
    // meaningful while the web app is in a call — the connection page never
    // needs it, and it controls a real OS-level side effect (blocking sleep).
    ipcMain.on(IPC.SET_IN_CALL, (event, inCall) => {
        if (!isTrustedSender(event)) return;
        if (inCall && state.powerSaveBlockerId === null) {
            state.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
        } else if (!inCall && state.powerSaveBlockerId !== null) {
            powerSaveBlocker.stop(state.powerSaveBlockerId);
            state.powerSaveBlockerId = null;
        }
    });
}

module.exports = { registerIpcHandlers };
