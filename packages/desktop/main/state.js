'use strict';

// Main-process state the modules share. There is one window for the whole app.
const state = {
    /** @type {import('electron').BrowserWindow | null} */
    mainWindow: null,

    /** @type {import('electron').Tray | null} */
    tray: null,

    // Origin of the currently-connected server, set when LOAD_URL loads a server
    // URL and cleared whenever we navigate back to the local connection page.
    // This is the trust boundary for the electronAPI bridge, WebRTC permissions,
    // and screen capture — the local file:// connection page and this origin are
    // the only two contexts allowed to use them. See main/trust.js.
    /** @type {string | null} */
    trustedOrigin: null,

    isQuitting: false,

    /** @type {number | null} */
    powerSaveBlockerId: null,
};

function sendToRenderer(channel, ...args) {
    const win = state.mainWindow;
    if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send(channel, ...args);
    }
}

module.exports = { state, sendToRenderer };
