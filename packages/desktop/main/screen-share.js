'use strict';

const { ipcMain, session, desktopCapturer } = require('electron');
const { IS_WAYLAND, IPC } = require('./constants');
const { state } = require('./state');
const { ALLOWED_URL_PROTOCOLS, isTrustedSender } = require('./trust');

const THUMBNAIL_SIZE = { width: 320, height: 180 };
const SCREEN_SHARE_SOURCE_TIMEOUT_MS = 30_000;

/** @type {string | null} */
let pendingScreenShareSourceId = null;

/** @type {ReturnType<typeof setTimeout> | null} */
let screenShareSourceTimer = null;

function clearPendingScreenShare() {
    pendingScreenShareSourceId = null;
    if (screenShareSourceTimer) {
        clearTimeout(screenShareSourceTimer);
        screenShareSourceTimer = null;
    }
}

/**
 * Gate for setDisplayMediaRequestHandler: only the top-level frame of the
 * page the window is currently displaying may capture the screen. Silent
 * screen capture from a third-party frame/origin (e.g. an embedded iframe)
 * is exactly the vector this closes.
 *
 * Trust is derived from mainWindow.webContents.getURL() at request time:
 * the will-navigate lock already guarantees that URL is either our local
 * file:// connection page or the server the user picked, so a capture
 * request coming from the window's own loaded page is exactly as trusted
 * as the page itself. We deliberately do NOT compare against a separately
 * maintained value (the old check against `trustedOrigin` broke because
 * Electron's request.securityOrigin is a Chromium-serialized URL with a
 * trailing slash — "https://host/" — which never string-equals a bare
 * URL.origin, so every request was denied).
 *
 * Returns null when the request is trusted, otherwise a deny reason that
 * names both the requesting and the expected origin so reports are
 * self-diagnosing.
 */
function getDisplayCaptureDenyReason(request) {
    const mainWindow = state.mainWindow;
    if (!mainWindow || mainWindow.isDestroyed()) return 'no window';

    // Only the top-level frame may capture — never a sub-frame/iframe.
    if (request.frame && request.frame !== mainWindow.webContents.mainFrame) {
        return `sub-frame capture request (frame url: ${request.frame.url})`;
    }

    // Expected origin = whatever page the window itself is showing. The
    // file:// connection page (or an empty window) never captures.
    let expectedOrigin;
    const currentUrl = mainWindow.webContents.getURL();
    try {
        const parsed = new URL(currentUrl);
        if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
            return `window is not showing a server page (current url: ${currentUrl || '<none>'})`;
        }
        expectedOrigin = parsed.origin;
    } catch {
        return `window url is unparseable (current url: ${currentUrl || '<none>'})`;
    }

    // request.securityOrigin is a serialized URL (usually with a trailing
    // slash), not a bare origin — normalize via new URL().origin before
    // comparing, same as the permission check handler does.
    const rawRequesting = request.securityOrigin || (request.frame && request.frame.url) || '';
    let requestingOrigin;
    try {
        requestingOrigin = new URL(rawRequesting).origin;
    } catch {
        requestingOrigin = rawRequesting || '<unknown>';
    }
    if (requestingOrigin !== expectedOrigin) {
        return `untrusted origin (requesting: ${requestingOrigin}, expected: ${expectedOrigin})`;
    }
    return null;
}

// Deny a display-media request the way Electron actually supports: only
// `callback(null)` (or undefined) makes it respond CAPTURE_FAILURE so the
// renderer's getDisplayMedia() rejects cleanly. `callback({})` is NOT a valid
// deny — when video was requested, Electron's DisplayMediaDeviceChosen throws
// "TypeError: Video was requested, but no video stream was provided" straight
// back into the handler (an unhandled rejection if the handler is async).
// This was exactly the Wayland crash seen on Fedora when the portal returned
// no sources.
function denyDisplayMediaRequest(callback, reason) {
    console.error(`[Lala] Screen share denied: ${reason}`);
    try {
        callback(null);
    } catch (err) {
        console.error('[Lala] Screen share: deny callback failed:', err.message);
    }
}

