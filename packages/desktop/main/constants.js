'use strict';

const { app } = require('electron');

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

const USER_DATA = app.getPath('userData');

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

module.exports = { IS_MAC, IS_LINUX, IS_WAYLAND, HAS_SYSTEM_TRAY, INSTALL_CHANNEL, USER_DATA, IPC };
