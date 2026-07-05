# Desktop Package (`packages/desktop`)

Electron 40+ desktop client wrapping the web app with native features.

## Key Files

- `main.js` -- main process: window management, IPC, auto-updater, crash recovery, tray, badges, auto-launch, icon switching, single instance lock, power save blocker, error recovery (502 flash fix)
- `preload.js` -- contextBridge: `electronAPI` (screen share, update, badge, auto-launch, session, icon, `navigateBack()`, `loadUrl()`, `pingServer()`)
- `index.html` -- connection page markup/styles only (CSP `script-src 'self'`, no inline JS)
- `connection.js` -- connection page logic: saved servers with editable labels, auto-connect, health check before `loadUrl()`, ping status dots
- `electron-builder.yml` -- Win NSIS x64, Linux AppImage/rpm/tar.gz, macOS dmg
- `build/icon-variants/` -- 4 SVG icon variants + generated PNGs

## Screen Share Flow
1. Button/hotkey -> `handleScreenShareToggle()` in RoomShell
2. ALWAYS shows `ScreenShareModal` (never skips in Electron)
3. Sources via `electronAPI.getDesktopSources()` -> `desktopCapturer.getSources()`
4. Skeleton loading -> Windows/Screens tabs with thumbnails (8s auto-refresh)
5. User picks source -> `setScreenShareSource(sourceId)` -> `setScreenShareEnabled(true)`
6. `setDisplayMediaRequestHandler` returns source with `audio: 'loopbackWithoutChrome'`
7. DTX and RED disabled for screen share audio

## Error Recovery
- **502 flash fix**: Window hidden before `loadURL()`, shown after successful load. 15s safety timeout.
- **`did-fail-load`**: DNS/connection/timeout/cert errors -> `index.html?error=1`
- **`did-navigate` 5xx**: Same recovery flow
- **Anti-loop**: `?error=1` disables auto-connect

## Preload Race Condition
`did-finish-load` checks `!!window.electronAPI`, reloads once if missing. Flag prevents infinite loop.

## Server Switching
- `navigateBack()` IPC: loads `index.html`, stops power save blocker
- Tray menu: "Change server" item
- SettingsModal: "Disconnect" button

## Security Model (trusted origin)
The window only ever shows two trusted contexts: the local `file://` connection
page, or the server origin the user picked. `trustedOrigin` (module-level state
in `main.js`) tracks the latter — set to `new URL(url).origin` when `LOAD_URL`
loads a server, cleared by `navigateToConnectionPage()` (used by the 502/error
recovery flow, the tray "Change server" item, and the `NAVIGATE_BACK` IPC).
- **Navigation lock** (`will-navigate`): only same-origin-as-`trustedOrigin` or
  our exact bundled `index.html` (any other `file://` path is blocked too).
  Blocked http(s) links are handed to `shell.openExternal()`; nothing else
  (`javascript:`, other `file:`, etc.) ever reaches it. Programmatic
  `loadURL`/`loadFile()` calls from main.js don't fire `will-navigate`, so
  recovery navigation is unaffected by this lock.
- **Permissions** (`setPermissionRequestHandler` + `setPermissionCheckHandler`):
  granted only when the requesting page's current top-level origin ===
  `trustedOrigin`. The connection page needs none of these and is always denied.
- **Screen capture** (`GET_DESKTOP_SOURCES` IPC, `setDisplayMediaRequestHandler`):
  gated the same way, checked against the requesting frame's own origin/top-frame
  status directly (`request.securityOrigin` / `event.senderFrame`), not just
  "some page is currently trusted".
- **Sensitive IPC channels**: `LOAD_URL` and `PING_SERVER` are callable only
  from the `file://` connection page (they're what *establish* trust, so a
  loaded server page must never be able to call them). Most other
  state-changing channels (updater, auto-launch, icon, badge, session,
  `NAVIGATE_BACK`) accept either the connection page or the trusted server
  origin. `SET_SCREEN_SHARE_SOURCE` / `SET_IN_CALL` are trusted-origin-only.
  See `classifySender()` / `isFileSender()` / `isTrustedSender()` /
  `isFileOrTrustedSender()` in `main.js`.

## App Icon Switching
4 variants: `voice-wave` (default), `dark-sphere`, `single-wave`, `double-wave`. IPC `getAppIcon()`/`setAppIcon()`. `buildMultiSizeIcon()` with 16/32/48/64/256. Preference in `userData/icon-preference.json`. `.exe` icon baked at build time (always `voice-wave`).

## Platform Notes
- **Screen share audio**: Windows only via WASAPI loopback. macOS/Linux silently get no audio.
- **Wayland**: PipeWire capturer enabled. XDG portal for screen picker. No system audio.
- **Single instance**: `requestSingleInstanceLock()` -- second instance focuses existing window.
- **Power save**: `prevent-display-sleep` blocker during calls.
- **Auto-updater**: GitHub Releases, `autoDownload: false`, `autoInstallOnAppQuit: false` — install only happens via the user-triggered `INSTALL_UPDATE` IPC (Settings "Update" button), never silently on quit.
- **Crash logs**: `userData/crash-logs/` — written on `uncaughtException` / `render-process-gone`, pruned after 7 days.
- **No session restore**: the renderer writes `userData/session.json` on every room join (`saveSession()`) and `running.lock` is written/removed around the app lifecycle, but neither is currently read back by main.js — there is no crash/restart session-restore flow wired up. (A previous `loadSession()` and `previousCrash` were dead code and have been removed.)

## Build & Release
```bash
npm run generate-icons   # SVG -> PNGs
npm run build:win        # Windows x64 NSIS
npm run build:linux      # AppImage, rpm, tar.gz
npm run publish:win      # build + publish to GitHub Releases
npm run publish:linux    # build + publish
```
Release: `./release.sh patch|minor|major|x.y.z` -> bumps version, commits, tags, pushes. CI on tag push.
