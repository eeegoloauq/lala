'use strict';

const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { INSTALL_CHANNEL, IPC } = require('./constants');
const { state, sendToRenderer } = require('./state');
const { isFileOrTrustedSender } = require('./trust');

const RELEASES_URL = 'https://github.com/eeegoloauq/lala/releases/latest';

function setupAutoUpdater() {
    // A distro package updates through its package manager and a GitHub RPM or tarball
    // by hand; electron-updater must not touch either or even phone home. The check in
    // Settings says so instead (see CHECK_UPDATE).
    if (INSTALL_CHANNEL === 'system-package' || INSTALL_CHANNEL === 'manual') return;

    autoUpdater.autoDownload = false;
    // Installing must always be an explicit user action (INSTALL_UPDATE IPC,
    // gated to the connection page / trusted server origin below) — never
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

function registerUpdaterIpc() {
    ipcMain.handle(IPC.CHECK_UPDATE, () => {
        if (INSTALL_CHANNEL === 'system-package') {
            sendToRenderer(IPC.UPDATE_STATUS, { status: 'package-manager' });
            return null;
        }
        if (INSTALL_CHANNEL === 'manual') {
            sendToRenderer(IPC.UPDATE_STATUS, { status: 'manual', url: RELEASES_URL });
            return null;
        }
        return autoUpdater.checkForUpdates().catch(() => null);
    });

    ipcMain.on(IPC.INSTALL_UPDATE, (event) => {
        if (!isFileOrTrustedSender(event)) return;
        state.isQuitting = true;
        autoUpdater.quitAndInstall(true, true);
    });
}

module.exports = { setupAutoUpdater, registerUpdaterIpc };
