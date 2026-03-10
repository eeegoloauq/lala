# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Lala

Self-hosted voice/video chat app in the style of Mumble/Discord, built on LiveKit (WebRTC SFU). Monorepo with three packages: an Express API for token/room management (`packages/api`), a Vite+React SPA frontend (`packages/web`), and an Electron desktop client (`packages/desktop`). No database — chat is ephemeral (LiveKit data channels), room state lives in LiveKit+Redis, user prefs in localStorage.

## Build & Run

```bash
# Full stack (production)
docker compose up -d --build

# Rebuild one service
docker compose up -d --build web
docker compose up -d --build api

# Logs
docker compose logs -f web
docker compose logs -f api
docker compose logs -f livekit
```

### Local development

```bash
cd packages/api && npm install && npm run dev   # Express, port 3001
cd packages/web && npm install && npm run dev   # Vite, port 3000
cd packages/web && npm run build               # outputs to dist/
```

No tests or linter configured yet.

## Architecture

```
Browser → Nginx (:80 → :3000)
           ├── /        → static React SPA
           └── /api/*   → proxy to API (:3001)
         → LiveKit (:7880 WS, :50000/udp media, :7881/tcp fallback, :3478/udp TURN)
```

- **API** — endpoints: `GET /api/health`, `POST /api/token`, `GET/POST /api/rooms`, `DELETE /api/rooms/:id`, `GET /api/rooms/:id`, admin actions (`kick`, `ban`, `mute`, `unban`), `GET /api/events` (SSE). Uses `livekit-server-sdk` v2.
- **Web** — `@livekit/components-react` v2 + `livekit-client` v2. Custom UI, NOT using `<VideoConference />`.
- Internal Docker: API→LiveKit via `lala-livekit:7880`. Browser→LiveKit via the `LIVEKIT_URL` env var (e.g. `wss://rtc.example.com`).
- **LIVEKIT_URL** passed as `VITE_LIVEKIT_URL` build arg in docker-compose.
- **CORS** — `ALLOWED_ORIGINS` env var (comma-separated), defaults to `http://localhost:3000`.
- **CSP** — dynamic via envsubst at container start. `CSP_CONNECT_SRC` env var controls `connect-src` directive in nginx. Default `wss: ws:` (any WebSocket); tighten to your LiveKit domain for production.

## Internationalization (i18n)

- `react-i18next` with `i18next-browser-languagedetector`
- Two locales: `en` and `ru` (JSON files in `src/locales/`)
- Detection order: localStorage (`lala_language`) → browser navigator
- Setup in `src/lib/i18n.ts`, imported at app entry
- All UI strings use `t()` / `useTranslation()` from `react-i18next`

## Security Architecture

### Identity
- **HMAC-derived stable identity**: `POST /api/token` receives `deviceId` (stable device UUID from `getOrCreateIdentity()`), computes `hmac(sha256, apiSecret, deviceId).hex.slice(0,36)` as LiveKit identity. Same device → same identity → LiveKit replaces old connection (no duplicate participants on refresh). Clients cannot forge other identities without knowing `apiSecret`.
- **Device identity** (`getOrCreateIdentity()`): stable UUID in localStorage (`lala-identity`). Sent as `deviceId` in token requests.
- **LiveKit identity**: HMAC of device UUID. Stable per device across sessions. `RoomView` calls `onIdentityAssigned(data.identity)` immediately on token response — so the footer/sidebar show the correct color even before the LiveKit room is joined.
- **HMAC cache**: `getCachedHmacIdentity(deviceId)` / `saveCachedHmacIdentity(deviceId, identity)` in `identity.ts`. Stores the HMAC alongside the device UUID so the cache is invalidated automatically if the device UUID changes (localStorage cleared).

### Room Passwords
- Stored as **scrypt hash** in LiveKit room metadata (`passwordHash: "salt:hash"`). Plain text never stored.
- **Password pool** (Mumble-style): `localStorage['lala_passwords']` = `string[]` (max 20). On join, saved passwords tried automatically. Only shows UI prompt if none match.
- `lib/passwords.ts` has `saveToPool(pw)` / `getPassPool()` helpers.
- **Invite links**: password embedded in URL hash fragment (`#pw=...`); ChannelSidebar copies link with password from `lala_room_pw_<roomId>`; `useRoute` parses `hashPassword` from fragment and clears it from URL after reading.
- Admin secret bypasses password check (creator rejoin).

