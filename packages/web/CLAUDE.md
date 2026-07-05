# Web Package (`packages/web`)

Vite+React SPA frontend. `@livekit/components-react` v2 + `livekit-client` v2. Custom UI throughout.

## Core Files

- `src/App.tsx` -- root: sidebar + room; holds `volumes`, `myAvatar`, `liveIdentity` state; `SettingsModal` lazy-loaded
- `src/globals.css` -- all styles + CSS vars; 5 themes: dark, light, amoled, discord, winxp
- `src/lib/api.ts` -- API client; handles 429 with `retryAfter`; wraps network errors as `ApiError('server_unavailable', 0)`
- `src/lib/identity.ts` -- stable device UUID + HMAC cache
- `src/lib/types.ts` -- `RoomInfo`, `TokenResponse`, `ApiError`, `ApiErrorCode`
- `src/lib/i18n.ts` -- i18next setup (en/ru), localStorage key `lala_language`
- `src/lib/constants.ts` -- `LIVEKIT_URL`, screen share FPS/bitrate steps

## Features

### Room (`features/room/`)
- `RoomView.tsx` -- token fetch + E2EE setup + `<LiveKitRoom>`; password pool auto-try; rate limit countdown
- `RoomShell.tsx` -- orchestrates everything; mic/screen sounds; keyboard shortcuts; reconnecting banner
- `VideoGrid/` -- participant tiles, context menu (volume, hide screen share, admin actions), Avatar component
- `FocusLayout/` -- screen share focused view
- `ControlBar/` -- stateless: mic/deafen/cam/screenshare/chat/leave buttons
- `ChatPanel/` -- draggable+resizable overlay; emoji picker; fullscreen on mobile; direct DOM mutation during drag
- `ScreenShareModal/` -- Electron: source picker + thumbnails; Browser: settings + native picker

### Channels (`features/channels/`)
- `ChannelSidebar.tsx` -- room list, participant mini-cards, room templates, reconnecting spinner

### Settings (`features/settings/`)
- `SettingsModal.tsx` -- Profile/Security/Devices/Audio/Video/Appearance/ScreenShare/Chat/Sounds/Keybinds/Desktop
- `useSettings.ts` -- `AppSettings` with localStorage persistence

## Hooks

- `useRoute.ts` -- URL routing; parses `roomId` from path, `hashPassword` from `#pw=` fragment
- `useDisplayName.ts` -- localStorage-persisted display name
- `usePersistedVolumes.ts` -- volume Map with 30-day TTL, 400ms debounce
- `useAvatarSync.ts` -- broadcasts avatar on connect/change; handles deletion
- `useRoomKeyboard.ts` -- rebindable shortcuts; Esc always works
- `useMicSounds.ts` -- mute/unmute sounds + talking-while-muted detection
- `useJoinLeaveSound.ts` -- join/leave + screen share sounds

## Architecture Details

### Themes
5 themes in `globals.css` via `[data-theme="xxx"]` CSS variable overrides. Key structural vars: `--cb-pill-*`, `--cb-btn-*`, `--avatar-radius`, `--tile-radius`, `--overlay-bg/backdrop`, `--fl-*`, `--bubble-radius`, `--panel-header-*`, `--settings-modal-*`, `--toggle-*`. All define `--color-success/danger/warning/info` semantic vars.

Two tiers, by design:
- **dark / light / amoled / discord -- pure token themes.** Zero selector hacks: every visual difference comes from overriding root CSS vars (colors + the structural vars above). A new component built entirely from vars/classes that already exist gets these 4 themes for free -- no per-theme work needed.
- **winxp -- a hand-maintained skin, kept deliberately as a fun feature.** It overrides 81 of the 90 root vars (all structural/visual vars -- the 9 gaps are theme-agnostic spacing/layout constants like `--space-*`/`--sidebar-width` plus one true no-op, `--fl-btn-border: none`, that already matches root) *and* layers ~34 `[data-theme="winxp"] .some-class { ... }` selector blocks on top (bevel buttons, blue title bars, sunken inputs, XP-style scrollbars) because the Luna look needs literal borders/gradients/shadows that vars alone can't express. **Any new component or CSS class must be manually checked against winxp** -- vars alone will reliably reach the other 4 themes but won't make something *look* like XP (flat gray panels, 3D bevels, no blur/backdrop-filter). When adding a var-driven component, at minimum confirm winxp already covers the structural vars it consumes (see the list above) so it doesn't silently fall back to a value that reads wrong on XP's gray/silver palette.
- `retro` (terminal/CRT theme) was **removed 2026-07-05** -- it needed the same hand-maintained-skin treatment as winxp but wasn't considered worth the upkeep. `ThemeProvider` falls back any stored `'retro'` (or otherwise unrecognized) value to `'dark'`.

