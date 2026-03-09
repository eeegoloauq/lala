'use strict';

const {
    app,
    BrowserWindow,
    ipcMain,
    screen,
    Tray,
    Menu,
    nativeImage,
    session,
    desktopCapturer,
    shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { autoUpdater } = require('electron-updater');

// ─── App User Model ID (Windows) ────────────────────────────────────────────
// Must match appId in electron-builder.yml. Set before app is ready so Windows
// associates the process with the correct NSIS shortcut — fixes taskbar icon
// grouping, pinned icon display, and Task Manager icon.
app.setAppUserModelId('app.lala.desktop');

// ─── Platform Flags ──────────────────────────────────────────────────────────
// Wayland screen capture (PipeWire) — must be set before app is ready.
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
// Merge audio service into the renderer process — prevents duplicate entries
// in the Windows volume mixer (Chromium spawns a separate audio utility process
// that gets its own mixer entry with the baked-in .exe icon).
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess');

// ─── Constants ───────────────────────────────────────────────────────────────
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
const IS_WAYLAND = IS_LINUX && (
    process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY
);
const IS_GNOME = IS_LINUX && (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase().includes('gnome');

const WINDOW_MIN_WIDTH = 800;
const WINDOW_MIN_HEIGHT = 600;
const WINDOW_DEFAULT_WIDTH = 1280;
const WINDOW_DEFAULT_HEIGHT = 800;

const THUMBNAIL_SIZE = { width: 320, height: 180 };
const SCREEN_SHARE_SOURCE_TIMEOUT_MS = 30_000;

const WINDOW_STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
const ICON_PREF_FILE = path.join(app.getPath('userData'), 'icon-preference.json');
const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:']);
const ICON_VARIANTS = ['voice-wave', 'dark-sphere', 'single-wave', 'double-wave'];

// ─── IPC Channel Names ──────────────────────────────────────────────────────
const IPC = {
    // Renderer → Main
    LOAD_URL: 'lala:load-url',
    GET_DESKTOP_SOURCES: 'lala:get-desktop-sources',
    SET_SCREEN_SHARE_SOURCE: 'lala:set-screen-share-source',
    GET_APP_INFO: 'lala:get-app-info',
    SET_TITLE_SUFFIX: 'lala:set-title-suffix',
    SHOW_WINDOW: 'lala:show-window',
    CHECK_UPDATE: 'lala:check-update',
    INSTALL_UPDATE: 'lala:install-update',
    SET_BADGE_COUNT: 'lala:set-badge-count',
    GET_AUTO_LAUNCH: 'lala:get-auto-launch',
    SET_AUTO_LAUNCH: 'lala:set-auto-launch',
    SAVE_SESSION: 'lala:save-session',
    GET_APP_ICON: 'lala:get-app-icon',
    SET_APP_ICON: 'lala:set-app-icon',
    RELAUNCH: 'lala:relaunch',

    // Main → Renderer
    NAVIGATE_BACK: 'lala:navigate-back',
    LOAD_URL_ERROR: 'lala:load-url-error',
    UPDATE_STATUS: 'lala:update-status',
};

// ─── Single Instance Lock ────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

// ─── State ───────────────────────────────────────────────────────────────────
/** @type {BrowserWindow | null} */
let mainWindow = null;

/** @type {Tray | null} */
let tray = null;

/** @type {string | null} */
let pendingScreenShareSourceId = null;

/** @type {ReturnType<typeof setTimeout> | null} */
let screenShareSourceTimer = null;

let isQuitting = false;

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
        const state = {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            isMaximized: win.isMaximized(),
        };
        fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state));
    } catch { /* ignore write errors */ }
}

function getValidatedWindowState() {
    const state = loadWindowState();
    if (!state) return null;

    // Verify the saved position is still within a visible display
    const displays = screen.getAllDisplays();
    const isVisible = displays.some(display => {
        const { x, y, width, height } = display.bounds;
        return (
            state.x >= x &&
            state.y >= y &&
            state.x + state.width <= x + width &&
            state.y + state.height <= y + height
        );
    });

    return isVisible ? state : null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendToRenderer(channel, ...args) {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send(channel, ...args);
    }
}

