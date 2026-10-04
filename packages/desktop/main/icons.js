'use strict';

// Extract icon files from asar to userData on startup. This avoids relying on
// app.asar.unpacked which NSIS silent updates can fail to properly recreate.
// Electron's patched fs reads from asar transparently; we write to real disk.

const { app, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { IS_MAC, IS_LINUX, INSTALL_CHANNEL, USER_DATA } = require('./constants');
const { state } = require('./state');

const APP_DIR = path.join(__dirname, '..');
const ICON_VARIANTS = ['voice-wave', 'dark-sphere', 'single-wave', 'double-wave'];
const ICONS_DIR = path.join(USER_DATA, 'icons');
const ICON_PREF_FILE = path.join(USER_DATA, 'icon-preference.json');
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
    const asarBase = path.join(APP_DIR, 'build', 'icon-variants');
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
    const traySrc = path.join(APP_DIR, 'build', 'tray');
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
    const { tray, mainWindow } = state;
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
        const fixedIco = path.join(USER_DATA, 'app-icon.ico');
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

// ─── Window and Tray Icons ───────────────────────────────────────────────────

function getInitialWindowIcon() {
    // Use saved icon variant for window creation (avoids flash of default icon)
    const variant = getIconPreference();
    const variantDir = getVariantIconPath(variant);

    // On Windows, prefer the fixed .ico in userData (written by applyIcon on previous run)
    if (process.platform === 'win32') {
        const fixedIco = path.join(USER_DATA, 'app-icon.ico');
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
    const fallbackPath = path.join(APP_DIR, 'build', 'icon.png');
    if (fs.existsSync(fallbackPath)) return nativeImage.createFromPath(fallbackPath);
    return undefined;
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
    const appIcon = path.join(APP_DIR, 'build', 'icon.png');
    if (fs.existsSync(appIcon)) {
        return nativeImage.createFromPath(appIcon).resize({ width: 32, height: 32 });
    }

    return null;
}

module.exports = {
    ICON_VARIANTS,
    ensureIconsExtracted,
    removeStaleDesktopOverride,
    getIconPreference,
    saveIconPreference,
    applyIcon,
    getInitialWindowIcon,
    getTrayIcon,
};
