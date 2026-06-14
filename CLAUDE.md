# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Lala

Self-hosted voice/video chat app in the style of Mumble/Discord, built on LiveKit (WebRTC SFU). Monorepo with three packages: an Express API for token/room management (`packages/api`), a Vite+React SPA frontend (`packages/web`), and an Electron desktop client (`packages/desktop`). No database -- chat is ephemeral (LiveKit data channels), room state lives in LiveKit+Redis, user prefs in localStorage.

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
Browser -> Nginx (:80 -> :3000)
           |-- /        -> static React SPA
           +-- /api/*   -> proxy to API (:3001)
         -> LiveKit (:7880 WS, :50000/udp media, :7881/tcp fallback, :3478/udp TURN)
```

- **API** (`packages/api`) -- Express, `livekit-server-sdk` v2. Endpoints: health, token, rooms CRUD, admin actions, SSE events, webhooks. See `packages/api/CLAUDE.md` for details.
- **Web** (`packages/web`) -- Vite+React, `@livekit/components-react` v2, `livekit-client` v2. Custom UI, NOT using `<VideoConference />`. See `packages/web/CLAUDE.md` for details.
- **Desktop** (`packages/desktop`) -- Electron 40+, wraps the web app with native features. See `packages/desktop/CLAUDE.md` for details.
- Internal Docker: API->LiveKit via `lala-livekit:7880`. Browser->LiveKit via `LIVEKIT_URL` env var.
- **LIVEKIT_URL** passed as `VITE_LIVEKIT_URL` build arg in docker-compose.
- **CORS** -- `ALLOWED_ORIGINS` env var (comma-separated), defaults to `http://localhost:3000`.
- **CSP** -- dynamic via envsubst. `CSP_CONNECT_SRC` env var controls `connect-src` in nginx.

## Conventions

- **Language**: UI strings in Russian + English via `react-i18next` (see `src/locales/`). Code comments in English.
- **API errors**: snake_case codes (`server_error`, `invalid_input`, `wrong_password`, `rate_limited`).
- **localStorage keys**: prefixed `lala_` or `lala-`. Full list in `packages/web/CLAUDE.md`.
- **No tests/linter** yet -- verify changes manually via `docker compose up -d --build`.
- **CSS**: 6 themes via `[data-theme]` CSS variable overrides in `globals.css`. New components auto-themed via structural vars.
- **Security**: HMAC-derived stable identity, scrypt password hashing, E2EE for password rooms, admin secrets in Redis only. See Security section in `packages/api/CLAUDE.md`.

## Gotchas

- `@livekit/components-react` v2 -- always check `.d.ts` in node_modules for API changes, docs may be outdated.
- Tor Browser: WebRTC disabled by design -- not fixable.
- iOS Safari: no `getDisplayMedia`, no `setSinkId`.
- `dtx: true` applies globally to voice; screen share explicitly sets `dtx: false, red: false`.
- Ban by identity persists per device but only within room's lifetime.
- Electron screen share `audio: 'loopbackWithoutChrome'` only works on Windows.
- E2EE worker loaded from `public/lala-e2ee-worker.js` -- must be manually copied from `node_modules/livekit-client/dist/livekit-client.e2ee.worker.mjs` when updating livekit-client.

## Agentic Workflow

When working with multiple agents on this project:

### Parallelization Strategy
- **API + Web changes** are independent -- use parallel agents (one per package).
- **Docker rebuild** depends on code changes -- run sequentially after edits.
- **Desktop** changes rarely needed alongside API/Web -- separate agent when needed.

### Package-Level Context
Each package has its own CLAUDE.md with detailed file maps and architecture. These load lazily when you access files in that package -- no need to read them upfront.

### Common Multi-Agent Patterns
- **Feature across stack**: Agent 1 = API route, Agent 2 = Web UI, then sequential docker rebuild.
- **Bug investigation**: Use Explore agent to search across all packages, then targeted fix agent.
- **Refactor**: Parallel agents per package with worktree isolation to avoid conflicts.

### Verification
- After any change: `docker compose up -d --build <service>` then check `docker compose logs -f <service>`.
- API health: `curl http://localhost:3001/api/health` should return `{"status":"ok","service":"lala-api"}`.
- No automated tests -- verify manually or via docker logs.