function setupScreenShareHandler() {
    // Note: setDisplayMediaRequestHandler's { useSystemPicker: true } option
    // would let Chromium drive the picker natively, but in Electron 40 it is
    // macOS 15+ only (experimental) — see DisplayMediaRequestHandlerOpts in
    // electron.d.ts. On Linux/Wayland the desktopCapturer→portal dance below
    // remains the only supported path.
    if (IS_WAYLAND) {
        // On Wayland, desktopCapturer.getSources() triggers the XDG desktop portal
        // (PipeWire) which shows the native screen/window picker. We must still
        // register setDisplayMediaRequestHandler — without it Electron denies
        // getDisplayMedia() entirely. Inside the handler we call getSources()
        // to invoke the portal, then pass the user-selected source to the callback.
        console.log('[Lala] Wayland detected — using XDG portal for screen share');
        session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
            const denyReason = getDisplayCaptureDenyReason(request);
            if (denyReason) {
                denyDisplayMediaRequest(callback, `${denyReason} (Wayland)`);
                return;
            }
            // Once the callback has been invoked, Electron has consumed the
            // request — never call it a second time from the catch block.
            let calledBack = false;
            try {
                console.log('[Lala] Screen share (Wayland): requesting sources via portal');
                // Only ['screen']: under the portal, PipeWire exposes a single
                // capture stream and the portal dialog itself lets the user pick
                // either a monitor or a window regardless of the types we pass.
                // Requesting ['screen', 'window'] just re-labels the result as a
                // window capture and is flakier on some portal backends.
                const sources = await desktopCapturer.getSources({ types: ['screen'] });
                if (Array.isArray(sources) && sources.length > 0 && sources[0].id) {
                    // The portal returns only the user-selected source
                    console.log('[Lala] Screen share (Wayland): got source', sources[0].id);
                    calledBack = true;
                    callback({ video: sources[0] });
                } else {
                    // getSources() resolved but gave us nothing: the user cancelled
                    // the portal dialog, or xdg-desktop-portal / its desktop backend
                    // / PipeWire is missing or broken (portal resolves empty instead
                    // of rejecting in that case).
                    denyDisplayMediaRequest(callback,
                        'portal returned no sources (dialog cancelled, or xdg-desktop-portal/PipeWire missing/broken)');
                }
            } catch (err) {
                if (calledBack) {
                    // callback() itself threw — Electron already failed the request
                    // internally; calling it again would throw "called twice".
                    console.error('[Lala] Screen share (Wayland): Electron rejected the stream response:', err.message);
                } else {
                    denyDisplayMediaRequest(callback, `portal error: ${err.message}`);
                }
            }
        });
        return;
    }

    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        const denyReason = getDisplayCaptureDenyReason(request);
        if (denyReason) {
            denyDisplayMediaRequest(callback, denyReason);
            return;
        }
        if (pendingScreenShareSourceId) {
            const sourceId = pendingScreenShareSourceId;
            clearPendingScreenShare();
            const response = { video: { id: sourceId, name: sourceId } };
            // Only include audio when the renderer requested it.
            // 'loopbackWithoutChrome' captures system audio excluding this app's
            // own output — prevents echo where participants hear themselves back.
            // If this value fails on some systems, screen share video still works.
            if (request.audioRequested) {
                response.audio = 'loopbackWithoutChrome';
            }
            try {
                callback(response);
            } catch (err) {
                // Electron rejected the response shape — it has already failed
                // the request; just log so terminal output identifies the cause.
                console.error('[Lala] Screen share: Electron rejected the stream response:', err.message);
            }
        } else {
            denyDisplayMediaRequest(callback, 'no pre-selected source (picker not used or source timed out)');
        }
    });
}

function registerScreenShareIpc() {
    // Get desktop sources for screen share picker. Trusted-origin-only: this
    // hands out desktop thumbnails (and window titles) without a native OS
    // prompt, so it must never be reachable from an untrusted page.
    ipcMain.handle(IPC.GET_DESKTOP_SOURCES, async (event) => {
        if (!isTrustedSender(event)) return [];
        try {
            const sources = await desktopCapturer.getSources({
                types: ['screen', 'window'],
                thumbnailSize: THUMBNAIL_SIZE,
                fetchWindowIcons: true,
            });
            // Filter out the Lala window itself
            const lalaTitle = state.mainWindow?.getTitle() || '';
            return sources
                .filter(source => source.name !== lalaTitle)
                .map(source => ({
                    id: source.id,
                    name: source.name,
                    thumbnail: `data:image/jpeg;base64,${source.thumbnail.toJPEG(70).toString('base64')}`,
                    appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
                    displayId: source.display_id,
                }));
        } catch (err) {
            console.error('[Lala] Error getting desktop sources:', err.message);
            return [];
        }
    });

    // Pre-select screen share source (called before getDisplayMedia). Same
    // trust requirement as GET_DESKTOP_SOURCES — it feeds directly into
    // setDisplayMediaRequestHandler's response.
    ipcMain.handle(IPC.SET_SCREEN_SHARE_SOURCE, (event, id) => {
        if (!isTrustedSender(event)) return false;
        clearPendingScreenShare();
        pendingScreenShareSourceId = id;

        // Auto-clear after timeout to prevent stale state
        screenShareSourceTimer = setTimeout(() => {
            if (pendingScreenShareSourceId === id) {
                console.warn('[Lala] Screen share source timed out:', id);
                pendingScreenShareSourceId = null;
            }
            screenShareSourceTimer = null;
        }, SCREEN_SHARE_SOURCE_TIMEOUT_MS);

        return true;
    });
}

module.exports = { setupScreenShareHandler, registerScreenShareIpc, clearPendingScreenShare };
