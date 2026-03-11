'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ─── IPC Channel Names (must match main.js) ─────────────────────────────────
const IPC = {
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
    NAVIGATE_BACK: 'lala:navigate-back',
    LOAD_URL_ERROR: 'lala:load-url-error',
    UPDATE_STATUS: 'lala:update-status',
};

// ─── Exposed API ─────────────────────────────────────────────────────────────
// Strict contextBridge: only expose what the renderer needs, no raw ipc access.

contextBridge.exposeInMainWorld('electronAPI', {
    /** Navigate the window to a server URL */
    loadUrl: (url) => ipcRenderer.send(IPC.LOAD_URL, url),

    /** Get list of capturable desktop sources with thumbnails */
    getDesktopSources: () => ipcRenderer.invoke(IPC.GET_DESKTOP_SOURCES),

    /** Pre-select a desktop source before getDisplayMedia fires */
    setScreenShareSource: (id) => ipcRenderer.invoke(IPC.SET_SCREEN_SHARE_SOURCE, id),

    /** Get app version and platform info */
    getAppInfo: () => ipcRenderer.invoke(IPC.GET_APP_INFO),

    /** Update window title (e.g. with room name) */
    setTitleSuffix: (suffix) => ipcRenderer.send(IPC.SET_TITLE_SUFFIX, suffix),

    /** Show / focus the main window */
    showWindow: () => ipcRenderer.send(IPC.SHOW_WINDOW),

    /** Subscribe to URL load errors */
    onLoadUrlError: (callback) => {
        const handler = (_event, error) => callback(error);
        ipcRenderer.on(IPC.LOAD_URL_ERROR, handler);
        return () => ipcRenderer.removeListener(IPC.LOAD_URL_ERROR, handler);
    },

    /** Subscribe to back navigation request */
    onNavigateBack: (callback) => {
        const handler = () => callback();
        ipcRenderer.on(IPC.NAVIGATE_BACK, handler);
        return () => ipcRenderer.removeListener(IPC.NAVIGATE_BACK, handler);
    },

    /** Check for updates */
    checkForUpdate: () => ipcRenderer.invoke(IPC.CHECK_UPDATE),

    /** Install downloaded update and restart */
    installUpdate: () => ipcRenderer.send(IPC.INSTALL_UPDATE),

    /** Subscribe to update status events */
    onUpdateStatus: (callback) => {
        const handler = (_event, status) => callback(status);
        ipcRenderer.on(IPC.UPDATE_STATUS, handler);
        return () => ipcRenderer.removeListener(IPC.UPDATE_STATUS, handler);
    },

    /** Set unread badge count (tray + taskbar) */
    setBadgeCount: (count) => ipcRenderer.send(IPC.SET_BADGE_COUNT, count),

    /** Get auto-launch status */
    getAutoLaunch: () => ipcRenderer.invoke(IPC.GET_AUTO_LAUNCH),

    /** Set auto-launch on system startup */
    setAutoLaunch: (enabled) => ipcRenderer.invoke(IPC.SET_AUTO_LAUNCH, enabled),

    /** Save session state for crash recovery */
    saveSession: (data) => ipcRenderer.send(IPC.SAVE_SESSION, data),

    /** Notify main process about call state (for power save blocker) */
    setInCall: (inCall) => ipcRenderer.send(IPC.SET_IN_CALL, !!inCall),

    /** Get current app icon variant name */
    getAppIcon: () => ipcRenderer.invoke(IPC.GET_APP_ICON),

    /** Set app icon variant (saves preference, updates tray) */
    setAppIcon: (name) => ipcRenderer.invoke(IPC.SET_APP_ICON, name),

    /** Navigate back to the connection page (server switching) */
    navigateBack: () => ipcRenderer.send(IPC.NAVIGATE_BACK),

    /** Relaunch the app (used after icon change to apply window icon) */
    relaunch: () => ipcRenderer.send(IPC.RELAUNCH),

    /** Check if running in Electron */
    isElectron: true,
});
