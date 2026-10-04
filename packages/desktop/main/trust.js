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

    if (frame.url.startsWith('file://')) {
        return { isFileTop: true, isTrustedTop: false };
    }
    try {
        const origin = new URL(frame.url).origin;
        return { isFileTop: false, isTrustedTop: state.trustedOrigin !== null && origin === state.trustedOrigin };
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
    if (!webContents || webContents.isDestroyed() || state.trustedOrigin === null) return false;
    try {
        return new URL(webContents.getURL()).origin === state.trustedOrigin;
    } catch {
        return false;
    }
}

// Restrict permissions — only allow what a voice/video chat app needs, and
// only for the currently trusted server origin. The local file://
// connection page needs none of these and is denied by
// isWebContentsOriginTrusted() (it never matches trustedOrigin).
function setupPermissionHandlers() {
    const ALLOWED_PERMISSIONS = ['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'display-capture'];

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(ALLOWED_PERMISSIONS.includes(permission) && isWebContentsOriginTrusted(webContents));
    });

    // Synchronous counterpart — required for APIs like enumerateDevices() that
    // check permission state directly instead of going through a request/
    // callback flow, which would otherwise bypass the handler above entirely.
    session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
        if (!ALLOWED_PERMISSIONS.includes(permission) || state.trustedOrigin === null) return false;
        // requestingOrigin is a full URL (usually with a trailing slash), not a
        // bare origin — normalize before comparing or every check is denied.
        try {
            return new URL(requestingOrigin).origin === state.trustedOrigin;
        } catch {
            return false;
        }
    });
}

module.exports = {
    ALLOWED_URL_PROTOCOLS,
    isUrlAllowed,
    isIndexHtmlUrl,
    isFileSender,
    isTrustedSender,
    isFileOrTrustedSender,
    setupPermissionHandlers,
};
