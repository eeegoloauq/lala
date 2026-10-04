'use strict';

const { BrowserWindow, app, screen, session, shell, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const { IS_MAC, HAS_SYSTEM_TRAY, USER_DATA, IPC } = require('./constants');
const { state, sendToRenderer } = require('./state');
const { isUrlAllowed, isIndexHtmlUrl } = require('./trust');
const { getInitialWindowIcon } = require('./icons');

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
        show: false, // show after ready-to-show to avoid flash
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

    // Show smoothly when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // F12 opens DevTools (dev builds only)
    mainWindow.webContents.on('before-input-event', (_event, input) => {
        if (!app.isPackaged && input.key === 'F12' && input.type === 'keyDown') {
            mainWindow.webContents.toggleDevTools();
        }
    });

    // Fix preload race condition on cross-origin navigation.
    // When loadURL() navigates from file:// to https://, the preload script
    // may not inject electronAPI before page scripts run. Detect this and
    // reload once — same-origin reload guarantees correct preload timing.
    let hasReloadedForPreload = false;
    mainWindow.webContents.on('did-finish-load', () => {
        const currentUrl = mainWindow.webContents.getURL();
        // Only check on remote pages (not file:// index.html)
        if (!currentUrl.startsWith('http')) return;
        mainWindow.webContents.executeJavaScript('!!window.electronAPI')
            .then(hasAPI => {
                if (!hasAPI && !hasReloadedForPreload) {
                    hasReloadedForPreload = true;
                    console.log('[Lala] electronAPI not available after load, reloading once');
                    mainWindow.webContents.reload();
                }
                // Reset flag on successful load so future navigations can also retry
                if (hasAPI) {
                    hasReloadedForPreload = false;
                    if (!mainWindow.isVisible()) mainWindow.show();
                }
            })
            .catch(() => {});
    });

    // Handle complete connection failures (DNS, refused, timeout, cert errors).
    // Navigate back to connection page so user can retry or pick another server.
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        // Only handle remote URLs, not file:// (index.html)
        if (validatedURL.startsWith('file://')) return;
        // Ignore aborted loads (user navigated away, e.g. loadFile called)
        if (errorCode === -3) return;
        console.error(`[Lala] Page load failed: ${errorDescription} (${errorCode}) for ${validatedURL}`);
        hasReloadedForPreload = false;
        // navigateToConnectionPage() is a programmatic loadFile() call — it does
        // NOT fire 'will-navigate', so the navigation lock below never sees (and
        // never needs to allow) this recovery hop. It also drops trustedOrigin,
        // which is correct: the server we were trying to reach failed to load.
        navigateToConnectionPage({ error: '1' });
        // Send error after index.html loads and sets up IPC listeners
        mainWindow.webContents.once('did-finish-load', () => {
            sendToRenderer(IPC.LOAD_URL_ERROR, { message: errorDescription || 'Connection failed' });
            mainWindow.show();
        });
    });

    // Detect HTTP 5xx error pages (502 Bad Gateway, 503, etc.) and go back to
    // the connection page instead of showing a raw nginx/server error.
    mainWindow.webContents.on('did-navigate', (_event, url, httpResponseCode) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (!url.startsWith('http')) return;
        if (httpResponseCode >= 500) {
            console.error(`[Lala] Server error ${httpResponseCode} for ${url}`);
            hasReloadedForPreload = false;
            navigateToConnectionPage({ error: '1' });
            mainWindow.webContents.once('did-finish-load', () => {
                sendToRenderer(IPC.LOAD_URL_ERROR, { message: `Server error: ${httpResponseCode}` });
                mainWindow.show();
            });
        } else {
            // Success — show window
            mainWindow.show();
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

module.exports = { createWindow, saveWindowState, navigateToConnectionPage, setupDownloadHandler };
