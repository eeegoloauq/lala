'use strict';

// The window can only ever be showing one of two trusted contexts: our local
// file:// connection page, or the remote origin the user picked (tracked in
// `state.trustedOrigin`). Everything below re-derives trust from the *current*
// state of the frame/webContents making the request — never from whether a
// navigation was merely allowed at some point in the past.

const { session } = require('electron');
const path = require('path');
const { state } = require('./state');

const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:']);
// Absolute path of our bundled connection page — used to make sure `file://`
// navigation is only ever permitted to this exact file, not arbitrary local paths.
const INDEX_HTML_PATH = path.join(__dirname, '..', 'index.html');

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

/** True if `url` (a page, frame or serialized origin, with or without a trailing slash) is on the trusted server origin. */
function isTrustedUrl(url) {
    if (state.trustedOrigin === null) return false;
    try {
        return new URL(url).origin === state.trustedOrigin;
    } catch {
        return false;
    }
}

function classifySender(event) {
    const frame = event.senderFrame;
    if (!frame || typeof frame.url !== 'string') {
        return { isFileTop: false, isTrustedTop: false };
    }
    // Only the top-level frame of our single window may use sensitive channels
    // — never an embedded sub-frame/iframe, even if same-origin.
    const win = state.mainWindow;
    const isTopFrame = !!win && !win.isDestroyed() && frame === win.webContents.mainFrame;
    if (!isTopFrame) return { isFileTop: false, isTrustedTop: false };

    return { isFileTop: frame.url.startsWith('file://'), isTrustedTop: isTrustedUrl(frame.url) };
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

// Only what a voice/video chat app needs, and only for the frame asking: an embedded
// frame from another origin gets nothing even while the page around it is trusted.
// The local file:// connection page needs none of these.
function setupPermissionHandlers() {
    const ALLOWED_PERMISSIONS = ['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'display-capture'];

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
        callback(ALLOWED_PERMISSIONS.includes(permission) && isTrustedUrl(details.requestingUrl));
    });

    // Synchronous counterpart — required for APIs like enumerateDevices() that
    // check permission state directly instead of going through a request/
    // callback flow, which would otherwise bypass the handler above entirely.
    session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
        return ALLOWED_PERMISSIONS.includes(permission) && isTrustedUrl(requestingOrigin);
    });
}

module.exports = {
    isUrlAllowed,
    isTrustedUrl,
    isIndexHtmlUrl,
    isFileSender,
    isTrustedSender,
    isFileOrTrustedSender,
    setupPermissionHandlers,
};