function getTrayIcon() {
    // Platform-aware tray icon selection
    const trayDir = path.join(ICONS_DIR, 'tray');

    if (IS_MAC) {
        // macOS uses Template images (auto-adapts to dark/light menu bar)
        const templatePath = path.join(trayDir, 'trayTemplate-16.png');
        if (fs.existsSync(templatePath)) {
            const img = nativeImage.createFromPath(templatePath);
            // Load @2x for Retina
            const retina = path.join(trayDir, 'trayTemplate-16@2x.png');
            if (fs.existsSync(retina)) {
                img.addRepresentation({ scaleFactor: 2, filename: retina });
            }
            img.setTemplateImage(true);
            return img;
        }
    }

    // Windows — build nativeImage with 16px + 32px (high DPI) representations
    if (process.platform === 'win32') {
        const p16 = path.join(trayDir, 'tray-16.png');
        const p32 = path.join(trayDir, 'tray-32.png');
        if (fs.existsSync(p16)) {
            const img = nativeImage.createFromPath(p16);
            if (fs.existsSync(p32)) {
                img.addRepresentation({ scaleFactor: 2, filename: p32 });
            }
            return img;
        }
    }

    // Linux — use largest available colored icon
    const sizes = [48, 32, 24, 16];
    for (const size of sizes) {
        const p = path.join(trayDir, `tray-${size}.png`);
        if (fs.existsSync(p)) return nativeImage.createFromPath(p);
    }

    // Ultimate fallback — use app icon
    const appIcon = path.join(__dirname, 'build', 'icon.png');
    if (fs.existsSync(appIcon)) {
        return nativeImage.createFromPath(appIcon).resize({ width: 32, height: 32 });
    }

    return null;
}

function isUrlAllowed(url) {
    try {
        const parsed = new URL(url);
        return ALLOWED_URL_PROTOCOLS.has(parsed.protocol);
    } catch {
        return false;
    }
}

// ─── Icon Extraction ─────────────────────────────────────────────────────────
// Extract icon files from asar to userData on startup. This avoids relying on
// app.asar.unpacked which NSIS silent updates can fail to properly recreate.
// Electron's patched fs reads from asar transparently; we write to real disk.

const ICONS_DIR = path.join(app.getPath('userData'), 'icons');

function ensureIconsExtracted() {
    const versionFile = path.join(ICONS_DIR, '.version');
    const currentVersion = app.getVersion();

    try {
        if (fs.existsSync(versionFile) &&
            fs.readFileSync(versionFile, 'utf8') === currentVersion) {
            return; // Already extracted for this version
        }
    } catch {}

    // Extract variant icons
    const asarBase = path.join(__dirname, 'build', 'icon-variants');
    for (const variant of ICON_VARIANTS) {
        const srcDir = path.join(asarBase, variant);
        const destDir = path.join(ICONS_DIR, 'variants', variant);
        try {
            fs.mkdirSync(destDir, { recursive: true });
            for (const file of fs.readdirSync(srcDir)) {
                fs.writeFileSync(path.join(destDir, file), fs.readFileSync(path.join(srcDir, file)));
            }
        } catch {}
    }

    // Extract tray icons
    const traySrc = path.join(__dirname, 'build', 'tray');
    const trayDest = path.join(ICONS_DIR, 'tray');
    try {
        fs.mkdirSync(trayDest, { recursive: true });
        for (const file of fs.readdirSync(traySrc)) {
            fs.writeFileSync(path.join(trayDest, file), fs.readFileSync(path.join(traySrc, file)));
        }
    } catch {}

    try { fs.writeFileSync(versionFile, currentVersion); } catch {}
}

// ─── Icon Preference ─────────────────────────────────────────────────────────