### E2EE
- Enabled automatically for password-protected rooms via `ExternalE2EEKeyProvider` from `livekit-client`.
- Password = E2EE key (derived via WebCrypto AES-GCM). Server forwards encrypted streams without decrypting.
- Worker: `public/lala-e2ee-worker.js` (copied from `node_modules/livekit-client/dist/livekit-client.e2ee.worker.mjs`).
- Loaded as `new Worker('/lala-e2ee-worker.js', { type: 'module' })`.
- Falls back gracefully if `isE2EESupported()` returns false.

### Admin
- `adminSecret`: 32 hex chars, stored **only in Redis** (`lala:room:<roomId>` key) — never in LiveKit room metadata (would be broadcast to all participants). Creator gets it in `POST /api/rooms` response, stores in `localStorage['lala_admin_<roomId>']`.
- Admin actions: kick (disconnect), ban (add to `bannedIdentities[]` in metadata), mute (LiveKit server-side `canPublish: false`).
- Broadcast via LiveKit data channel (`lala_admin` message type) so all clients see the action in chat.
- `DELETE /api/rooms/:id` requires `adminSecret` in body — protected via `getAuthedRoom()`.
- Redis key evicted on room delete and on `room_finished` webhook. TTL 24h as fallback.

### Rate Limiting
- **Server**: `express-rate-limit` with 15s windows (token: 25, rooms: 30, admin: 5, SSE: 5). Nginx defense-in-depth: `limit_req` 10r/s with burst=20.
- **Client chat**: sliding window 5 messages / 3 seconds with 2s cooldown. Shows "Слишком быстро" warning.
- `X-Forwarded-For` overwritten by nginx with `$remote_addr` — prevents rate limit bypass via header spoofing.
- Frontend shows countdown ring + auto-retries when countdown hits 0.

### Security Hardening
- **CSP**: `script-src 'self' 'unsafe-inline'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`. `connect-src` configurable via `CSP_CONNECT_SRC` env var.
- **Error handling**: global Express error handler catches `entity.parse.failed` (400), `entity.too.large` (413). Custom 404 handler. No stack traces leaked. API error responses use snake_case codes (e.g. `server_error`, `invalid_input`, `room_required`, `wrong_password`, `rate_limited`).
- **Input sanitization**: room names stripped of null bytes, RTL/LTR overrides, control chars. `maxParticipants` validated as integer. Empty `deviceId` treated as absent (random UUID).
- **Headers**: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS (via outer proxy). `X-Powered-By` stripped. `server_tokens off`.
- **Cache**: hashed assets served with `expires 1y` + `Cache-Control: immutable`.

## Key Files

### Root
- `docker-compose.yml` — orchestration; TURN port 3478/udp exposed; `CSP_CONNECT_SRC` env passed to web container
- `livekit.yaml.example` — LiveKit config template: `use_ice_lite: true`, `node_ip: ${NODE_IP}`, TURN enabled on `udp_port: 3478`. Actual `livekit.yaml` is generated at container startup via sed substitution
- `.env` — LiveKit URL/keys, ports, ALLOWED_ORIGINS, CSP_CONNECT_SRC
- `.env.example` — template with placeholder values and CSP_CONNECT_SRC documentation
- `release.sh` — release script: bumps desktop package.json version, commits, tags `vX.Y.Z`, pushes (triggers CI)
- `LICENSE` — MIT, "Lala Contributors"

