# Desktop Package (`packages/desktop`)

Electron 40+ desktop client wrapping the web app with native features.

## Key Files

- `main.js` -- main process: window management, IPC, auto-updater, crash recovery, tray, badges, auto-launch, icon switching, single instance lock, power save blocker, error recovery (502 flash fix)
- `preload.js` -- contextBridge: `electronAPI` (screen share, update, badge, auto-launch, session, icon, `navigateBack()`, `loadUrl()`, `pingServer()`)
- `index.html` -- connection page: saved servers with editable labels, auto-connect, health check before `loadUrl()`, ping status dots
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

## App Icon Switching
4 variants: `voice-wave` (default), `dark-sphere`, `single-wave`, `double-wave`. IPC `getAppIcon()`/`setAppIcon()`. `buildMultiSizeIcon()` with 16/32/48/64/256. Preference in `userData/icon-preference.json`. `.exe` icon baked at build time (always `voice-wave`).

## Platform Notes
- **Screen share audio**: Windows only via WASAPI loopback. macOS/Linux silently get no audio.
- **Wayland**: PipeWire capturer enabled. XDG portal for screen picker. No system audio.
- **Single instance**: `requestSingleInstanceLock()` -- second instance focuses existing window.
- **Power save**: `prevent-display-sleep` blocker during calls.
- **Auto-updater**: GitHub Releases, `autoDownload: false`, `quitAndInstall(true, true)`.
- **Crash recovery**: `running.lock`, crash logs in `userData/crash-logs/`, session in `userData/session.json`.

## Build & Release
```bash
npm run generate-icons   # SVG -> PNGs
npm run build:win        # Windows x64 NSIS
npm run build:linux      # AppImage, rpm, tar.gz
npm run publish:win      # build + publish to GitHub Releases
npm run publish:linux    # build + publish
```
Release: `./release.sh patch|minor|major|x.y.z` -> bumps version, commits, tags, pushes. CI on tag push.