function getIconPreference() {
    try {
        if (fs.existsSync(ICON_PREF_FILE)) {
            const { icon } = JSON.parse(fs.readFileSync(ICON_PREF_FILE, 'utf8'));
            if (ICON_VARIANTS.includes(icon)) return icon;
        }
    } catch { /* ignore */ }
    return 'voice-wave';
}

function saveIconPreference(name) {
    try {
        fs.writeFileSync(ICON_PREF_FILE, JSON.stringify({ icon: name }));
    } catch { /* ignore */ }
}

function getVariantIconPath(variantName) {
    return path.join(ICONS_DIR, 'variants', variantName);
}

function buildMultiSizeIcon(variantDir) {
    // Build a nativeImage with multiple size representations.
    // Windows uses the appropriate size for each context (taskbar=32, alt-tab=64, etc.)
    const sizes = [16, 32, 48, 64, 256];
    let img = null;

    for (const size of sizes) {
        const p = path.join(variantDir, `icon-${size}.png`);
        if (!fs.existsSync(p)) continue;

        if (!img) {
            img = nativeImage.createFromPath(p);
        } else {
            img.addRepresentation({ width: size, height: size, filename: p });
        }
    }

    return img;
}

function applyIcon(variantName) {
    const variantDir = getVariantIconPath(variantName);

    // Update tray icon
    if (tray) {
        const p16 = path.join(variantDir, 'tray-16.png');
        const p32 = path.join(variantDir, 'tray-32.png');
        const p48 = path.join(variantDir, 'tray-48.png');

        if (IS_MAC) {
            // macOS: use default tray template (doesn't change per variant)
        } else if (process.platform === 'win32' && fs.existsSync(p16)) {
            const img = nativeImage.createFromPath(p16);
            if (fs.existsSync(p32)) {
                img.addRepresentation({ scaleFactor: 2, filename: p32 });
            }
            tray.setImage(img);
        } else if (fs.existsSync(p48)) {
            tray.setImage(nativeImage.createFromPath(p48));
        } else if (fs.existsSync(p32)) {
            tray.setImage(nativeImage.createFromPath(p32));
        }
    }

    // Update window icon (title bar + alt-tab + taskbar)
    if (mainWindow && !mainWindow.isDestroyed()) {
        let icon = null;

        // On Windows, load directly from .ico — nativeImage parses all sizes from the
        // ICO container, producing a proper multi-size HICON for WM_SETICON.
        // Building from individual PNGs via addRepresentation() doesn't reliably
        // update the taskbar icon (Windows caches HICON from the first setIcon call).
        if (process.platform === 'win32') {
            const icoPath = path.join(variantDir, 'icon.ico');
            if (fs.existsSync(icoPath)) {
                icon = nativeImage.createFromPath(icoPath);
            }
        }

        if (!icon) {
            icon = buildMultiSizeIcon(variantDir);
        }

        if (icon) {
            mainWindow.setIcon(icon);
        }
    }

    // Linux: install icons to ~/.local/share/icons/hicolor/ and update .desktop override.
    // GNOME Wayland reads the dock icon from the .desktop file, not from the window.
    // The change takes effect on next app launch (GNOME caches running app icons).
    if (IS_LINUX) {
        installLinuxDesktopIcon(variantDir);
    }
}

