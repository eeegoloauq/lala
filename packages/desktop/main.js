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
    powerSaveBlocker,
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
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// ─── Constants ───────────────────────────────────────────────────────────────
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
const IS_WAYLAND = IS_LINUX && (
    process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY
);
const IS_GNOME = IS_LINUX && (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase().includes('gnome');
const HAS_SYSTEM_TRAY = !IS_LINUX || (!IS_GNOME && !process.env.SWAYSOCK && !process.env.HYPRLAND_INSTANCE_SIGNATURE);

// How this build was installed — decides desktop integration and update behavior.
// 'appimage'       — APPIMAGE env set by the AppImage runtime; no system .desktop exists,
//                    so we own the user-level launcher entry and self-update in place.
// 'system-package' — Linux package owned by the distro package manager (execPath under
//                    /usr/, e.g. Copr RPM in /usr/lib/lala); dnf owns the files, we must
//                    neither write launcher overrides nor run electron-updater.
// 'github-rpm'     — electron-builder RPM/tar.gz from GitHub Releases (/opt/Lala);
//                    updates via electron-updater + pkexec dnf install.
const INSTALL_CHANNEL = (() => {
    if (process.env.APPIMAGE) return 'appimage';
    if (process.platform === 'win32') return 'windows';
    if (IS_MAC) return 'macos';
    if (IS_LINUX) return process.execPath.startsWith('/usr/') ? 'system-package' : 'github-rpm';
    return 'unknown';
})();

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
// Absolute path of our bundled connection page — used to make sure `file://`
// navigation is only ever permitted to this exact file, not arbitrary local paths.
const INDEX_HTML_PATH = path.join(__dirname, 'index.html');

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
    SET_IN_CALL: 'lala:set-in-call',
    GET_APP_ICON: 'lala:get-app-icon',
    SET_APP_ICON: 'lala:set-app-icon',
    RELAUNCH: 'lala:relaunch',

    PING_SERVER: 'lala:ping-server',
    // Bidirectional
    NAVIGATE_BACK: 'lala:navigate-back',
    // Main → Renderer
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

// Origin of the currently-connected server, set when LOAD_URL loads a server
// URL and cleared whenever we navigate back to the local connection page.
// This is the trust boundary for the electronAPI bridge, WebRTC permissions,
// and screen capture — the local file:// connection page and this origin are
// the only two contexts allowed to use them. See "Origin Trust Helpers" below.
/** @type {string | null} */
let trustedOrigin = null;

let isQuitting = false;

let powerSaveBlockerId = null;

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

function isIndexHtmlUrl(url) {
    // Restrict file:// navigation to exactly our bundled index.html (any query
    // string, e.g. ?error=1, is fine) — blocks navigation to arbitrary local
    // files that a compromised renderer might try to reach via window.location.
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol !== 'file:') return false;
    try {
        let filePath = decodeURIComponent(parsed.pathname);
        // On Windows, file:// URLs have a leading slash before the drive letter (/C:/...)
        if (process.platform === 'win32') filePath = filePath.replace(/^\/+/, '');
        return path.normalize(filePath) === path.normalize(INDEX_HTML_PATH);
    } catch {
        return false;
    }
}

// ─── Origin Trust Helpers ───────────────────────────────────────────────────
// The window can only ever be showing one of two trusted contexts: our local
// file:// connection page, or the remote origin the user picked (tracked in
// `trustedOrigin`). Everything below re-derives trust from the *current*
// state of the frame/webContents making the request — never from whether a
// navigation was merely allowed at some point in the past.

function classifySender(event) {
    const frame = event.senderFrame;
    if (!frame || typeof frame.url !== 'string') {
        return { isFileTop: false, isTrustedTop: false };
    }
    // Only the top-level frame of our single window may use sensitive channels
    // — never an embedded sub-frame/iframe, even if same-origin.
    const isTopFrame = !!mainWindow && !mainWindow.isDestroyed() &&
        frame === mainWindow.webContents.mainFrame;
    if (!isTopFrame) return { isFileTop: false, isTrustedTop: false };

    if (frame.url.startsWith('file://')) {
        return { isFileTop: true, isTrustedTop: false };
    }
    try {
        const origin = new URL(frame.url).origin;
        return { isFileTop: false, isTrustedTop: trustedOrigin !== null && origin === trustedOrigin };
    } catch {
        return { isFileTop: false, isTrustedTop: false };
    }
}