### API
- `src/index.ts` — Express app setup: CORS, rate limiters, webhook (raw body), JSON parsing, routes, `GET /api/health` endpoint (`{ status: 'ok', service: 'lala-api' }`), custom 404/error handlers, Redis init
- `src/routes/token.ts` — receives `deviceId`, derives HMAC-stable LiveKit identity; verifies password/ban; reads adminSecret from Redis for admin bypass; returns `{ token, identity }`
- `src/routes/rooms.ts` — create/list/delete rooms (DELETE requires adminSecret); room name sanitized (null bytes, RTL, control chars stripped); `maxParticipants` validated as integer 1-100
- `src/routes/admin.ts` — kick/ban/mute/unban actions; require `adminSecret` in body; strips adminSecret before writing metadata back to LiveKit
- `src/routes/events.ts` — SSE endpoint for real-time room updates
- `src/routes/webhook.ts` — LiveKit webhook receiver (signature-verified); broadcasts SSE on room events; evicts Redis cache on `room_finished`
- `src/lib/roomMeta.ts` — `RoomMeta` interface; `hashPassword`/`verifyPassword` (scrypt); `generateRoomId()` (16 hex chars = 64-bit entropy, with collision check loop up to 5 attempts)
- `src/lib/auth.ts` — `verifyAdminSecret()` (timingSafeEqual), `getAuthedRoom()` (reads adminSecret from Redis, restores LK metadata from cache on loss)
- `src/lib/livekit.ts` — `getRoomService()` lazy singleton for `RoomServiceClient`; uses `LIVEKIT_HOST` for internal Docker networking, falls back to `localhost:7880`
- `src/lib/roomStore.ts` — Redis-backed room metadata cache: `connectRedis()`, `cacheRoomMeta()`, `getCachedMeta()`, `evictRoomMeta()`. Key pattern `lala:room:<roomId>`, TTL 24h. Graceful fallback if Redis down.

### Web — core
- `src/App.tsx` — root: sidebar + room; holds `volumes`, `myAvatar`, `liveIdentity` state; `liveIdentity` pre-loaded from HMAC cache, updated via `handleIdentityAssigned` (saves to cache + sets state); passed to ChannelSidebar as `identity`; retains `liveIdentity` on room leave (prevents color change); `SettingsModal` lazy-loaded via `React.lazy` + `Suspense`
- `src/lib/bookmarks.ts` — room bookmarks: `getBookmarks()`, `addBookmark()`, `removeBookmark()`, `isBookmarked()`; max 50, stored in `lala_bookmarks`
- `src/types/electron.d.ts` — ElectronAPI interface: screen share, update, badge, auto-launch, session, icon IPC methods; `IconVariant` type
- `src/lib/iconVariants.tsx` — app icon variant definitions (id, labelKey, SVG preview) for Electron icon picker in settings
- `src/globals.css` — all global styles + CSS vars; **6 themes**: dark, light, amoled, discord, retro, winxp; base `input[type="range"]` slider styles
- `src/lib/constants.ts` — `LIVEKIT_URL`, `SCREEN_SHARE_FPS_STEPS`, `SCREEN_SHARE_BITRATE_STEPS`, `screenShareBitrateLabel()`
- `src/lib/passwords.ts` — password pool functions: `getPassPool()`, `saveToPool()`, `removeFromPool()`, `clearPool()`; per-room password: `saveRoomPassword(roomId, pw)`, `getRoomPassword(roomId)` (stored as `lala_room_pw_<roomId>`)
- `src/lib/utils.ts` — `safeJsonParse<T>()` utility with fallback value
- `src/lib/api.ts` — API client: `getToken()`, `getRooms()`, `createRoom()`, `kickParticipant()`, `banParticipant()`, `muteParticipant()`; handles 429 with `retryAfter`
- `src/lib/sounds.ts` — Web Audio API synthesized tones: join/leave, chat, mute/unmute, screen share start/stop, talking-while-muted beep
- `src/lib/participantColor.ts` — deterministic 8-color palette via `colorForName(identity)`
- `src/lib/tts.ts` — `speak(text, opts)` via `speechSynthesis`
- `src/lib/audioProcessor.ts` — `LalaAudioProcessor` implementing LiveKit `TrackProcessor`
- `src/lib/avatarUtils.ts` — `compressAvatar()` (128×128 JPEG, Canvas); `getMyAvatar/saveMyAvatar`; `getCachedAvatar(identity, name?)` (tries `lala_av_<identity>`, then `lala_avn_<name>` fallback); `setCachedAvatarByName(name, dataUrl)`; `clearCachedAvatar(identity)`; `clearCachedAvatarByName(name)`
- `src/lib/identity.ts` — `getOrCreateIdentity()` stable device UUID; `getCachedHmacIdentity(deviceId)` / `saveCachedHmacIdentity(deviceId, identity)` HMAC cache with device-UUID validation
- `src/lib/i18n.ts` — i18next setup: `LanguageDetector` + `initReactI18next`, en/ru locales, localStorage key `lala_language`
- `src/lib/types.ts` — `RoomInfo`, `CreateRoomRequest`, `TokenRequest`, `TokenResponse`, `ApiErrorCode` (snake_case codes), `ApiError { code, status, retryAfter? }`

