'use strict';

const { BrowserWindow, app, screen, session, shell, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const { IS_MAC, HAS_SYSTEM_TRAY, USER_DATA } = require('./constants');
const { state } = require('./state');
const { isUrlAllowed, isIndexHtmlUrl } = require('./trust');
const { getInitialWindowIcon } = require('./icons');
const { setupContextMenu } = require('./context-menu');

const WINDOW_MIN_WIDTH = 800;
const WINDOW_MIN_HEIGHT = 600;
const WINDOW_DEFAULT_WIDTH = 1280;
const WINDOW_DEFAULT_HEIGHT = 800;
const WINDOW_STATE_FILE = path.join(USER_DATA, 'window-state.json');

// ─── Window State Persistence ────────────────────────────────────────────────

function loadWindowState() {
    try {
        if (fs.existsSync(WINDOW_STATE_FILE)) {
            return JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, 'utf8'));
        }
    } catch { /* ignore corrupted state */ }
    return null;
}

function saveWindowState(win) {
    if (!win || win.isDestroyed()) return;
    try {
        const bounds = win.getNormalBounds();
        const saved = {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            isMaximized: win.isMaximized(),
        };
        fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(saved));
    } catch { /* ignore write errors */ }
}

function getValidatedWindowState() {
    const saved = loadWindowState();
    if (!saved) return null;

    // Verify the saved position is still within a visible display
    const displays = screen.getAllDisplays();
    const isVisible = displays.some(display => {
        const { x, y, width, height } = display.bounds;
        return (
            saved.x >= x &&
            saved.y >= y &&
            saved.x + saved.width <= x + width &&
            saved.y + saved.height <= y + height
        );
    });

    return isVisible ? saved : null;
}

let showTimer = null;

function showWindow() {
    clearTimeout(showTimer);
    const win = state.mainWindow;
    if (win && !win.isDestroyed()) win.show();
}

/**
 * Loads the server the user picked and trusts its origin. The window stays hidden until the
 * server's page arrives, so a failed connection never flashes an error page; a load that never
 * settles still gives the window back after 15 s.
 */
function loadServer(url) {
    const win = state.mainWindow;
    if (!win || win.isDestroyed()) return;
    state.trustedOrigin = new URL(url).origin;
    win.hide();
    clearTimeout(showTimer);
    showTimer = setTimeout(showWindow, 15_000);
    // A failure arrives as did-fail-load.
    win.loadURL(url).catch(() => {});
}

/**
 * Navigate back to the local connection page. Centralizes the three things
 * that must always happen together: stop the power-save blocker, drop trust
 * in the previously-connected origin, and load index.html. Used by manual
 * "change server" actions as well as automatic error recovery.
 */
function navigateToConnectionPage(query) {
    const win = state.mainWindow;
    if (!win || win.isDestroyed()) return;
    if (state.powerSaveBlockerId !== null) {
        powerSaveBlocker.stop(state.powerSaveBlockerId);
        state.powerSaveBlockerId = null;
    }
    state.trustedOrigin = null;
    win.loadFile('index.html', query ? { query } : undefined);
}

// ─── Window Creation ─────────────────────────────────────────────────────────