function installLinuxDesktopIcon(variantDir) {
    const home = os.homedir();
    const sizes = [16, 32, 48, 64, 256];

    // Copy variant PNGs to user's hicolor theme (overrides system icons)
    for (const size of sizes) {
        const src = path.join(variantDir, `icon-${size}.png`);
        if (!fs.existsSync(src)) continue;

        const destDir = path.join(home, '.local', 'share', 'icons',
            'hicolor', `${size}x${size}`, 'apps');
        try {
            fs.mkdirSync(destDir, { recursive: true });
            fs.copyFileSync(src, path.join(destDir, 'lala-desktop.png'));
        } catch (_) { /* best-effort */ }
    }

    // Write .desktop override (especially needed for AppImage where no system .desktop exists)
    const appsDir = path.join(home, '.local', 'share', 'applications');
    try {
        fs.mkdirSync(appsDir, { recursive: true });
        const execPath = process.env.APPIMAGE || process.execPath;
        fs.writeFileSync(path.join(appsDir, 'lala-desktop.desktop'),
            `[Desktop Entry]\nName=Lala\nComment=Voice & Video Chat\nExec="${execPath}" %U\nIcon=lala-desktop\nType=Application\nCategories=Network;\nStartupWMClass=lala-desktop\nTerminal=false\n`);
    } catch (_) { /* best-effort */ }

    // Update icon cache (best-effort, commands may not be installed)
    const iconDir = path.join(home, '.local', 'share', 'icons', 'hicolor');
    execFile('gtk-update-icon-cache', ['-f', '-t', iconDir], () => {});
    execFile('update-desktop-database', [appsDir], () => {});
}

// ─── Window Creation ─────────────────────────────────────────────────────────

function getInitialWindowIcon() {
    // Use saved icon variant for window creation (avoids flash of default icon)
    const variant = getIconPreference();
    const variantDir = getVariantIconPath(variant);
    const icon = buildMultiSizeIcon(variantDir);
    if (icon) return icon;
    // Fallback to default build icon
    return path.join(__dirname, 'build', 'icon.png');
}

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
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            spellcheck: false,
        },
    };

    mainWindow = new BrowserWindow(opts);

    // Restore maximized state after creation
    if (savedState?.isMaximized) {
        mainWindow.maximize();
    }

    // Show smoothly when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // F12 opens DevTools (Ctrl+Shift+I also works)
    mainWindow.webContents.on('before-input-event', (_event, input) => {
        if (input.key === 'F12' && input.type === 'keyDown') {
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
                }
            })
            .catch(() => {});
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
        if (!isQuitting && !IS_GNOME) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Security: block navigation to non-allowed URLs and new-window popups
    mainWindow.webContents.on('will-navigate', (event, url) => {
        // Allow navigation within the app (file:// for index.html, loaded server URL)
        if (url.startsWith('file://')) return;
        if (!isUrlAllowed(url)) {
            event.preventDefault();
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

// ─── Tray ────────────────────────────────────────────────────────────────────

function createTray() {
    const icon = getTrayIcon();
    if (!icon) {
        console.warn('[Lala] No tray icon found — tray disabled');
        return;
    }

    tray = new Tray(icon);
    tray.setToolTip('Lala');

    const locale = app.getLocale();
    const isRu = locale.startsWith('ru');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: isRu ? 'Выход' : 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            },
        },
    ]);

    tray.setContextMenu(contextMenu);

    // Click on tray icon shows/focuses the window
    tray.on('click', () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
            mainWindow.focus();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // Double-click (Windows)
    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// ─── Screen Share ────────────────────────────────────────────────────────────

function clearPendingScreenShare() {
    pendingScreenShareSourceId = null;
    if (screenShareSourceTimer) {
        clearTimeout(screenShareSourceTimer);
        screenShareSourceTimer = null;
    }
}

function setupScreenShareHandler() {
    if (IS_WAYLAND) {
        // On Wayland, desktopCapturer.getSources() triggers the XDG desktop portal
        // (PipeWire) which shows the native screen/window picker. We must still
        // register setDisplayMediaRequestHandler — without it Electron denies
        // getDisplayMedia() entirely. Inside the handler we call getSources()
        // to invoke the portal, then pass the user-selected source to the callback.
        console.log('[Lala] Wayland detected — using XDG portal for screen share');
        session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
            try {
                console.log('[Lala] Screen share (Wayland): requesting sources via portal');
                const sources = await desktopCapturer.getSources({
                    types: ['screen', 'window'],
                });
                if (sources.length > 0) {
                    // The portal returns only the user-selected source
                    console.log('[Lala] Screen share (Wayland): got source', sources[0].id);
                    callback({ video: sources[0] });
                } else {
                    // User cancelled the portal picker
                    console.log('[Lala] Screen share (Wayland): no source selected (user cancelled)');
                    callback({});
                }
            } catch (err) {
                console.error('[Lala] Screen share (Wayland): portal error', err.message);
                callback({});
            }
        });
        return;
    }

    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
        if (pendingScreenShareSourceId) {
            const sourceId = pendingScreenShareSourceId;
            clearPendingScreenShare();
            console.log('[Lala] Screen share: using pre-selected source', sourceId);
            callback({ video: { id: sourceId, name: sourceId }, audio: 'loopbackWithoutChrome' });
        } else {
            // Source must be pre-selected by the React UI via IPC.
            // If we get here, it means the UI flow was bypassed — cancel gracefully.
            console.warn('[Lala] Screen share: no source pre-selected, cancelling');
            callback({});
        }
    });
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

