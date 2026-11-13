'use strict';

// IPC for the connection page and the loaded web app. Screen share and the
// updater register their own channels.

const path = require('path');
const { app, ipcMain, Menu, net, powerMonitor, powerSaveBlocker } = require('electron');
const { IS_WAYLAND, IPC, USER_DATA } = require('./constants');
const { state, sendToRenderer } = require('./state');
const { isUrlAllowed, isFileSender, isTrustedSender, isFileOrTrustedSender } = require('./trust');
const { loadServer, navigateToConnectionPage } = require('./window');
const { setBadgeCount } = require('./tray');
const { stringsFor, translate } = require('../strings');
const { ActivityWatcher } = require('./activity');
const { AddedGames, runningPrograms } = require('./activity/added');
const { exeKey } = require('./activity/procs');

// What plays on this computer, while the web app asks for it (main/activity).
const addedGames = new AddedGames(path.join(USER_DATA, 'games.json'));
const activity = new ActivityWatcher((summary) => sendToRenderer(IPC.ACTIVITY, summary), addedGames);
const MENU_PROGRAMS = 40;
let pickingGame = null;

/**
 * The running programs in a native menu at the pointer; resolves the one picked, or null.
 * Native so that the list of programs never reaches the page, which the server provides.
 */
async function pickProgram() {
    const window = state.mainWindow;
    if (!window) return null;
    const programs = (await runningPrograms(new Set([exeKey(process.execPath)]))).slice(0, MENU_PROGRAMS);
    return new Promise((resolve) => {
        const template = programs.length
            ? programs.map(p => ({ label: p.label, click: () => resolve(p) }))
            : [{ label: translate(app.getLocale(), 'games.nothingRunning'), enabled: false }];
        // Some platforms close the menu before delivering the click: wait a moment for one.
        Menu.buildFromTemplate(template).popup({ window, callback: () => setTimeout(() => resolve(null), 300) });
    });
}
let watchingNavigation = false;

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
        if (!isUrlAllowed(url)) {
            sendToRenderer(IPC.LOAD_URL_ERROR, { message: 'Invalid URL protocol. Only HTTP(S) is allowed.' });
            return;
        }
        loadServer(url);
    });

    // The connection page's text (locales/*.json), which a file:// page can't read itself.
    // Only the connection page asks; a server page has its own translations.
    ipcMain.handle(IPC.GET_STRINGS, (event, locale) => {
        if (!isFileSender(event)) return null;
        return stringsFor(typeof locale === 'string' ? locale.slice(0, 35) : 'en', 'connect');
    });

    // Get app info
    ipcMain.handle(IPC.GET_APP_INFO, () => ({
        version: app.getVersion(),
        name: app.getName(),
        platform: process.platform,
        arch: process.arch,
        isWayland: IS_WAYLAND,
    }));

    // Seconds without input on the whole computer, so the web app shows the person idle
    // while they work in another program, not only when the window sits untouched.
    ipcMain.handle(IPC.GET_IDLE_TIME, (event) => {
        if (!isTrustedSender(event)) return null;
        return powerMonitor.getSystemIdleTime();
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

    // Navigate back to connection page (server switching)
    ipcMain.on(IPC.NAVIGATE_BACK, (event) => {
        if (!isFileOrTrustedSender(event)) return;
        navigateToConnectionPage();
    });

    // Power save blocker for active calls. Trusted-origin-only: this is only
    // meaningful while the web app is in a call — the connection page never
    // needs it, and it controls a real OS-level side effect (blocking sleep).
    // { browsers } starts or updates detection, null stops it. Only the server page asks; any
    // navigation of the window stops it too, and the next page starts it again if it wants.
    ipcMain.on(IPC.WATCH_ACTIVITY, (event, options) => {
        if (!isTrustedSender(event)) return;
        if (!options || typeof options !== 'object') {
            activity.stop();
            return;
        }
        if (!watchingNavigation && state.mainWindow) {
            watchingNavigation = true;
            state.mainWindow.webContents.on('did-start-navigation', (details) => {
                if (details.isMainFrame && !details.isSameDocument) activity.stop();
            });
            state.mainWindow.on('closed', () => { activity.stop(); watchingNavigation = false; });
        }
        activity.start({ browsers: options.browsers === true });
    });

    // Games added by hand (main/activity/added.js): the page sees ids and names only.
    ipcMain.handle(IPC.GET_GAMES, (event) => (isTrustedSender(event) ? addedGames.list() : []));
    ipcMain.handle(IPC.ADD_GAME, async (event) => {
        if (!isTrustedSender(event)) return null;
        if (pickingGame) return pickingGame; // one menu at a time
        pickingGame = pickProgram().then((program) => {
            const game = program ? addedGames.add(program.key, program.name) : null;
            if (game) activity.gamesChanged();
            return game;
        }).finally(() => { pickingGame = null; });
        return pickingGame;
    });
    ipcMain.handle(IPC.RENAME_GAME, (event, id, name) => {
        if (!isTrustedSender(event) || typeof id !== 'string' || typeof name !== 'string') return false;
        const changed = addedGames.rename(id, name);
        if (changed) activity.gamesChanged();
        return changed;
    });
    ipcMain.handle(IPC.REMOVE_GAME, (event, id) => {
        if (!isTrustedSender(event) || typeof id !== 'string') return false;
        const removed = addedGames.remove(id);
        if (removed) activity.gamesChanged();
        return removed;
    });

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