/** True if the IPC event was sent from the top-level local connection page. */
function isFileSender(event) {
    return classifySender(event).isFileTop;
}

/** True if the IPC event was sent from the top-level currently-trusted server origin. */
function isTrustedSender(event) {
    return classifySender(event).isTrustedTop;
}

/** True if the IPC event was sent from either trusted context. */
function isFileOrTrustedSender(event) {
    const { isFileTop, isTrustedTop } = classifySender(event);
    return isFileTop || isTrustedTop;
}

/** True if a WebContents' current top-level URL is the trusted server origin. */
function isWebContentsOriginTrusted(webContents) {
    if (!webContents || webContents.isDestroyed() || trustedOrigin === null) return false;
    try {
        return new URL(webContents.getURL()).origin === trustedOrigin;
    } catch {
        return false;
    }
}

/**
 * Navigate back to the local connection page. Centralizes the three things
 * that must always happen together: stop the power-save blocker, drop trust
 * in the previously-connected origin, and load index.html. Used by manual
 * "change server" actions as well as automatic error recovery.
 */
function navigateToConnectionPage(query) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (powerSaveBlockerId !== null) {
        powerSaveBlocker.stop(powerSaveBlockerId);
        powerSaveBlockerId = null;
    }
    trustedOrigin = null;
    mainWindow.loadFile('index.html', query ? { query } : undefined);
}

// ─── Icon Extraction ─────────────────────────────────────────────────────────
// Extract icon files from asar to userData on startup. This avoids relying on
// app.asar.unpacked which NSIS silent updates can fail to properly recreate.
// Electron's patched fs reads from asar transparently; we write to real disk.

const ICONS_DIR = path.join(app.getPath('userData'), 'icons');
let cachedIconPref = null;

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
    if (cachedIconPref) return cachedIconPref;
    try {
        if (fs.existsSync(ICON_PREF_FILE)) {
            const { icon } = JSON.parse(fs.readFileSync(ICON_PREF_FILE, 'utf8'));
            if (ICON_VARIANTS.includes(icon)) {
                cachedIconPref = icon;
                return icon;
            }
        }
    } catch { /* ignore */ }
    cachedIconPref = 'voice-wave';
    return 'voice-wave';
}

function saveIconPreference(name) {
    cachedIconPref = name;
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

function applyIcon(variantName, { forceRedraw = false } = {}) {
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

    // Update window icon (title bar + alt-tab).
    // On Windows, .ico files trigger the LoadImage Win32 API path which correctly
    // extracts per-size HICONs. PNG-based buildMultiSizeIcon is ignored for HICON
    // generation — addRepresentation doesn't affect GetHICON().
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (process.platform === 'win32') {
            const icoPath = path.join(variantDir, 'icon.ico');
            if (fs.existsSync(icoPath)) {
                mainWindow.setIcon(nativeImage.createFromPath(icoPath));
            }
        } else {
            const icon = buildMultiSizeIcon(variantDir);
            if (icon) mainWindow.setIcon(icon);
        }
    }

    // Windows: copy .ico to userData and update .lnk shortcuts + shell notify.
    // Same approach as AyuGram: write .ico → update .lnk IconLocation →
    // SHChangeNotify(SHCNE_ASSOCCHANGED) to force Explorer to refresh icon cache.
    if (process.platform === 'win32') {
        const srcIco = path.join(variantDir, 'icon.ico');
        const fixedIco = path.join(app.getPath('userData'), 'app-icon.ico');
        if (fs.existsSync(srcIco)) {
            try {
                fs.copyFileSync(srcIco, fixedIco);
            } catch {}
        }
        if (forceRedraw) {
            updateWindowsShortcutIcons(fixedIco);
        }
    }

    // Linux: install icons to ~/.local/share/icons/hicolor/ and update .desktop override.
    if (IS_LINUX) {
        installLinuxDesktopIcon(variantDir);
    }
}

