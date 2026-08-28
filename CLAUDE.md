# Lala

Self-hosted voice/video chat (Mumble/Discord-style) on LiveKit (WebRTC SFU). Monorepo:
Express API for token/room management (`packages/api`), Vite+React SPA (`packages/web`),
Electron desktop client (`packages/desktop`), types-only wire contract (`packages/shared`,
consumed by api+web as a `file:` devDependency — change API response shapes THERE first).
No database: chat is ephemeral (LiveKit data channels), room state lives in LiveKit+Redis,
user prefs in localStorage. Each package has its own CLAUDE.md (loads lazily) with file maps.

## Build & Deploy

Production does NOT build. CI is the only path: push to `main` → CI builds `api`+`web`
images (SHA-tagged) → registry → auto-deploy pulls and restarts. **A deploy restarts
containers and drops active calls — time pushes accordingly.**
Day-to-day work goes on `dev`; merging `dev` into `main` and pushing IS the deploy action.

Compose files reference registry images via `LALA_REGISTRY` (prod `.env`); there is no
`build:` section — `docker compose up -d --build` builds nothing. Image builds use the
REPO ROOT as context (`docker build -f packages/api/Dockerfile .`) so `packages/shared` is reachable.

Local dev: `npm install && npm run dev` in `packages/api` (:3001) and `packages/web` (:3000).
No tests or linter yet — verify via dev servers; after a CI deploy check
`docker compose logs -f <service>` on the prod host. API health: `curl http://localhost:3001/api/health`.

## Architecture

```
Browser → Nginx (:80→:3000): /) static SPA, /api/* → API (:3001)
        → LiveKit (:7880 WS, :50000/udp media, :7881/tcp fallback, :3478/udp TURN)
```

- API→LiveKit inside Docker via `lala-livekit:7880`; browser→LiveKit via `LIVEKIT_URL`
  (passed as `VITE_LIVEKIT_URL` build arg).
- CORS: `ALLOWED_ORIGINS` env (comma-separated). CSP: `CSP_CONNECT_SRC` env → nginx envsubst.

## Conventions

- UI strings in Russian + English via `react-i18next` (`src/locales/`); code comments in English.
- API error codes snake_case: `server_error`, `invalid_input`, `wrong_password`, `rate_limited`.
- localStorage keys prefixed `lala_`/`lala-` (full list in `packages/web/CLAUDE.md`).
- CSS: 5 themes via `[data-theme]` variable overrides in `globals.css`; new components auto-themed via structural vars.
- Security: HMAC-derived stable identity, scrypt password hashing, E2EE for password rooms,
  admin secrets in Redis only. See Security in `packages/api/CLAUDE.md`.
- Parallel agents: API and Web changes are independent — one agent per package; push once at the end.

## Gotchas

- `@livekit/components-react` v2 — check `.d.ts` in node_modules, docs lag the API.
- Tor Browser: WebRTC disabled by design — not fixable. iOS Safari: no `getDisplayMedia`, no `setSinkId`.
- `dtx: true` is global for voice; screen share explicitly sets `dtx: false, red: false`.
- Ban by identity persists per device but only within the room's lifetime.
- Electron screen-share `audio: 'loopbackWithoutChrome'` works only on Windows.
- E2EE worker bundled by Vite via `livekit-client/e2ee-worker?worker` import in `RoomView.tsx` —
  stays in sync with installed livekit-client automatically.
