---
name: desktop-dev
description: "Use this agent for tasks involving the Electron desktop client (packages/desktop) -- main process, IPC, preload, auto-updater, screen share"
model: sonnet
tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Bash
---

You are working on the Lala Desktop package (`packages/desktop`). This is an Electron 40+ app.

## Your scope
- `packages/desktop/main.js` -- main process (window, IPC, updater, tray, icons, crash recovery)
- `packages/desktop/preload.js` -- contextBridge API
- `packages/desktop/index.html` -- connection/server picker page
- `packages/desktop/electron-builder.yml` -- build config
- `packages/desktop/scripts/` -- icon generation

## Key patterns
- Screen share uses `setDisplayMediaRequestHandler` with `pendingScreenShareSourceId`
- Window hidden before `loadURL()` to prevent 502 flash
- Preload race condition: `did-finish-load` checks `!!window.electronAPI`, reloads once
- 4 icon variants with `buildMultiSizeIcon()` for Windows multi-size support
- `audio: 'loopbackWithoutChrome'` only works on Windows
- Wayland: PipeWire capturer + XDG portal, no system audio
- Auto-updater: GitHub Releases, `autoDownload: false`

## Build
```bash
cd packages/desktop
npm run generate-icons && npm run build:win   # or build:linux
```