/**
 * Find all Lala .lnk shortcuts (Start Menu, Desktop) and update their icon
 * to point to the given .ico path. Uses shell.readShortcutLink/writeShortcutLink
 * which is Windows-only. After updating, the new icon appears on next launch
 * (or immediately if Windows refreshes its icon cache).
 */
function updateWindowsShortcutIcons(icoPath) {
    if (process.platform !== 'win32' || !fs.existsSync(icoPath)) return;

    const shortcutDirs = [];

    // Start Menu shortcuts (per-user + all-users)
    const appData = process.env.APPDATA;
    const programData = process.env.PROGRAMDATA || process.env.ALLUSERSPROFILE;
    if (appData) {
        shortcutDirs.push(path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
    }
    if (programData) {
        shortcutDirs.push(path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
    }

    // Desktop shortcuts (per-user + public)
    const userProfile = process.env.USERPROFILE;
    const publicDir = process.env.PUBLIC;
    if (userProfile) {
        shortcutDirs.push(path.join(userProfile, 'Desktop'));
    }
    if (publicDir) {
        shortcutDirs.push(path.join(publicDir, 'Desktop'));
    }

    // Taskbar pinned shortcuts
    if (appData) {
        shortcutDirs.push(path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'));
    }

    let updated = 0;
    for (const dir of shortcutDirs) {
        try {
            if (!fs.existsSync(dir)) continue;
            const files = fs.readdirSync(dir);
            for (const file of files) {
                if (!file.endsWith('.lnk')) continue;
                // Match "Lala.lnk" or any .lnk whose target points to our exe
                const lnkPath = path.join(dir, file);
                try {
                    const details = shell.readShortcutLink(lnkPath);
                    const target = (details.target || '').toLowerCase();
                    const isLala = file.toLowerCase().includes('lala') ||
                        target.includes('lala') ||
                        target === process.execPath.toLowerCase();
                    if (!isLala) continue;

                    shell.writeShortcutLink(lnkPath, 'update', {
                        icon: icoPath,
                        iconIndex: 0,
                    });
                    updated++;
                } catch {}
            }
        } catch {}
    }

    // Notify Windows Shell to refresh icon cache (same approach as AyuGram).
    // SHChangeNotify(SHCNE_ASSOCCHANGED) is the proper Win32 API for this.
    // Called via PowerShell -EncodedCommand to avoid command-line escaping issues.
    const psCmd = 'Add-Type \'using System;using System.Runtime.InteropServices;public class S{[DllImport("shell32.dll")]public static extern void SHChangeNotify(int w,uint u,IntPtr a,IntPtr b);}\';[S]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)';
    const encoded = Buffer.from(psCmd, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], () => {});
}

function installLinuxDesktopIcon(variantDir) {
    // Only AppImage lacks system-installed .desktop/icons. RPM installs
    // (electron-builder /opt/Lala or Copr /usr/lib/lala) ship a valid
    // /usr/share/applications/lala-desktop.desktop — a user-level override
    // written here would shadow it with an absolute Exec path that goes
    // stale after an upgrade, making the launcher entry vanish.
    if (INSTALL_CHANNEL !== 'appimage') return;

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

/**
 * Self-heal: older versions wrote a user-level .desktop override on every
 * launch regardless of install type. On RPM installs it shadows the package's
 * /usr/share/applications entry, and after an upgrade/relayout its absolute
 * Exec path points at a binary that no longer exists — the app disappears
 * from GNOME. Remove the override if it's ours and either duplicates a
 * system-installed entry or points at a missing binary. Best-effort.
 */
function removeStaleDesktopOverride() {
    if (!IS_LINUX || INSTALL_CHANNEL === 'appimage') return;

    const appsDir = path.join(os.homedir(), '.local', 'share', 'applications');
    const overridePath = path.join(appsDir, 'lala-desktop.desktop');
    try {
        if (!fs.existsSync(overridePath)) return;
        const content = fs.readFileSync(overridePath, 'utf8');
        // Only touch files we wrote ourselves.
        if (!content.includes('StartupWMClass=lala-desktop')) return;

        const execLine = content.split('\n').find(line => line.startsWith('Exec='));
        const quoted = execLine && execLine.match(/^Exec="([^"]+)"/);
        const binary = quoted ? quoted[1] : (execLine ? execLine.slice(5).split(' ')[0] : null);

        const binaryMissing = !binary || !fs.existsSync(binary);
        const shadowsSystemEntry = fs.existsSync('/usr/share/applications/lala-desktop.desktop');
        if (binaryMissing || shadowsSystemEntry) {
            fs.unlinkSync(overridePath);
            execFile('update-desktop-database', [appsDir], () => {});
        }
    } catch { /* best-effort */ }
}

// ─── Window Creation ─────────────────────────────────────────────────────────

function getInitialWindowIcon() {
    // Use saved icon variant for window creation (avoids flash of default icon)
    const variant = getIconPreference();
    const variantDir = getVariantIconPath(variant);

    // On Windows, prefer the fixed .ico in userData (written by applyIcon on previous run)
    if (process.platform === 'win32') {
        const fixedIco = path.join(app.getPath('userData'), 'app-icon.ico');
        if (fs.existsSync(fixedIco)) {
            return nativeImage.createFromPath(fixedIco);
        }
        const variantIco = path.join(variantDir, 'icon.ico');
        if (fs.existsSync(variantIco)) {
            return nativeImage.createFromPath(variantIco);
        }
    }

    const icon = buildMultiSizeIcon(variantDir);
    if (icon) return icon;
    // Fallback to default build icon
    const fallbackPath = path.join(__dirname, 'build', 'icon.png');
    if (fs.existsSync(fallbackPath)) return nativeImage.createFromPath(fallbackPath);
    return undefined;
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
            backgroundThrottling: false,
            autoplayPolicy: 'no-user-gesture-required',
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
        if (!isQuitting && HAS_SYSTEM_TRAY) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
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
    // calls made by main.js itself (initial connect, 502-flash recovery) — only
    // for navigations the page/user initiates — so those flows are unaffected.
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (isIndexHtmlUrl(url)) return;

        if (trustedOrigin) {
            try {
                if (new URL(url).origin === trustedOrigin) return;
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
            label: isRu ? 'Сменить сервер' : 'Change server',
            click: () => {
                if (!mainWindow || mainWindow.isDestroyed()) return;
                navigateToConnectionPage();
                mainWindow.show();
            },
        },
        { type: 'separator' },
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

/**
 * Gate for setDisplayMediaRequestHandler: only the top-level frame of the
 * page the window is currently displaying may capture the screen. Silent
 * screen capture from a third-party frame/origin (e.g. an embedded iframe)
 * is exactly the vector this closes.
 *
 * Trust is derived from mainWindow.webContents.getURL() at request time:
 * the will-navigate lock already guarantees that URL is either our local
 * file:// connection page or the server the user picked, so a capture
 * request coming from the window's own loaded page is exactly as trusted
 * as the page itself. We deliberately do NOT compare against a separately
 * maintained value (the old check against `trustedOrigin` broke because
 * Electron's request.securityOrigin is a Chromium-serialized URL with a
 * trailing slash — "https://host/" — which never string-equals a bare
 * URL.origin, so every request was denied).
 *
 * Returns null when the request is trusted, otherwise a deny reason that
 * names both the requesting and the expected origin so reports are
 * self-diagnosing.
 */
function getDisplayCaptureDenyReason(request) {
    if (!mainWindow || mainWindow.isDestroyed()) return 'no window';

    // Only the top-level frame may capture — never a sub-frame/iframe.
    if (request.frame && request.frame !== mainWindow.webContents.mainFrame) {
        return `sub-frame capture request (frame url: ${request.frame.url})`;
    }

    // Expected origin = whatever page the window itself is showing. The
    // file:// connection page (or an empty window) never captures.
    let expectedOrigin;
    const currentUrl = mainWindow.webContents.getURL();
    try {
        const parsed = new URL(currentUrl);
        if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
            return `window is not showing a server page (current url: ${currentUrl || '<none>'})`;
        }
        expectedOrigin = parsed.origin;
    } catch {
        return `window url is unparseable (current url: ${currentUrl || '<none>'})`;
    }

    // request.securityOrigin is a serialized URL (usually with a trailing
    // slash), not a bare origin — normalize via new URL().origin before
    // comparing, same as the permission check handler does.
    const rawRequesting = request.securityOrigin || (request.frame && request.frame.url) || '';
    let requestingOrigin;
    try {
        requestingOrigin = new URL(rawRequesting).origin;
    } catch {
        requestingOrigin = rawRequesting || '<unknown>';
    }
    if (requestingOrigin !== expectedOrigin) {
        return `untrusted origin (requesting: ${requestingOrigin}, expected: ${expectedOrigin})`;
    }
    return null;
}

// Deny a display-media request the way Electron actually supports: only
// `callback(null)` (or undefined) makes it respond CAPTURE_FAILURE so the
// renderer's getDisplayMedia() rejects cleanly. `callback({})` is NOT a valid
// deny — when video was requested, Electron's DisplayMediaDeviceChosen throws
// "TypeError: Video was requested, but no video stream was provided" straight
// back into the handler (an unhandled rejection if the handler is async).
// This was exactly the Wayland crash seen on Fedora when the portal returned
// no sources.
function denyDisplayMediaRequest(callback, reason) {
    console.error(`[Lala] Screen share denied: ${reason}`);
    try {
        callback(null);
    } catch (err) {
        console.error('[Lala] Screen share: deny callback failed:', err.message);
    }
}

function setupScreenShareHandler() {
    // Note: setDisplayMediaRequestHandler's { useSystemPicker: true } option
    // would let Chromium drive the picker natively, but in Electron 40 it is
    // macOS 15+ only (experimental) — see DisplayMediaRequestHandlerOpts in
    // electron.d.ts. On Linux/Wayland the desktopCapturer→portal dance below
    // remains the only supported path.
    if (IS_WAYLAND) {
        // On Wayland, desktopCapturer.getSources() triggers the XDG desktop portal
        // (PipeWire) which shows the native screen/window picker. We must still
        // register setDisplayMediaRequestHandler — without it Electron denies
        // getDisplayMedia() entirely. Inside the handler we call getSources()
        // to invoke the portal, then pass the user-selected source to the callback.
        console.log('[Lala] Wayland detected — using XDG portal for screen share');
        session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
            const denyReason = getDisplayCaptureDenyReason(request);
            if (denyReason) {
                denyDisplayMediaRequest(callback, `${denyReason} (Wayland)`);
                return;
            }
            // Once the callback has been invoked, Electron has consumed the
            // request — never call it a second time from the catch block.
            let calledBack = false;
            try {
                console.log('[Lala] Screen share (Wayland): requesting sources via portal');
                // Only ['screen']: under the portal, PipeWire exposes a single
                // capture stream and the portal dialog itself lets the user pick
                // either a monitor or a window regardless of the types we pass.
                // Requesting ['screen', 'window'] just re-labels the result as a
                // window capture and is flakier on some portal backends.
                const sources = await desktopCapturer.getSources({ types: ['screen'] });
                if (Array.isArray(sources) && sources.length > 0 && sources[0].id) {
                    // The portal returns only the user-selected source
                    console.log('[Lala] Screen share (Wayland): got source', sources[0].id);
                    calledBack = true;
                    callback({ video: sources[0] });
                } else {
                    // getSources() resolved but gave us nothing: the user cancelled
                    // the portal dialog, or xdg-desktop-portal / its desktop backend
                    // / PipeWire is missing or broken (portal resolves empty instead
                    // of rejecting in that case).
                    denyDisplayMediaRequest(callback,
                        'portal returned no sources (dialog cancelled, or xdg-desktop-portal/PipeWire missing/broken)');
                }
            } catch (err) {
                if (calledBack) {
                    // callback() itself threw — Electron already failed the request
                    // internally; calling it again would throw "called twice".
                    console.error('[Lala] Screen share (Wayland): Electron rejected the stream response:', err.message);
                } else {
                    denyDisplayMediaRequest(callback, `portal error: ${err.message}`);
                }
            }
        });
        return;
    }

    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        const denyReason = getDisplayCaptureDenyReason(request);
        if (denyReason) {
            denyDisplayMediaRequest(callback, denyReason);
            return;
        }
        if (pendingScreenShareSourceId) {
            const sourceId = pendingScreenShareSourceId;
            clearPendingScreenShare();
            const response = { video: { id: sourceId, name: sourceId } };
            // Only include audio when the renderer requested it.
            // 'loopbackWithoutChrome' captures system audio excluding this app's
            // own output — prevents echo where participants hear themselves back.
            // If this value fails on some systems, screen share video still works.
            if (request.audioRequested) {
                response.audio = 'loopbackWithoutChrome';
            }
            try {
                callback(response);
            } catch (err) {
                // Electron rejected the response shape — it has already failed
                // the request; just log so terminal output identifies the cause.
                console.error('[Lala] Screen share: Electron rejected the stream response:', err.message);
            }
        } else {
            denyDisplayMediaRequest(callback, 'no pre-selected source (picker not used or source timed out)');
        }
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

// ─── Helpers: RPM Install ─────────────────────────────────────────────────────

function detectCommand(commands) {
    const { execFileSync } = require('child_process');
    for (const cmd of commands) {
        try {
            execFileSync('which', [cmd], { stdio: 'ignore' });
            return cmd;
        } catch {}
    }
    return commands[0]; // fallback to first
}

// SECURITY (known accepted risk): --nogpgcheck / --allow-unsigned-rpm / plain
// `rpm -Uvh` below skip RPM signature verification entirely. Proper fix is to
// GPG-sign releases and ship/import a public key, which needs signing
// infrastructure we don't have yet. Accepted for now because installerPath
// always comes from electron-updater's own download of our GitHub Release
// asset (HTTPS, and electron-updater verifies the download's checksum from
// latest-linux.yml before this ever runs) — this isn't installing arbitrary
// attacker-supplied RPMs, just skipping the *GPG* signature check specifically.
function buildRpmInstallArgs(installerPath) {
    const pm = detectCommand(['dnf', 'zypper', 'yum', 'rpm']);
    switch (pm) {
        case 'dnf': return ['dnf', 'install', '--nogpgcheck', '-y', installerPath];
        case 'zypper': return ['zypper', '--non-interactive', '--no-refresh', 'install', '--allow-unsigned-rpm', '-f', installerPath];
        case 'yum': return ['yum', 'install', '--nogpgcheck', '-y', installerPath];
        default: return ['rpm', '-Uvh', '--replacepkgs', '--replacefiles', '--nodeps', installerPath];
    }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

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
        const mod = endpoint.startsWith('https') ? require('https') : require('http');
        const start = Date.now();
        return new Promise(resolve => {
            const req = mod.get(endpoint, { timeout: 5000 }, (res) => {
                res.resume(); // drain response
                resolve(res.statusCode >= 200 && res.statusCode < 300 ? Date.now() - start : null);
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        });
    });

    // Load a server URL (from connection page). File://-only: this is how a
    // server origin becomes trusted in the first place, so only the local
    // connection page — never an already-loaded remote page — may call it.
    ipcMain.on(IPC.LOAD_URL, (event, url) => {
        if (!isFileSender(event)) return;
        if (!mainWindow) return;
        if (!isUrlAllowed(url)) {
            sendToRenderer(IPC.LOAD_URL_ERROR, { message: 'Invalid URL protocol. Only HTTP(S) is allowed.' });
            return;
        }
        // isUrlAllowed() above already parsed the URL successfully, so this can't throw.
        trustedOrigin = new URL(url).origin;
        mainWindow.hide();  // Hide to prevent 502 flash
        mainWindow.loadURL(url).catch(err => {
            console.error('[Lala] Failed to load URL:', err.message);
            // Error recovery handled by did-fail-load event
        });
        // Safety: ensure window shows after 15s max
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
                mainWindow.show();
            }
        }, 15000);
    });

    // Get desktop sources for screen share picker. Trusted-origin-only: this
    // hands out desktop thumbnails (and window titles) without a native OS
    // prompt, so it must never be reachable from an untrusted page.
    ipcMain.handle(IPC.GET_DESKTOP_SOURCES, async (event) => {
        if (!isTrustedSender(event)) return [];
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

    // Pre-select screen share source (called before getDisplayMedia). Same
    // trust requirement as GET_DESKTOP_SOURCES — it feeds directly into
    // setDisplayMediaRequestHandler's response.
    ipcMain.handle(IPC.SET_SCREEN_SHARE_SOURCE, (event, id) => {
        if (!isTrustedSender(event)) return false;
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
            const safe = typeof suffix === 'string' ? suffix.slice(0, 200) : '';
            mainWindow.setTitle(safe ? `Lala — ${safe}` : 'Lala');
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
        if (INSTALL_CHANNEL === 'system-package') {
            sendToRenderer(IPC.UPDATE_STATUS, { status: 'package-manager' });
            return null;
        }
        return autoUpdater.checkForUpdates().catch(() => null);
    });

    ipcMain.on(IPC.INSTALL_UPDATE, (event) => {
        if (!isFileOrTrustedSender(event)) return;
        const installerPath = autoUpdater.installerPath;

        // On Linux RPM: run pkexec async (non-blocking) while the app stays alive.
        // electron-updater's built-in quitAndInstall() uses spawnSync which freezes the
        // event loop while pkexec shows its password dialog. Using async execFile keeps
        // the app responsive. Linux allows replacing files in use (Unix inode semantics),
        // so dnf can install while the app is running — then we relaunch.
        if (IS_LINUX && installerPath && installerPath.endsWith('.rpm')) {
            sendToRenderer(IPC.UPDATE_STATUS, { status: 'installing' });
            const sudo = detectCommand(['pkexec', 'kdesudo', 'gksudo', 'sudo']);
            const args = buildRpmInstallArgs(installerPath);

            execFile(sudo, args, (error) => {
                if (error) {
                    // RPM %postun scriptlet failures (e.g. update-alternatives) can cause
                    // dnf to report a failed transaction even though the new package was
                    // installed successfully. Check the installed version before giving up.
                    try {
                        const { execFileSync } = require('child_process');
                        const installed = execFileSync('rpm', ['-q', '--qf', '%{VERSION}', 'lala-desktop'], { encoding: 'utf8' }).trim();
                        const expected = path.basename(installerPath).match(/(\d+\.\d+\.\d+)/)?.[1];
                        if (expected && installed === expected) {
                            app.relaunch();
                            app.exit(0);
                            return;
                        }
                    } catch {}

                    sendToRenderer(IPC.UPDATE_STATUS, {
                        status: 'error',
                        error: `${error.message}\n\nLala ${app.getVersion()} / ${process.platform} ${process.arch}`,
                    });
                    return;
                }
                app.relaunch();
                app.exit(0);
            });
            return;
        }

        isQuitting = true;
        autoUpdater.quitAndInstall(true, true);
    });

    // Badge count for unread messages
    ipcMain.on(IPC.SET_BADGE_COUNT, (event, count) => {
        if (!isFileOrTrustedSender(event)) return;
        if (typeof count !== 'number' || !Number.isFinite(count)) return;
        count = Math.max(0, Math.floor(count));
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
        if (inCall && powerSaveBlockerId === null) {
            powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
        } else if (!inCall && powerSaveBlockerId !== null) {
            powerSaveBlocker.stop(powerSaveBlockerId);
            powerSaveBlockerId = null;
        }
    });
}

// ─── Auto-Updater ───────────────────────────────────────────────────────────

function setupAutoUpdater() {
    // Files owned by the distro package manager — electron-updater must not
    // touch them or even phone home. Updates come via dnf; the manual check
    // in Settings gets a dedicated 'package-manager' status instead.
    if (INSTALL_CHANNEL === 'system-package') return;

    autoUpdater.autoDownload = false;
    // Installing must always be an explicit user action (INSTALL_UPDATE IPC,
    // gated to the connection page / trusted server origin above) — never
    // silently on quit. A downloaded update just sits there until the user
    // clicks "Update" in Settings.
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.disableWebInstaller = true;
    // Never silently install an older version than what's running.
    autoUpdater.allowDowngrade = false;

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
        if (err.statusCode === 404 || (err.message && err.message.includes('404'))) {
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

function setupCrashHandling() {
    // Write running lock. Not currently read back by anything (no crash-based
    // session-restore flow is wired up — see saveSession()/loadSession() note
    // below); left in place as a cheap unclean-shutdown marker on disk.
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

    // Async errors that escape every try/catch (e.g. a throw inside an async
    // Electron handler) surface here instead of as a bare
    // UnhandledPromiseRejectionWarning with no [Lala] context.
    process.on('unhandledRejection', (reason) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(CRASH_LOG_DIR, `rejection-${timestamp}.log`);
        const detail = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
        try {
            fs.writeFileSync(logPath, `Unhandled Rejection: ${detail}\n`);
        } catch { /* ignore write errors */ }
        console.error('[Lala] Unhandled rejection:', reason);
    });

    app.on('render-process-gone', (_event, _webContents, details) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(CRASH_LOG_DIR, `render-crash-${timestamp}.log`);
        try {
            fs.writeFileSync(logPath, `Render process gone: ${JSON.stringify(details)}\n`);
        } catch { /* ignore write errors */ }
        console.error('[Lala] Render process gone:', details.reason);
    });

    cleanupOldCrashLogs();
}

function cleanupOldCrashLogs() {
    try {
        const files = fs.readdirSync(CRASH_LOG_DIR);
        const now = Date.now();
        const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
        for (const file of files) {
            const filePath = path.join(CRASH_LOG_DIR, file);
            try {
                const stat = fs.statSync(filePath);
                if (now - stat.mtimeMs > MAX_AGE) fs.unlinkSync(filePath);
            } catch {}
        }
    } catch {}
}

function cleanupRunningLock() {
    try {
        if (fs.existsSync(RUNNING_LOCK)) fs.unlinkSync(RUNNING_LOCK);
    } catch { /* ignore */ }
}

// Writes the renderer's session snapshot (server + room) to disk. Nothing in
// main.js currently reads SESSION_FILE back — there's no crash/restart
// session-restore flow wired up despite this being written on every room
// join. Kept as-is (low cost, and a restore feature may consume it later);
// a previous `loadSession()` that was dead code (defined, never called) has
// been removed. See packages/desktop/CLAUDE.md.
function saveSession(data) {
    try {
        fs.writeFileSync(SESSION_FILE, JSON.stringify({ ...data, timestamp: Date.now() }));
    } catch { /* ignore */ }
}

function clearSession() {
    try {
        if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
    } catch { /* ignore */ }
}

// ─── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
    ensureIconsExtracted();
    removeStaleDesktopOverride();
    setupCrashHandling();
    registerIpcHandlers();
    createWindow();
    setupScreenShareHandler();
    setupDownloadHandler();

    // Restrict permissions — only allow what a voice/video chat app needs, and
    // only for the currently trusted server origin. The local file://
    // connection page needs none of these and is denied by
    // isWebContentsOriginTrusted() (it never matches trustedOrigin).
    const ALLOWED_PERMISSIONS = ['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'display-capture'];

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(ALLOWED_PERMISSIONS.includes(permission) && isWebContentsOriginTrusted(webContents));
    });

    // Synchronous counterpart — required for APIs like enumerateDevices() that
    // check permission state directly instead of going through a request/
    // callback flow, which would otherwise bypass the handler above entirely.
    session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
        if (!ALLOWED_PERMISSIONS.includes(permission) || trustedOrigin === null) return false;
        // requestingOrigin is a full URL (usually with a trailing slash), not a
        // bare origin — normalize before comparing or every check is denied.
        try {
            return new URL(requestingOrigin).origin === trustedOrigin;
        } catch {
            return false;
        }
    });

    createTray();
    setupAutoUpdater();

    // Apply saved icon preference (also writes the fixed .ico on Windows for next launch)
    const savedIcon = getIconPreference();
    applyIcon(savedIcon);

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