### Web — hooks
- `src/hooks/useRoute.ts` — URL routing: parses `roomId` from path, `hashPassword` from `#pw=` fragment; `navigate()`/`replace()` helpers
- `src/hooks/useDisplayName.ts` — localStorage-persisted display name
- `src/hooks/usePersistedVolumes.ts` — `Map<identity, volume>` with localStorage, 30-day TTL, 400ms debounce
- `src/hooks/useAvatarSync.ts` — broadcasts own avatar on connect, unicasts to new joiners, re-broadcasts on avatar change mid-session; handles `dataUrl: null` to propagate avatar deletion; `onAvatarReceived(identity, dataUrl: string | null)`
- `src/hooks/useRoomKeyboard.ts` — rebindable keyboard shortcuts; `shortcutsEnabled` master toggle; Esc always works regardless

### Web — features/room hooks
- `hooks/useMicSounds.ts` — `useMicSound(enabled)`: watches `isMicrophoneEnabled` state changes from any source (button, keyboard, deafen) and plays mute/unmute sounds; `useTalkingWhileMuted(deviceId?, enabled?)`: opens secondary `getUserMedia` when muted+connected, monitors RMS at 150ms, warns at dBFS > -40 with 2.5s debounce
- `hooks/useJoinLeaveSound.ts` — `useJoinLeaveSound(enabled)`, `useScreenShareSound(enabled)`

### Web — features/room
- `RoomView.tsx` — token fetch (with password pool auto-try) + E2EE setup + `<LiveKitRoom>`; calls `onIdentityAssigned(data.identity)` immediately on token success; rate limit countdown ring with auto-retry; `tryPool` properly handles `rate_limited` errors (stops iteration, shows countdown instead of false password prompt); supports `hashPassword` prop from invite link `#pw=` fragment (tried first before pool)
- `RoomShell.tsx` — orchestrates everything; `ScreenShareModal` lazy-loaded via `React.lazy` + `Suspense`; `addSystem(text, id)` helper for chat system entries; uses `useMicSound`, `useTalkingWhileMuted`, `useScreenShareSound`, `useJoinLeaveSound`; `useRoomKeyboard` with dynamic key bindings; reconnecting banner (shown when `ConnectionState.Reconnecting`); Electron: syncs unread badge count, saves session on join
- `VideoGrid/VideoGrid.tsx` — grid; right-click context menu; screen share hide/show toggle (both video + audio tracks); stable `handleTileClick` useCallback — clicking tile auto-subscribes to unsubscribed screen share
- `VideoGrid/ParticipantTile.tsx` — video tile wrapped in `React.memo`: avatar, speaking ring, quality bars, screen share badge, flip button, admin-mute indicator (`useIsServerMuted` detects `canPublish === false`); `onClick: (identity: string) => void`; `useIsScreenSharing` subscribes only to relevant events per participant type (Remote→TrackPublished, Local→LocalTrackPublished)
- `VideoGrid/ParticipantContextMenu.tsx` — right-click menu; volume sliders, screen share hide/show, admin actions
- `VideoGrid/Avatar.tsx` — initials avatar OR photo (`avatarUrl` prop); `size` prop (default 36)
- `FocusLayout/FocusLayout.tsx` — screen share / focused view; screen share hide toggle (both tracks)
- `ControlBar/ControlBar.tsx` — stateless: mic/deafen/cam/screenshare/chat/leave; receives `onScreenShareClick` prop (modal owned by RoomShell); screen share visible when `canScreenShare || isElectron`
- `ChatPanel/ChatPanel.tsx` — **draggable + resizable overlay** floating window; 8-direction resize handles; direct DOM mutation during drag (no React setState race); `lockPanel()` switches from CSS to inline positioning on first interaction; emoji picker; fullscreen on mobile
- `ChatPanel/EmojiPicker.tsx` — custom picker, ~52 emoji, 5 categories, lazy-loaded
- `ScreenShareModal/ScreenShareModal.tsx` — screen share config modal with two modes:
  - **Electron**: source picker (Windows/Screens tabs, skeleton loading, 8s auto-refresh thumbnails), compact bottom bar (quality Select + FPS Select + audio toggle + actions); sources filtered with `useMemo`
  - **Browser**: labeled settings rows (Качество/Частота кадров/Звук) + hint text, no source picker (browser shows native picker after)
  - Uses shared `Select` component from `ui/Select.tsx` (not native `<select>`)
  - Audio toggle: controls `screenShareAudio` setting, passed through to `useScreenShare` → LiveKit
  - Tab order: Окна first (default), Экраны second

