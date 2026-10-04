'use strict';

// Main process entry: Chromium switches that must precede app ready, the single
// instance lock, and startup wiring. The work lives in main/.

const { app } = require('electron');

// ─── App User Model ID (Windows) ────────────────────────────────────────────
// Must match appId in electron-builder.yml. Set before app is ready so Windows
// associates the process with the correct NSIS shortcut — fixes taskbar icon
// grouping, pinned icon display, and Task Manager icon.
app.setAppUserModelId('app.lala.desktop');

// ─── Platform Flags ──────────────────────────────────────────────────────────
// Wayland screen capture (PipeWire) — must be set before app is ready.
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
// Chromium only honors the *last* --disable-features switch on the command
// line — repeated appendSwitch('disable-features', ...) calls don't merge,
// the later one wins and silently drops the earlier features. So every
// disable-features flag we need lives in this single comma-separated call:
//  - AudioServiceOutOfProcess: merge audio service into the renderer process —
//    prevents duplicate entries in the Windows volume mixer (Chromium spawns a
//    separate audio utility process that gets its own mixer entry with the
//    baked-in .exe icon).
//  - ChromeWideEchoCancellation: when an echoCancellation:true capture starts,
//    this feature makes the audio service stop and reopen ALL of Chrome's
//    currently-playing output streams as one mixed stream, then switch back
//    ~1s after the last AEC capture stops (OutputDeviceMixerImpl::
//    StartListening) — on Linux/PipeWire that close/reopen is audible as a
//    harsh glitch in whatever's playing (see packages/web's RoomView.tsx
//    audioOptions comment for the full writeup and the web-side mitigations).
//    Lala is a single-window voice app, so the renderer-local APM already
//    cancels our own playout without needing the audio-service-wide reroute —
//    disabling it here removes the glitch at the source for the desktop client.
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess,ChromeWideEchoCancellation');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const { IS_MAC } = require('./main/constants');
const { state } = require('./main/state');
const { setupPermissionHandlers } = require('./main/trust');
const { ensureIconsExtracted, removeStaleDesktopOverride, getIconPreference, applyIcon } = require('./main/icons');
const { createWindow, saveWindowState, setupDownloadHandler } = require('./main/window');
const { createTray, clearBadge } = require('./main/tray');
const { setupScreenShareHandler, registerScreenShareIpc, clearPendingScreenShare } = require('./main/screen-share');
const { setupAutoUpdater, registerUpdaterIpc } = require('./main/updater');
const { setupCrashHandling, cleanupRunningLock } = require('./main/crash');
const { registerIpcHandlers } = require('./main/ipc');

// ─── Single Instance Lock ────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

// ─── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
    ensureIconsExtracted();
    removeStaleDesktopOverride();
    setupCrashHandling();
    registerIpcHandlers();
    registerScreenShareIpc();
    registerUpdaterIpc();
    createWindow();
    setupScreenShareHandler();
    setupDownloadHandler();
    setupPermissionHandlers();
    createTray();
    setupAutoUpdater();

    // Apply saved icon preference (also writes the fixed .ico on Windows for next launch)
    applyIcon(getIconPreference());

    state.mainWindow?.on('focus', clearBadge);

    // macOS: re-create window on dock click
    app.on('activate', () => {
        if (!state.mainWindow) {
            createWindow();
        } else {
            state.mainWindow.show();
            state.mainWindow.focus();
        }
    });
});

// Second instance handling (single instance lock)
app.on('second-instance', () => {
    const win = state.mainWindow;
    if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
    }
});

app.on('before-quit', () => {
    state.isQuitting = true;
    if (state.mainWindow) saveWindowState(state.mainWindow);
    clearPendingScreenShare();
    cleanupRunningLock();
});

app.on('window-all-closed', () => {
    if (!IS_MAC) {
        app.quit();
    }
});
