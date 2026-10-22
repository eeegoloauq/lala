# Lala

Lala is a self-hosted voice and video chat app for people who want a Mumble/Discord-style room experience on their own server. It uses LiveKit for media, an Express API, a React web client and an Electron desktop client. Chat is ephemeral; room state is in LiveKit and Redis, with no application database.

## Work locally

- API: needs Redis (`e2e/redis.sh` runs one on 6380): `cd packages/api && npm ci && REDIS_URL=redis://127.0.0.1:6380 npm run dev` (port 3001, plus the LiveKit env vars); check with `curl http://localhost:3001/api/health`.
- Web: `cd packages/web && npm ci && npm run dev` (port 3000).
- Desktop: `cd packages/desktop && npm ci && npm start`.
- Before shipping, run `npm run build` in API and web and `npm run lint` in web. For call, auth or dependency changes run `cd e2e && npm test` (two-person calls, screen share and room admin actions against a local LiveKit, Redis, API and web build; first `npm ci && npm run setup`). The same suite gates the image builds in CI. `npm run test:desktop` runs the same flow in the desktop app on Linux/X11 (after `npm ci` in `packages/desktop`; `xvfb-run` without a display). Windows, macOS and Wayland still need a manual call.

## Delivery and rollback

Work lands on `main`. A mirrored push to `main` starts CI image builds; the pull-based production deploy picks up SHA-tagged images and restarts containers. Active calls drop during a deploy. Production does not build images. Any failure while moving, including a failed health check, restores the previous commit and records the rejected one so the timer does not retry it. `deploy/lala-pull` is the deploy and rollback procedure; `deploy/install.sh` installs it on the host (see `deploy/README.md`), and changes under `deploy/` take effect only after it is run there. Releases use `release.sh` and a `v*` tag, which publishes the desktop clients and the server images.

## Decisions and gotchas

- `packages/shared` owns API wire types; update it when response shapes change. API and web consume it as a local package dependency. Docker image builds need the repo root as context.
- Images are multi-arch (amd64, arm64) so self-hosters can use them. The web image is deployment-neutral: clients get `LIVEKIT_URL` from the API with each token. Per-commit images are SHA-tagged for the deploy and pruned to the last 30; a `v*` tag publishes `:<version>` and `:latest`.
- Password rooms use E2EE with a key derived on the client separately from the one the server checks (`packages/web/src/lib/roomKeys.ts`); the server must never receive the password or the media key. The worker is bundled from the installed `livekit-client` through the import in `RoomView.tsx`.
- Authority comes from the server: the caller's identity (from the `X-Lala-Device` header), rights as LiveKit grants, moderation events published by the server. Room state lives only in Redis. Clients never trust control messages from other participants.
- Voice uses DTX; screen sharing explicitly disables DTX and RED. Keep this distinction when changing publishing options.
- Tor Browser disables WebRTC. iOS Safari lacks screen capture and output-device selection. Electron captures system audio on every desktop OS, but on Linux the capture includes the call's own playout (Chromium cannot exclude a process there), so the screen share modal warns about it.
- A room ban tied to device identity lasts only for that room's lifetime.

Do not use `docker compose up -d --build` as a production build path. Do not put secrets in tracked files. Package-specific notes are in `packages/api/CLAUDE.md`, `packages/web/CLAUDE.md` and `packages/desktop/CLAUDE.md`.

Planned larger work: `ROADMAP.md`.