### Web — features/settings
- `SettingsModal.tsx` — sections: Profile / Security / Devices / Audio / Video / Appearance / Screen Share / Chat / Sounds / Keybinds / Desktop (Electron-only: auto-launch toggle, update status UI with version display/checking/available/downloading/ready/error states). About section at bottom (GitHub link, BTC donate)
- `MicTester.tsx` — RMS level meter + silence gate + monitor toggle
- `useSettings.ts` — `AppSettings` with localStorage persistence
- `ThemeProvider.tsx` — theme context; `data-theme` on `<html>`

### Web — features/channels
- `ChannelSidebar.tsx` — room list + participant mini-cards; theme cycle toggle; room bookmarks (star icon per room, offline bookmarks shown greyed out); when in active room uses `liveParticipants` Map for live participant data; filters self from API participant list to prevent ghost entries on leave; `getCachedAvatar(p.identity, displayName)` with name fallback; `identity` prop = HMAC identity (or device UUID before room join); `roomsError` prop shows API connection error in red when room fetch fails

### Web — nginx
- `default.conf.template` — nginx config template processed by envsubst at container start; `CSP_CONNECT_SRC` env var interpolated into CSP `connect-src`; security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy); CSP with `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`; `X-Forwarded-For` set to `$remote_addr` (prevents spoofing); hashed assets cached 1 year; rate limiting zone for API; SSE-specific proxy config for `/api/events`

### Web — public (static, no Vite bundling)
- `public/lala-audio-worklet.js` — AudioWorklet: RNNoise + silence gate; ring buffers
- `public/rnnoise-sync.js` — RNNoise WASM (base64 inlined)
- `public/lala-e2ee-worker.js` — E2EE worker (copy of `livekit-client.e2ee.worker.mjs`); loaded as `type: 'module'`

## Theme Architecture

6 themes in `globals.css`: `dark | light | amoled | discord | retro | winxp`. All via `[data-theme="xxx"]` CSS variable overrides. New components using structural vars are automatically themed — no per-component theme overrides needed.

Key structural variables: `--cb-pill-*`, `--cb-btn-*`, `--avatar-radius`, `--tile-radius`, `--overlay-bg/backdrop`, `--fl-main-*`, `--bubble-radius`, `--panel-header-*`, `--settings-modal-*`, `--toggle-*`, `--ctx-menu-radius`, `--scrollbar-*`.

All themes define `--color-success/danger/warning/info` semantic color vars. Settings animations use `settingsFadeIn` keyframe (renamed from generic `fadeIn` to avoid conflicts).

## Avatar Architecture

