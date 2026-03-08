# Lala

Self-hosted voice & video chat. Like Mumble or Discord, but yours.
Built on [LiveKit](https://livekit.io/) (WebRTC SFU). No database — rooms are ephemeral, chat goes over data channels, state lives in LiveKit + Redis.

**Demo:** [lala.egor-solovev.dev](https://lala.egor-solovev.dev)

**Desktop app:** [Download](https://github.com/eeegoloauq/lala/releases) (Windows, Linux)

## What it does

- Voice and video with configurable audio quality (speech / music / high-quality stereo)
- E2EE for password-protected rooms (AES-GCM, server never sees plaintext)
- Screen sharing with quality/FPS controls and system audio (Windows)
- Chat over data channels with emoji picker and TTS
- Room admin — kick, ban, mute; passwords hashed with scrypt
- 6 themes — dark, light, AMOLED, Discord, retro, Windows XP
- RNNoise noise suppression (AudioWorklet)
- Desktop app with auto-updates, tray, native screen share picker

## Setup

Need: Docker, a server with a public IP, a domain.

```bash
git clone https://github.com/eeegoloauq/lala.git
cd lala
cp .env.example .env
# edit .env — set your IP, domain, generate LiveKit keys
docker compose up -d --build
```

Web UI runs on port 3000. Put a reverse proxy in front for TLS.

### Environment

| Variable | What |
|----------|------|
| `LIVEKIT_URL` | WebSocket URL (`wss://rtc.example.com`) |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `NODE_IP` | Server public IP |
| `LIVEKIT_DOMAIN` | Domain for TURN |
| `ALLOWED_ORIGINS` | Allowed frontend origins |
| `CSP_CONNECT_SRC` | CSP connect-src (default: `wss: ws:`, tighten for prod) |

### Ports

| Port | Proto | What |
|------|-------|------|
| 3000 | TCP | Web UI (nginx → SPA + API proxy) |
| 7880 | TCP | LiveKit signaling |
| 7881 | TCP | ICE/TCP fallback |
| 50000 | UDP | Media |
| 3478 | UDP | TURN |

## Architecture

```
Browser → Nginx (:3000)
            ├── /       → React SPA
            └── /api/*  → Express API (:3001)
          → LiveKit (:7880 WS, :50000/udp, :3478/udp TURN)
```

Three packages:

- `packages/api` — Express. Token generation, room CRUD, admin actions, SSE. Uses `livekit-server-sdk` v2.
- `packages/web` — Vite + React. `livekit-client` v2, custom UI.
- `packages/desktop` — Electron. Native screen share, tray, auto-updates.

No database. Identity = HMAC of a stable device UUID — same device, same participant, always.

## Security

- E2EE via WebCrypto AES-GCM (password = encryption key)
- HMAC identity — unforgeable without the API secret
- Passwords stored as scrypt hashes, constant-time comparison
- Admin secrets: 128-bit random, Redis-only (never in room metadata)
- Rate limiting: nginx + Express, client-side chat throttle
- Input sanitization: null bytes, RTL overrides, control chars stripped
- CSP, X-Frame-Options, X-Content-Type-Options, HSTS
- API runs as non-root (`node` user)

## Local dev

```bash
cd packages/api && npm install && npm run dev   # :3001
cd packages/web && npm install && npm run dev   # :3000
```

## Donate

BTC: `bc1qrs4mqlc5kv697te3wkxc36sjpqcm8phlajk39t`

## License

[MIT](LICENSE)
