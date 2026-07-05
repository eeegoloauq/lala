# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Lala

Self-hosted voice/video chat app in the style of Mumble/Discord, built on LiveKit (WebRTC SFU). Monorepo with four packages: an Express API for token/room management (`packages/api`), a Vite+React SPA frontend (`packages/web`), an Electron desktop client (`packages/desktop`), and a types-only wire contract (`packages/shared`, consumed by api+web as a `file:` devDependency -- change API response shapes THERE first). No database -- chat is ephemeral (LiveKit data channels), room state lives in LiveKit+Redis, user prefs in localStorage.

## Build & Deploy

Production does NOT build. CI is the only build path:
push to `main` -> CI builds `api`+`web` images -> container registry
(SHA-tagged) -> auto-deploy pulls images and restarts.
A deploy restarts containers and drops active calls -- time pushes accordingly.

```bash
# Deploy = push
git push origin main

# On the prod host: logs / manual pull of already-built images
docker compose logs -f web api livekit
```

`docker compose` files reference registry images via `LALA_REGISTRY` (set in the prod `.env`);
there is no `build:` section anymore -- `docker compose up -d --build` builds nothing.
Image builds use the REPO ROOT as context (`docker build -f packages/api/Dockerfile .`)
so `packages/shared` is reachable; building with `./packages/api` as context no longer works.

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
- **No tests/linter** yet -- verify changes via local dev servers (`npm run dev`), then deploy through CI.
- **CSS**: 6 themes via `[data-theme]` CSS variable overrides in `globals.css`. New components auto-themed via structural vars.
- **Security**: HMAC-derived stable identity, scrypt password hashing, E2EE for password rooms, admin secrets in Redis only. See Security section in `packages/api/CLAUDE.md`.

## Gotchas

- `@livekit/components-react` v2 -- always check `.d.ts` in node_modules for API changes, docs may be outdated.
- Tor Browser: WebRTC disabled by design -- not fixable.
- iOS Safari: no `getDisplayMedia`, no `setSinkId`.
- `dtx: true` applies globally to voice; screen share explicitly sets `dtx: false, red: false`.
- Ban by identity persists per device but only within room's lifetime.
- Electron screen share `audio: 'loopbackWithoutChrome'` only works on Windows.
- E2EE worker bundled by Vite via `livekit-client/e2ee-worker?worker` import in `RoomView.tsx` -- stays in sync with the installed livekit-client automatically.

## Agentic Workflow

When working with multiple agents on this project:

### Parallelization Strategy
- **API + Web changes** are independent -- use parallel agents (one per package).
- **Builds happen in CI** -- no local docker rebuild step; push once at the end.
- **Desktop** changes rarely needed alongside API/Web -- separate agent when needed.

### Package-Level Context
Each package has its own CLAUDE.md with detailed file maps and architecture. These load lazily when you access files in that package -- no need to read them upfront.

### Common Multi-Agent Patterns
- **Feature across stack**: Agent 1 = API route, Agent 2 = Web UI, then one push -> CI deploy.
- **Bug investigation**: Use Explore agent to search across all packages, then targeted fix agent.
- **Refactor**: Parallel agents per package with worktree isolation to avoid conflicts.

### Verification
- Locally: `npm run dev` in the affected package; after a CI deploy check `docker compose logs -f <service>` on the prod host.
- API health: `curl http://localhost:3001/api/health` should return `{"status":"ok","service":"lala-api"}`.
- No automated tests -- verify manually or via docker logs.
