# Lala

Lala is a self-hosted voice and video chat app for people who want a Mumble/Discord-style room experience on their own server. It uses LiveKit for media, an Express API, a React web client and an Electron desktop client. Chat is ephemeral; room state is in LiveKit and Redis, with no application database.

## Work locally

- API: `cd packages/api && npm ci && npm run dev` (port 3001); check with `curl http://localhost:3001/api/health`.
- Web: `cd packages/web && npm ci && npm run dev` (port 3000).
- Desktop: `cd packages/desktop && npm ci && npm start`.
- Before shipping, run `npm run build` in API and web and `npm run lint` in web. No package has a test script; verify changed call flows with a real call.

## Delivery and rollback

Work normally lands on `dev`. A mirrored push to `main` starts CI image builds; the pull-based production deploy picks up SHA-tagged images and restarts containers. Active calls drop during a deploy. Production does not build images. A failed health check restores the previous image tag and records the rejected commit so the timer does not retry it. See `deploy/README.md` and `deploy/lala-pull` for the current deploy and rollback procedure. Desktop releases use `release.sh` and a `v*` tag.

## Decisions and gotchas

- `packages/shared` owns API wire types; update it when response shapes change. API and web consume it as a local package dependency. Docker image builds need the repo root as context.
- The web client bakes `LIVEKIT_URL` into its image through `VITE_LIVEKIT_URL`; changing it requires a web rebuild.
- Password rooms use E2EE. The worker is bundled from the installed `livekit-client` through the import in `RoomView.tsx`.
- Voice uses DTX; screen sharing explicitly disables DTX and RED. Keep this distinction when changing publishing options.
- Tor Browser disables WebRTC. iOS Safari lacks screen capture and output-device selection. Electron system-audio capture is Windows-only.
- A room ban tied to device identity lasts only for that room's lifetime.

Do not use `docker compose up -d --build` as a production build path. Do not put secrets in tracked files. Package-specific notes are in `packages/api/CLAUDE.md`, `packages/web/CLAUDE.md` and `packages/desktop/CLAUDE.md`.

Planned larger work: `ROADMAP.md`.
