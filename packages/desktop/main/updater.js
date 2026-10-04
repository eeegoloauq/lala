'use strict';

const { app, ipcMain } = require('electron');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { autoUpdater } = require('electron-updater');
const { IS_LINUX, INSTALL_CHANNEL, IPC } = require('./constants');
const { state, sendToRenderer } = require('./state');
const { isFileOrTrustedSender } = require('./trust');

function detectCommand(commands) {
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

function setupAutoUpdater() {
    // Files owned by the distro package manager — electron-updater must not
    // touch them or even phone home. Updates come via dnf; the manual check
    // in Settings gets a dedicated 'package-manager' status instead.
    if (INSTALL_CHANNEL === 'system-package') return;

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

        state.isQuitting = true;
        autoUpdater.quitAndInstall(true, true);
    });
}

module.exports = { setupAutoUpdater, registerUpdaterIpc };