### Avatar System
1. Upload -> `compressAvatar()` -> 128x128 JPEG -> `saveMyAvatar()` in localStorage
2. `useAvatarSync` broadcasts on connect; unicasts to new joiners; sends `null` on deletion
3. Cached as `lala_av_<identity>` + `lala_avn_<name>` (fallback)

### Chat Panel
Overlay floating window (no layout shift). `position: absolute`, z-index 20. 8-direction resize. Direct DOM mutation during drag (no React setState race). `isFloating` ref converts CSS to inline positioning on first interaction.

### Screen Share Hide
Right-click -> hide: `publication.setSubscribed(false)` on both video + audio tracks. LiveKit stops sending data.

### SSE Updates
`useRooms` opens `EventSource('/api/events')`. Events: `connected`, `rooms_updated`. Auto-reconnect built in. Zero polling.

### Room Templates
Auto-saved after 30s. Up to 3, deduped by name. Sidebar shows offline templates with one-click recreate.

## localStorage Keys

| Key | Contents |
|-----|----------|
| `lala-settings` | AppSettings JSON |
| `lala-identity` | device UUID (NOT the LiveKit identity) |
| `lala_cached_hmac_identity` | HMAC identity for instant display |
| `lala_cached_hmac_device` | device UUID for cache invalidation |
| `lala-display-name` | display name |
| `lala_my_avatar` | own avatar data URL |
| `lala_av_<identity>` | cached avatar by HMAC identity |
| `lala_avn_<name>` | cached avatar by display name (fallback) |
| `lala_volumes` | mic volumes Map JSON |
| `lala_screen_volumes` | screen share volumes Map JSON |
| `lala_language` | i18next preference |
| `lala_enc_<name>` | AES-GCM blob managed by `lib/secureStore.ts` (see below) |

### Encrypted keys (via `lib/secureStore.ts`)

Secrets are AES-GCM-encrypted with a non-extractable WebCrypto key stored in
IndexedDB (`lala-secure`); ciphertext lives under `lala_enc_<logical-key>`.
`initSecureStore()` hydrates a sync in-memory cache before first render
(`main.tsx`); legacy plaintext keys migrate automatically on load.

| Logical key | Contents |
|-----|----------|
| `lala_passwords` | password pool `string[]` (max 20) |
| `lala_admin_<roomId>` | admin secret (creator only) |
| `lala_room_templates` | room templates (max 3, may carry a password) |
| `lala_room_pw_<roomId>` | saved password for room |

## AppSettings (in `lala-settings`)

| Field | Default | Description |
|-------|---------|-------------|
| audioQuality | musicHighQuality | speech/music/musicHighQuality/musicHighQualityStereo |
| noiseSuppressionMode | browser | disabled/browser/rnnoise |
| silenceGate | 0 | 0=off, dBFS threshold |
| pushToTalk | false | |
| pushToTalkKey | Space | |
| videoResolution | h720 | h1080/h720/vga |
| screenShareFpsIdx | 0 | index into [30, 60] |
| screenShareBrIdx | 2 | index into [1,2,5,8,15] Mbps |
| screenShareAudio | true | include system audio |
| chatTTS | true | speak chat messages |
| ambientMode | true | ambient canvas behind screen share |
| simulcast | true | multiple quality layers |
| shortcutsEnabled | true | master toggle |
| keyMic/keyCam/keyDeafen/keyChat/keyFullscreen/keyScreenShare | M/V/D/C/F/S | rebindable shortcuts |

## Nginx (`default.conf.template`)
Processed by envsubst. CSP headers, `X-Forwarded-For` = `$remote_addr`, hashed assets cached 1 year, rate limiting, SSE proxy config.

## Static Files (`public/`)
- `lala-audio-worklet.js` -- RNNoise + silence gate AudioWorklet
- `rnnoise-sync.js` -- RNNoise WASM (base64 inlined)

(E2EE worker is NOT here -- it's bundled by Vite from `livekit-client/e2ee-worker?worker` in `RoomView.tsx`.)
