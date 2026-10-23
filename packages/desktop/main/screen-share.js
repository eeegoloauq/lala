'use strict';

const { ipcMain, session, desktopCapturer } = require('electron');
const { IS_WAYLAND, IPC } = require('./constants');
const { state } = require('./state');
const { isTrustedSender, isTrustedUrl } = require('./trust');

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
 * Gate for setDisplayMediaRequestHandler: only the top-level frame of the trusted
 * server page may capture the screen, never an embedded frame or the connection page.
 * Returns null when the request is trusted, otherwise a reason for the log.
 */
function getDisplayCaptureDenyReason(request) {
    const mainWindow = state.mainWindow;
    if (!mainWindow || mainWindow.isDestroyed()) return 'no window';
    if (request.frame && request.frame !== mainWindow.webContents.mainFrame) {
        return `sub-frame capture request (frame url: ${request.frame.url})`;
    }
    const requesting = request.securityOrigin || request.frame?.url || '';
    if (!isTrustedUrl(requesting)) {
        return `untrusted origin (requesting: ${requesting || '<unknown>'}, trusted: ${state.trustedOrigin ?? '<none>'})`;
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

// System audio is captured independently of the video source, so X11, Wayland
// and Windows/macOS share one path. The renderer asks for restrictOwnAudio,
// which makes Electron capture 'loopback' without this app's own output where
// Chromium supports it (Windows, macOS). Linux has no such mode: the capture
// is the default output's monitor and includes the other participants' voices.
function withSystemAudio(request, response) {
    if (request.audioRequested) response.audio = 'loopback';
    return response;
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
                    callback(withSystemAudio(request, { video: sources[0] }));
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
            const response = withSystemAudio(request, { video: { id: sourceId, name: sourceId } });
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
            // Sharing our own window would show the call inside itself.
            const ownWindow = state.mainWindow?.getMediaSourceId();
            return sources
                .filter(source => source.id !== ownWindow)
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
