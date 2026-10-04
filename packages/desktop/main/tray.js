'use strict';

const { app, Tray, Menu } = require('electron');
const { IS_MAC, IS_LINUX } = require('./constants');
const { state } = require('./state');
const { getTrayIcon } = require('./icons');
const { navigateToConnectionPage } = require('./window');

function createTray() {
    const icon = getTrayIcon();
    if (!icon) {
        console.warn('[Lala] No tray icon found — tray disabled');
        return;
    }

    const tray = new Tray(icon);
    state.tray = tray;
    tray.setToolTip('Lala');

    const locale = app.getLocale();
    const isRu = locale.startsWith('ru');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: isRu ? 'Сменить сервер' : 'Change server',
            click: () => {
                const win = state.mainWindow;
                if (!win || win.isDestroyed()) return;
                navigateToConnectionPage();
                win.show();
            },
        },
        { type: 'separator' },
        {
            label: isRu ? 'Выход' : 'Quit',
            click: () => {
                state.isQuitting = true;
                app.quit();
            },
        },
    ]);

    tray.setContextMenu(contextMenu);

    // Click on tray icon shows/focuses the window
    tray.on('click', () => {
        const win = state.mainWindow;
        if (!win) return;
        if (win.isVisible()) {
            win.focus();
        } else {
            win.show();
            win.focus();
        }
    });

    // Double-click (Windows)
    tray.on('double-click', () => {
        const win = state.mainWindow;
        if (win) {
            win.show();
            win.focus();
        }
    });
}

/** Unread count on the taskbar, dock and tray tooltip. */
function setBadgeCount(count) {
    const { mainWindow, tray } = state;
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
}

function clearBadge() {
    if (process.platform === 'win32') state.mainWindow?.flashFrame(false);
    if (IS_MAC && app.dock) app.dock.setBadge('');
    if (IS_LINUX) app.setBadgeCount(0);
    if (state.tray) state.tray.setToolTip('Lala');
}

module.exports = { createTray, setBadgeCount, clearBadge };