1. User uploads photo → `compressAvatar()` → 128×128 JPEG data URL → `saveMyAvatar()` in localStorage
2. `myAvatarUrl` passed as prop down to `RoomShell`
3. `useAvatarSync` broadcasts on connect; unicasts to each new joiner; re-broadcasts when `myAvatarUrl` changes mid-session; sends `dataUrl: null` on avatar deletion
4. `onAvatarReceived(identity, dataUrl: string | null)` → set/delete `lala_av_<identity>` + `lala_avn_<name>` in localStorage + `avatarCache` Map in RoomShell; fires `onAvatarReceived` prop → `liveAvatarCache` in App.tsx
5. Own avatar: RoomShell effect caches `myAvatarUrl` under `localParticipant.identity` in both Map and localStorage
6. `avatarCache` Map passed to VideoGrid/FocusLayout → `avatarUrl` prop on ParticipantTile → Avatar component
7. `liveAvatarCache` state in App.tsx: updated live while in a room; passed as `avatarCache` to ChannelSidebar; cleared on room leave

## Chat Panel Architecture

Overlay floating window (not inline — no layout shift on open/close):
- `position: absolute` over video area, z-index 20
- Draggable via header (mousedown → direct DOM style mutation)
- Resizable via 8 handles (n/s/e/w/ne/nw/se/sw)
- `isFloating` ref: first interaction converts from CSS positioning to inline `top/left/width/height`
- `applyPanelStyle()` / `getPanelRect()` utilities for DOM manipulation
- No React `setState` during drag/resize (avoids race with concurrent re-renders from new messages)
- Fullscreen on mobile

## Screen Share — Hide/Unsubscribe

Right-click any participant with screen share → "Скрыть демку" / "Показать демку":
- Calls `publication.setSubscribed(false/true)` on BOTH `ScreenShare` and `ScreenShareAudio` RemoteTrackPublications
- LiveKit stops sending data → saves bandwidth
- `useTracks()` reacts automatically → `isScreenSharing` in RoomShell updates → FocusLayout may auto-exit
- State tracked via `publication.isSubscribed` at right-click time (no separate React state needed)

## localStorage Keys

| Key | Contents |
|-----|----------|
| `lala-settings` | AppSettings JSON |
| `lala-identity` | device UUID (stable, NOT the LiveKit identity) |
| `lala_cached_hmac_identity` | HMAC identity cached for instant display before room join |
| `lala_cached_hmac_device` | device UUID paired with cached HMAC (for cache invalidation) |
| `lala-display-name` | display name |
| `lala_my_avatar` | own avatar data URL |
| `lala_av_<identity>` | cached avatar for participant (keyed by LiveKit HMAC identity) |
| `lala_avn_<name>` | cached avatar keyed by display name (secondary fallback) |
| `lala_volumes` | mic volumes Map JSON |
| `lala_screen_volumes` | screen share volumes Map JSON |
| `lala_passwords` | password pool `string[]` (max 20, Mumble-style) |
| `lala_admin_<roomId>` | admin secret for room (only creator has this) |
| `lala_bookmarks` | room bookmarks `Array<{roomId, name, hasPassword?}>` (max 50) |
| `lala_room_pw_<roomId>` | saved working password for a specific room (for invite links) |
| `lala_language` | i18next language preference (e.g. `en`, `ru`) |
| `lala_no_auto_connect` | `'true'` to disable Electron auto-connect on launch |
| `lala_recent_servers` | recent server URLs for Electron connection page (max 5) |

## AppSettings

All in `lala-settings`:

