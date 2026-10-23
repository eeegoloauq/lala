# Desktop Package (`packages/desktop`)

Electron 40+ desktop client wrapping the web app with native features.

## Key Files

- `main.js` -- main process entry: Chromium switches, single instance lock, startup wiring and app lifecycle
- `main/` -- the main process work, one module each: `constants` (platform flags, install channel, IPC names), `state` (the window, tray, trusted origin and other shared state), `trust` (URL and sender checks, permission handlers), `window` (window state, creation, error recovery, navigation lock, downloads), `tray` (tray and unread badges), `icons`, `screen-share`, `context-menu` (edit menu for text fields), `updater`, `crash` (crash logs), `ipc` (the remaining channels)
- `preload.js` -- contextBridge: `electronAPI` (screen share, update, badge, auto-launch, call state, icon, `navigateBack()`, `loadUrl()`, `pingServer()`)
- `index.html` -- connection page markup/styles only (CSP `script-src 'self'`, no inline JS)
- `connection.js` -- connection page logic: saved servers with editable labels, auto-connect, health check before `loadUrl()`, ping status dots. The check (`PING_SERVER` in `main/ipc.js`) uses `net.fetch`, so it shares the window's cookies, proxy and client certificates; any non-5xx answer counts as reachable
- `electron-builder.yml` -- Win NSIS x64, Linux AppImage/rpm/tar.gz, macOS dmg
- `build/icon-variants/` -- 4 SVG icon variants + generated PNGs

## Screen Share Flow
1. Button/hotkey -> `handleScreenShareToggle()` in RoomShell
2. ALWAYS shows `ScreenShareModal` (never skips in Electron)
3. Sources via `electronAPI.getDesktopSources()` -> `desktopCapturer.getSources()`
4. Skeleton loading -> Windows/Screens tabs with thumbnails (8s auto-refresh)
5. User picks source -> `setScreenShareSource(sourceId)` -> `setScreenShareEnabled(true)`
6. `setDisplayMediaRequestHandler` returns the source with `audio: 'loopback'`; the renderer's `restrictOwnAudio` makes Electron exclude our own output where Chromium can (Windows, macOS)
7. DTX and RED disabled for screen share audio

## Error Recovery
`loadServer()` in `main/window.js` hides the window and loads the server; `did-navigate` shows whatever page arrives. A load that never settles gets the window back after 15s (one timer, replaced on each connect).
- **`did-fail-load`** (main frame only) and **`did-navigate` 5xx** go back to `index.html?error=<message>`, which shows the message and skips auto-connect

## Server Switching
- `navigateBack()` IPC: loads `index.html`, stops power save blocker
- Tray menu: "Change server" item
- SettingsModal: "Disconnect" button

## Security Model (trusted origin)
The window only ever shows two trusted contexts: the local `file://` connection
page, or the server origin the user picked. `trustedOrigin` (module-level state
in `main/state.js`) tracks the latter — set to `new URL(url).origin` when `LOAD_URL`
loads a server, cleared by `navigateToConnectionPage()` (used by the 502/error
recovery flow, the tray "Change server" item, and the `NAVIGATE_BACK` IPC).
- **Navigation lock** (`will-navigate`): only same-origin-as-`trustedOrigin` or
  our exact bundled `index.html` (any other `file://` path is blocked too).
  Blocked http(s) links are handed to `shell.openExternal()`; nothing else
  (`javascript:`, other `file:`, etc.) ever reaches it. Programmatic
  `loadURL`/`loadFile()` calls from the main process don't fire `will-navigate`, so
  recovery navigation is unaffected by this lock.
- **Permissions** (`setPermissionRequestHandler` + `setPermissionCheckHandler`):
  granted only when the requesting frame is on `trustedOrigin` (`isTrustedUrl()`),
  so a frame from another origin inside the trusted page gets nothing. The
  connection page needs none of these and is always denied.
- **Screen capture** (`GET_DESKTOP_SOURCES` IPC, `setDisplayMediaRequestHandler`):
  the IPC channel checks `event.senderFrame` as above; the display-media handler
  (`getDisplayCaptureDenyReason()`) accepts only the window's main frame on
  `trustedOrigin`. `request.securityOrigin` and the permission check's
  `requestingOrigin` are serialized URLs with a trailing slash, so every
  comparison goes through `isTrustedUrl()`, never a string compare. The picker
  leaves out our own window by `getMediaSourceId()`.
- **Downloads** (`will-download` in `setupDownloadHandler()`): default Electron
  behavior kept (native Save As dialog — `setSavePath()` intentionally not
  called); handler only logs start/completed/cancelled/interrupted to stderr.
  Chat file saving relies on `<a download href="blob:...">` anchors —
  `window.open(blobUrl)` is denied by `setWindowOpenHandler`.
- **Sensitive IPC channels**: `LOAD_URL` and `PING_SERVER` are callable only
  from the `file://` connection page (they're what *establish* trust, so a
  loaded server page must never be able to call them). Most other
  state-changing channels (updater, auto-launch, icon, badge,
  `NAVIGATE_BACK`) accept either the connection page or the trusted server
  origin. `SET_SCREEN_SHARE_SOURCE` / `SET_IN_CALL` are trusted-origin-only.
  See `classifySender()` / `isFileSender()` / `isTrustedSender()` /
  `isFileOrTrustedSender()` in `main/trust.js`.

## App Icon Switching
4 variants: `voice-wave` (default), `dark-sphere`, `single-wave`, `double-wave`. IPC `getAppIcon()`/`setAppIcon()`. `buildMultiSizeIcon()` with 16/32/48/64/256. Preference in `userData/icon-preference.json`. `.exe` icon baked at build time (always `voice-wave`).

## Platform Notes
- **Screen share audio**: system loopback everywhere. Linux needs `PulseaudioLoopbackForScreenShare` (set in `main.js`) and captures the default output's monitor, own playout included.
- **Wayland**: PipeWire capturer enabled. XDG portal for screen picker. Audio comes from the same loopback as X11.
- **Single instance**: `requestSingleInstanceLock()` -- second instance focuses existing window.
- **Power save**: `prevent-display-sleep` blocker during calls.
- **Auto-updater**: Windows, macOS and the AppImage update from GitHub Releases, `autoDownload: false`, `autoInstallOnAppQuit: false` — install only happens via the user-triggered `INSTALL_UPDATE` IPC (Settings "Update" button), never silently on quit. Linux packages never update themselves (`INSTALL_CHANNEL`): Copr through dnf, the GitHub RPM and tarball by the user from the releases page, which the update check links to.
- **Crash logs**: `userData/crash-logs/` — written on `uncaughtException` (then an error box and quit: the main process can't be trusted after one), `unhandledRejection` and `render-process-gone`; pruned after 7 days.

## Build & Release
```bash
npm run generate-icons   # SVG -> PNGs
npm run build:win        # Windows x64 NSIS
npm run build:linux      # AppImage, rpm, tar.gz
npm run publish:win      # build + publish to GitHub Releases
npm run publish:linux    # build + publish
```
`overrides` in `package.json` force patched `undici` into the build toolchain: `^7` under `@electron/get`, `^6` under `node-gyp` (node-gyp 12 does not work with 7). Build-time only; drop them once the parents depend on fixed versions. A major bump of either breaks `npm ci`, which the Forgejo PR check now runs.

Release: `./release.sh patch|minor|major|x.y.z <notes-file>` -> bumps version, commits, makes an annotated tag from the notes (the release body), pushes. CI on tag push.