function createWindow() {
    const savedState = getValidatedWindowState();
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

    const opts = {
        width: savedState?.width ?? Math.min(WINDOW_DEFAULT_WIDTH, screenW),
        height: savedState?.height ?? Math.min(WINDOW_DEFAULT_HEIGHT, screenH),
        minWidth: WINDOW_MIN_WIDTH,
        minHeight: WINDOW_MIN_HEIGHT,
        ...(savedState?.x != null && { x: savedState.x, y: savedState.y }),
        title: 'Lala',
        titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
        autoHideMenuBar: true,
        icon: getInitialWindowIcon(),
        show: false, // until the first page is in, see did-navigate
        backgroundColor: '#0f1117',
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            spellcheck: false,
            backgroundThrottling: false,
            autoplayPolicy: 'no-user-gesture-required',
        },
    };

    const mainWindow = new BrowserWindow(opts);
    state.mainWindow = mainWindow;

    // Restore maximized state after creation
    if (savedState?.isMaximized) {
        mainWindow.maximize();
    }

    setupContextMenu(mainWindow.webContents);

    // F12 opens DevTools (dev builds only)
    mainWindow.webContents.on('before-input-event', (_event, input) => {
        if (!app.isPackaged && input.key === 'F12' && input.type === 'keyDown') {
            mainWindow.webContents.toggleDevTools();
        }
    });

    // The server could not be reached at all (DNS, refused, timeout, certificate).
    // Errors in embedded frames are the page's business, and -3 is a load we aborted ourselves.
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3 || validatedURL.startsWith('file://')) return;
        console.error(`[Lala] Page load failed: ${errorDescription} (${errorCode}) for ${validatedURL}`);
        navigateToConnectionPage({ error: errorDescription || 'Connection failed' });
    });

    // A page is in: show it, unless the server answered with a 5xx, which would be a proxy error page.
    // The connection page shows the error it is given and doesn't auto-connect after one.
    mainWindow.webContents.on('did-navigate', (_event, url, httpResponseCode) => {
        if (httpResponseCode >= 500) {
            console.error(`[Lala] Server error ${httpResponseCode} for ${url}`);
            navigateToConnectionPage({ error: `Server error: ${httpResponseCode}` });
        } else {
            showWindow();
        }
    });

    // Load the connection page
    mainWindow.loadFile('index.html');

    // Save window state on move/resize (debounced)
    let saveTimer = null;
    const debouncedSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveWindowState(mainWindow), 500);
    };
    mainWindow.on('resize', debouncedSave);
    mainWindow.on('move', debouncedSave);

    // Minimize to tray on close (unless quitting).
    // GNOME 3.26+ removed the system tray — hiding the window leaves users stranded.
    // On GNOME, just quit normally.
    mainWindow.on('close', (event) => {
        if (!state.isQuitting && HAS_SYSTEM_TRAY) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        state.mainWindow = null;
    });

    // Security: only allow renderer-initiated navigation (link clicks, JS
    // location changes, form submits, etc.) within the trusted origin model —
    // our own bundled connection page, or the same origin as the currently
    // connected server. Everything else is blocked; this is what contains a
    // page that gets redirected somewhere unexpected (MITM on http, a rogue
    // link, etc.) from being able to reach a different origin while still
    // holding the electronAPI bridge/permissions.
    //
    // Note: this does NOT fire for programmatic webContents.loadURL/loadFile()
    // calls made by the main process itself (initial connect, 502-flash recovery) — only
    // for navigations the page/user initiates — so those flows are unaffected.
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (isIndexHtmlUrl(url)) return;

        if (state.trustedOrigin) {
            try {
                if (new URL(url).origin === state.trustedOrigin) return;
            } catch { /* fall through to block */ }
        }

        // Untrusted destination — block the in-window navigation. If it's a
        // plain http(s) link (e.g. the user clicked an external link inside the
        // web app), send it to the OS browser instead of silently discarding
        // it. Never do this for file:, javascript:, or other schemes.
        event.preventDefault();
        if (isUrlAllowed(url)) {
            shell.openExternal(url).catch(() => {});
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // Open external links in the default browser
        if (isUrlAllowed(url)) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });
}

// ─── Downloads ───────────────────────────────────────────────────────────────
// File downloads (chat file sharing uses <a download href="blob:..."> anchors).
// We deliberately do NOT call item.setSavePath(): leaving the save path unset
// keeps Electron's default behavior of showing the native "Save As" dialog.
// The handler exists so that interrupted/cancelled/failed downloads are logged
// to stderr instead of vanishing silently. Note: window.open(blobUrl) is NOT a
// download path — setWindowOpenHandler denies it (blob: is not an allowed
// external protocol); the renderer must use download-attribute anchors.
function setupDownloadHandler() {
    session.defaultSession.on('will-download', (_event, item) => {
        const filename = item.getFilename() || '<unnamed>';
        console.log(`[Lala] Download started: ${filename} (${item.getTotalBytes()} bytes) from ${item.getURL()}`);
        item.on('done', (_e, state) => {
            if (state === 'completed') {
                console.log(`[Lala] Download completed: ${item.getSavePath()}`);
            } else {
                // 'cancelled' (incl. user dismissing the save dialog) or 'interrupted'
                console.error(`[Lala] Download ${state}: ${filename} from ${item.getURL()}`);
            }
        });
    });
}

module.exports = { createWindow, saveWindowState, loadServer, navigateToConnectionPage, setupDownloadHandler };