| Field | Default | Description |
|-------|---------|-------------|
| audioQuality | musicHighQuality | speech/music/musicHighQuality/musicHighQualityStereo |
| autoGainControl | false | |
| echoCancellation | false | |
| noiseSuppressionMode | browser | disabled/browser/rnnoise |
| silenceGate | 0 | 0=off, dBFS threshold e.g. -40 |
| audioInputDeviceId | — | |
| audioOutputDeviceId | — | |
| videoInputDeviceId | — | |
| pushToTalk | false | |
| pushToTalkKey | Space | |
| videoResolution | h720 | h1080/h720/vga |
| screenShareFpsIdx | 0 | index into SCREEN_SHARE_FPS_STEPS [30, 60] |
| screenShareBrIdx | 2 | index into SCREEN_SHARE_BITRATE_STEPS [1,2,5,8,15] Mbps |
| screenShareSkipDialog | false | browser only — skip modal and use last settings |
| screenShareAudio | true | include system audio in screen share |
| accentColor | — | overrides --accent CSS vars |
| chatTTS | true | speak chat messages aloud |
| ttsVolume | 15 | 0–100 |
| ttsReadOwn | false | also read own messages |
| ttsMaxLength | 200 | truncate at N chars |
| ttsVoice | '' | speechSynthesis voice name, '' = default |
| ambientMode | true | ambient canvas behind screen share |
| simulcast | true | encode multiple quality layers for camera |
| soundJoinLeave | true | play sound on participant join/leave |
| soundChat | true | play sound on new chat message |
| soundScreenShare | true | play sound on screen share start/stop |
| soundMicFeedback | true | play mute/unmute sounds |
| soundTalkingWhileMuted | true | beep when speaking into muted mic |
| shortcutsEnabled | true | master toggle for keyboard shortcuts |
| keyMic | KeyM | toggle mic |
| keyCam | KeyV | toggle camera |
| keyDeafen | KeyD | toggle deafen |
| keyChat | KeyC | toggle chat panel |
| keyFullscreen | KeyF | toggle fullscreen |
| keyScreenShare | KeyS | toggle screen share |

## Electron Desktop (`packages/desktop`)

### Key Files
- `main.js` — main process: window management, IPC handlers, auto-updater (`quitAndInstall(true, true)` for silent updates), crash recovery, tray, badges, auto-launch, icon switching, single instance lock, power save blocker. `app.setAppUserModelId('app.lala.desktop')` set before ready for correct Windows taskbar association
- `preload.js` — contextBridge exposing `electronAPI` to renderer
- `index.html` — connection page (server URL input, auto-connect, recent servers) with splash screen during auto-connect (pulsing status, cancel button)
- `electron-builder.yml` — build config (Win NSIS x64, Linux AppImage/rpm/tar.gz, macOS dmg); `publish.releaseType: release`; GitHub Releases provider
- `scripts/generate-icons.js` — SVG → per-size PNGs (Linux `build/icons/`, Windows `build/icons-win/`, tray, macOS template) + variant PNGs (16/32/48/64/256 per variant) from `build/icon-variants/*.svg`
- `build/icon-variants/` — 4 icon variant SVGs + generated PNGs: `voice-wave` (default, 5 bars), `dark-sphere`, `single-wave`, `double-wave`

### Screen Share Flow (Electron)
1. User clicks button or presses hotkey → `handleScreenShareToggle()` in RoomShell
2. ALWAYS shows `ScreenShareModal` in Electron (never skips, even if `screenShareSkipDialog=true`)
3. Modal fetches sources via `electronAPI.getDesktopSources()` → IPC → `desktopCapturer.getSources()`
4. Shows skeleton tiles while loading, then Windows/Screens tabs with thumbnails (JPEG quality 70, 320x180)
5. Thumbnails auto-refresh every 8 seconds while modal is open
6. User picks source, sets quality/fps/audio, clicks "Начать"
7. `handleScreenShareModalConfirm(quality, sourceId, audio)` → `await electronAPI.setScreenShareSource(sourceId)` FIRST
8. Then `localParticipant.setScreenShareEnabled(true, {audio, ...})` triggers `getDisplayMedia`
9. `main.js` `setDisplayMediaRequestHandler` sees `pendingScreenShareSourceId`, returns it with `audio: 'loopbackWithoutChrome'`
10. DTX and RED disabled for screen share audio tracks (preserves music/app audio quality)
11. 30s timeout auto-clears stale sourceId

### Preload Race Condition Fix
When navigating from `file://index.html` to `https://server` via `loadURL()`, the preload script's `contextBridge.exposeInMainWorld()` may complete after page scripts execute. Fix: `did-finish-load` listener checks `!!window.electronAPI` via `executeJavaScript`, reloads once if missing. Flag prevents infinite loop.

### Screen Share Audio
- Electron uses `audio: 'loopbackWithoutChrome'` = system-wide WASAPI loopback excluding app's own audio on Windows only
- macOS/Linux silently get no system audio (OS limitation)
- Per-window audio capture is NOT possible via Electron APIs — would require native C++ addon using Windows WASAPI Application Loopback API (Win10 Build 20348+)
- Audio toggle in modal controls whether to request audio at all (`systemAudio: 'include'|'exclude'`)