function registerIpcHandlers() {
    // Load a server URL (from connection page)
    ipcMain.on(IPC.LOAD_URL, (event, url) => {
        if (!mainWindow) return;
        if (!isUrlAllowed(url)) {
            sendToRenderer(IPC.LOAD_URL_ERROR, { message: 'Invalid URL protocol. Only HTTP(S) is allowed.' });
            return;
        }
        mainWindow.loadURL(url).catch(err => {
            console.error('[Lala] Failed to load URL:', err.message);
            sendToRenderer(IPC.LOAD_URL_ERROR, { message: err.message });
        });
    });

    // Get desktop sources for screen share picker
    ipcMain.handle(IPC.GET_DESKTOP_SOURCES, async () => {
        try {
            const sources = await desktopCapturer.getSources({
                types: ['screen', 'window'],
                thumbnailSize: THUMBNAIL_SIZE,
                fetchWindowIcons: true,
            });
            // Filter out the Lala window itself
            const lalaTitle = mainWindow?.getTitle() || '';
            return sources
                .filter(source => source.name !== lalaTitle)
                .map(source => ({
                    id: source.id,
                    name: source.name,
                    thumbnail: `data:image/jpeg;base64,${source.thumbnail.toJPEG(70).toString('base64')}`,
                    appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
                    displayId: source.display_id,
                }));
        } catch (err) {
            console.error('[Lala] Error getting desktop sources:', err.message);
            return [];
        }
    });

    // Pre-select screen share source (called before getDisplayMedia)
    ipcMain.handle(IPC.SET_SCREEN_SHARE_SOURCE, (_event, id) => {
        clearPendingScreenShare();
        pendingScreenShareSourceId = id;

        // Auto-clear after timeout to prevent stale state
        screenShareSourceTimer = setTimeout(() => {
            if (pendingScreenShareSourceId === id) {
                console.warn('[Lala] Screen share source timed out:', id);
                pendingScreenShareSourceId = null;
            }
            screenShareSourceTimer = null;
        }, SCREEN_SHARE_SOURCE_TIMEOUT_MS);

        return true;
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
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setTitle(suffix ? `Lala — ${suffix}` : 'Lala');
        }
    });

    // Show window (used by renderer to restore from tray)
    ipcMain.on(IPC.SHOW_WINDOW, () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // Auto-updater
    ipcMain.handle(IPC.CHECK_UPDATE, () => {
        return autoUpdater.checkForUpdates().catch(() => null);
    });

    ipcMain.on(IPC.INSTALL_UPDATE, () => {
        isQuitting = true;

        // On Linux RPM, electron-updater's quitAndInstall() runs dnf via spawnSync
        // while the app is still alive — dnf fails because files are locked.
        // Fix: quit first, then a detached script waits for exit and runs dnf.
        if (IS_LINUX && autoUpdater.installerPath && autoUpdater.installerPath.endsWith('.rpm')) {
            const installerPath = autoUpdater.installerPath;
            const execPath = process.env.APPIMAGE || process.execPath;
            const script = [
                '#!/bin/bash',
                `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
                `pkexec dnf install --nogpgcheck -y "${installerPath}" || pkexec rpm -U --force "${installerPath}"`,
                `nohup "${execPath}" &>/dev/null &`,
            ].join('\n');

            const scriptPath = path.join(app.getPath('temp'), 'lala-update.sh');
            fs.writeFileSync(scriptPath, script, { mode: 0o755 });

            const child = require('child_process').spawn('/bin/bash', [scriptPath], {
                detached: true,
                stdio: 'ignore',
            });
            child.unref();
            app.quit();
            return;
        }

        autoUpdater.quitAndInstall(true, true);
    });

    // Badge count for unread messages
    ipcMain.on(IPC.SET_BADGE_COUNT, (_event, count) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;

        // Flash taskbar on Windows when there are unread messages
        if (process.platform === 'win32' && count > 0 && !mainWindow.isFocused()) {
            mainWindow.flashFrame(true);
        }

        // macOS dock badge
        if (IS_MAC && app.dock) {
            app.dock.setBadge(count > 0 ? String(count) : '');
        }

        // Linux badge count (Unity/KDE)
        if (IS_LINUX) {
            app.setBadgeCount(count);
        }

        // Update tray tooltip with unread count
        if (tray) {
            tray.setToolTip(count > 0 ? `Lala (${count} unread)` : 'Lala');
        }
    });

    // Auto-launch
    ipcMain.handle(IPC.GET_AUTO_LAUNCH, () => {
        return app.getLoginItemSettings().openAtLogin;
    });

    ipcMain.handle(IPC.SET_AUTO_LAUNCH, (_event, enabled) => {
        app.setLoginItemSettings({ openAtLogin: enabled });
        return true;
    });

    // Icon preference
    ipcMain.handle(IPC.GET_APP_ICON, () => {
        return getIconPreference();
    });

    ipcMain.handle(IPC.SET_APP_ICON, (_event, name) => {
        if (!ICON_VARIANTS.includes(name)) return false;
        saveIconPreference(name);
        applyIcon(name);
        return true;
    });

    ipcMain.on(IPC.RELAUNCH, () => {
        const options = { args: process.argv.slice(1) };
        if (process.env.APPIMAGE) {
            options.execPath = process.env.APPIMAGE;
            options.args.unshift('--appimage-extract-and-run');
        }
        app.relaunch(options);
        app.exit(0);
    });

    // Session persistence
    ipcMain.on(IPC.SAVE_SESSION, (_event, data) => {
        if (data) saveSession(data);
        else clearSession();
    });
}

// ─── Auto-Updater ───────────────────────────────────────────────────────────

function setupAutoUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
        sendToRenderer(IPC.UPDATE_STATUS, { status: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
        sendToRenderer(IPC.UPDATE_STATUS, {
            status: 'available',
            version: info.version,
        });
        // Auto-download after notifying renderer
        autoUpdater.downloadUpdate().catch(err => {
            console.error('[Lala] Update download failed:', err.message);
        });
    });

    autoUpdater.on('update-not-available', () => {
        sendToRenderer(IPC.UPDATE_STATUS, { status: 'not-available' });
    });

    autoUpdater.on('download-progress', (progress) => {
        sendToRenderer(IPC.UPDATE_STATUS, {
            status: 'downloading',
            percent: Math.round(progress.percent),
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        sendToRenderer(IPC.UPDATE_STATUS, {
            status: 'ready',
            version: info.version,
        });
    });

    autoUpdater.on('error', (err) => {
        console.error('[Lala] Auto-updater error:', err.message);

        // 404 means the release is still building (latest.yml not uploaded yet)
        // or the current version's tag was just pushed. Show a friendly message.
        if (err.message && err.message.includes('404')) {
            sendToRenderer(IPC.UPDATE_STATUS, { status: 'not-available' });
            return;
        }

        const detail = `${err.message}\n\nLala ${app.getVersion()} / ${process.platform} ${process.arch}`;
        sendToRenderer(IPC.UPDATE_STATUS, {
            status: 'error',
            error: detail,
        });
    });

    // Check for updates after a delay. Longer delay avoids hitting 404 when
    // the app was just updated and CI is still building the next release assets.
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch(err => {
            console.error('[Lala] Initial update check failed:', err.message);
        });
    }, 30_000);
}

// ─── Crash Handling ─────────────────────────────────────────────────────────

const CRASH_LOG_DIR = path.join(app.getPath('userData'), 'crash-logs');
const RUNNING_LOCK = path.join(app.getPath('userData'), 'running.lock');
const SESSION_FILE = path.join(app.getPath('userData'), 'session.json');

let previousCrash = false;

function setupCrashHandling() {
    // Detect if previous session crashed
    try {
        if (fs.existsSync(RUNNING_LOCK)) {
            previousCrash = true;
        }
    } catch { /* ignore */ }

    // Write running lock
    try {
        fs.writeFileSync(RUNNING_LOCK, String(Date.now()));
    } catch { /* ignore */ }

    // Ensure crash-logs directory exists
    try {
        fs.mkdirSync(CRASH_LOG_DIR, { recursive: true });
    } catch { /* ignore */ }

    process.on('uncaughtException', (err) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(CRASH_LOG_DIR, `crash-${timestamp}.log`);
        try {
            fs.writeFileSync(logPath, `Uncaught Exception: ${err.stack || err.message}\n`);
        } catch { /* ignore write errors */ }
        console.error('[Lala] Uncaught exception:', err);
    });

    app.on('render-process-gone', (_event, _webContents, details) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(CRASH_LOG_DIR, `render-crash-${timestamp}.log`);
        try {
            fs.writeFileSync(logPath, `Render process gone: ${JSON.stringify(details)}\n`);
        } catch { /* ignore write errors */ }
        console.error('[Lala] Render process gone:', details.reason);
    });
}

function cleanupRunningLock() {
    try {
        if (fs.existsSync(RUNNING_LOCK)) fs.unlinkSync(RUNNING_LOCK);
    } catch { /* ignore */ }
}

function saveSession(data) {
    try {
        fs.writeFileSync(SESSION_FILE, JSON.stringify({ ...data, timestamp: Date.now() }));
    } catch { /* ignore */ }
}

function loadSession() {
    try {
        if (!fs.existsSync(SESSION_FILE)) return null;
        const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
        // Session stale after 24 hours
        if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) return null;
        return data;
    } catch { return null; }
}

function clearSession() {
    try {
        if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
    } catch { /* ignore */ }
}

// ─── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
    ensureIconsExtracted();
    setupCrashHandling();
    registerIpcHandlers();
    createWindow();
    setupScreenShareHandler();
    createTray();
    setupAutoUpdater();

    // Apply saved icon preference
    const savedIcon = getIconPreference();
    if (savedIcon !== 'voice-wave') {
        applyIcon(savedIcon);
    }

    // Clear badge on focus
    if (mainWindow) {
        mainWindow.on('focus', () => {
            if (process.platform === 'win32') mainWindow.flashFrame(false);
            if (IS_MAC && app.dock) app.dock.setBadge('');
            if (IS_LINUX) app.setBadgeCount(0);
            if (tray) tray.setToolTip('Lala');
        });
    }

    // macOS: re-create window on dock click
    app.on('activate', () => {
        if (!mainWindow) {
            createWindow();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
    });
});

// Second instance handling (single instance lock)
app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

app.on('before-quit', () => {
    isQuitting = true;
    if (mainWindow) saveWindowState(mainWindow);
    clearPendingScreenShare();
    cleanupRunningLock();
});

app.on('window-all-closed', () => {
    if (!IS_MAC) {
        app.quit();
    }
});