### App Icon Switching
- 4 icon variants: `voice-wave` (default), `dark-sphere`, `single-wave`, `double-wave`
- IPC: `getAppIcon()`, `setAppIcon(name)` — switches tray + window icon at runtime
- `buildMultiSizeIcon()` constructs nativeImage with 16/32/48/64/256 representations (Windows picks correct size per context: taskbar=32, alt-tab=64, etc.)
- `getInitialWindowIcon()` creates window with saved variant from the start (no flash of default icon)
- Preference stored in `userData/icon-preference.json`
- On app start, applies saved preference (or default `voice-wave`)
- Settings UI: icon picker in Desktop section with inline SVG previews (from `src/lib/iconVariants.tsx`)
- `.exe`/`.AppImage` icon is baked at build time (always `voice-wave`); only tray + window change at runtime
- **Windows limitation**: pinned taskbar shortcut icon is read from .exe resources — `setIcon()` cannot change it. This is a known Electron/Windows behavior

### Auto-Updater
- `electron-updater` with GitHub Releases provider
- `autoDownload: false` — notifies renderer, then downloads on request
- `quitAndInstall(true, true)` — silent install on restart
- IPC: `checkForUpdate()`, `installUpdate()`, `onUpdateStatus(callback)`, `getAppInfo()`
- Update status UI in SettingsModal Desktop section (version display, checking/available/downloading/ready/error states)

### Crash Recovery
- `running.lock` in userData — written on start, removed on clean quit
- Crash logs: `userData/crash-logs/`
- Session: `userData/session.json` = `{ serverUrl, roomId, timestamp }`

### Single Instance Lock
- `app.requestSingleInstanceLock()` — prevents multiple Electron instances; second instance focuses the existing window

### Power Save Blocker
- IPC: `setInCall(inCall)` — renderer notifies main process of call state
- `powerSaveBlocker.start('prevent-display-sleep')` when in call, stopped on leave
- Prevents OS from sleeping display during active calls

### Wayland Support
- `WebRTCPipeWireCapturer` feature flag enabled before app ready — enables PipeWire-based screen capture
- `IS_WAYLAND` detection via `XDG_SESSION_TYPE` / `WAYLAND_DISPLAY` env vars
- On Wayland, screen share uses XDG desktop portal (native picker) instead of Electron's `desktopCapturer` source picker
- No system audio capture on Wayland (OS limitation)

### Build & Release
```bash
cd packages/desktop
npm run generate-icons   # SVG → PNGs
npm run build:win        # Windows x64 NSIS
npm run build:linux      # AppImage, rpm, tar.gz
npm run publish:win      # build + publish to GitHub Releases
npm run publish:linux    # build + publish to GitHub Releases
```
Release workflow: `./release.sh patch|minor|major|x.y.z` — bumps version, commits, tags `vX.Y.Z`, pushes. CI triggers on tag push.

CI: `.github/workflows/electron.yml` — triggers on push tags `v*` + `workflow_dispatch`. Two parallel jobs (`build-windows` on `windows-latest`, `build-linux` on `ubuntu-latest`). Uses `npm run publish:win`/`publish:linux` (`electron-builder --publish always`). Linux job updates release description with download table.

## Known Issues / Caveats

- Tor Browser: WebRTC disabled by design — not fixable
- iOS Safari: `getDisplayMedia` not supported — screen share button is hidden automatically
- iOS Safari: no `setSinkId` → earpiece/loudspeaker routing not controllable from browser
- `dtx: true` in publishDefaults applies globally to voice tracks; screen share explicitly sets `dtx: false, red: false` to preserve audio quality
- Ban by identity persists per device (HMAC identity is stable), but only within the room's lifetime
- `@livekit/components-react` v2 — always check `.d.ts` in node_modules for API changes
- Electron screen share `audio: 'loopbackWithoutChrome'` only works on Windows — macOS/Linux silently get no system audio
