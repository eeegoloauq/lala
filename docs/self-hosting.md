# Self-hosting

You need: Docker, a server with a public IP, a domain.

The four containers use about 75 MB of RAM when idle; LiveKit grows during calls.

Images for amd64 and arm64 are published to GHCR: `:latest` and a version tag (`:0.0.27`) for each
release, `:edge` for the latest commit on `main`.

```bash
git clone https://github.com/eeegoloauq/lala.git
cd lala
cp .env.example .env
# edit .env: your IP, domain, LiveKit keys, Redis password and the image tag

docker network create edge   # compose attaches web and LiveKit to it for your reverse proxy
docker compose up -d
```

The web UI (`:80` in the `web` container) and LiveKit signaling (`:7880`) are reachable on the
`edge` network and on the host's loopback (`127.0.0.1:3000`, `127.0.0.1:7880`). Put a reverse proxy
with TLS on that network in front of both, with LiveKit at its own domain
(`wss://rtc.example.com` → `lala-livekit:7880`).

To build the images yourself, use the repo root as the build context so `packages/shared` is
included, and set `LALA_REGISTRY=local` and `LALA_TAG=dev`:

```bash
docker build -f packages/api/Dockerfile -t local/lala-api:dev .
docker build -f packages/web/Dockerfile -t local/lala-web:dev .
```

## Environment

| Variable | What |
|----------|------|
| `LIVEKIT_URL` | WebSocket URL clients connect to (`wss://rtc.example.com`) |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit credentials |
| `NODE_IP` | Server public IP (WebRTC ICE) |
| `LIVEKIT_DOMAIN` | Domain for TURN (must resolve to the server) |
| `REDIS_PASSWORD` | Redis password (`openssl rand -hex 24`) |
| `LALA_REGISTRY` / `LALA_TAG` | Where compose pulls the api/web images from (`ghcr.io/eeegoloauq`, `latest`) |
| `ALLOWED_ORIGINS` | Allowed frontend origins (CORS) |
| `LALA_ACCESS_PASSWORD` | Optional password for the whole server, at least 12 characters (`openssl rand -base64 18`) |
| `CSP_CONNECT_SRC` | CSP connect-src (default `wss: ws:`, tighten for prod) |

## Members, admins and permanent rooms

Without a config, everyone who reaches the server may create rooms, and each room's creator
moderates it. To name admins and members, set who may speak, share a screen or create rooms,
and keep rooms that always exist, copy [`config/lala.example.yaml`](../config/lala.example.yaml)
to `config/lala.yaml` and restart the `api` container. People are listed by the ID shown in
Settings → Profile; calls keep going through the restart.

## Look

`name:` in `config/lala.yaml` names the server at the top of the room list. `theme:` sets the
default look for people who haven't picked a theme: a built-in theme with some colors and
sizes changed (see the example file). It takes no CSS, so nothing the server sends can hide
the marks that tell people a bot is in the call or can hear it. Each person can still pick a
theme and add their own CSS in Settings → Appearance; that CSS stays on their device.
[Theming](theming.md) lists what CSS can change and how to add a theme.

## Bots

A bot is a program you run that joins calls through the [client API](api.md). Pick a key for
it (lowercase letters, digits, dashes) and make its credential:

```sh
docker compose exec api node dist/bot-secret.js radio
```

Give the printed credential to the bot and put the printed `secret:` line under `bots:` in
`config/lala.yaml`, with the rooms it may join (rooms from the same file) and its rights:
`speak`, `chat` and `listen`. Without `listen` the bot hears and sees nothing; people in the
call see an ear next to a bot that can. An `avatar:` is an image file in the config directory,
under 24 KB. Restart the `api` container to apply a change. Removing a bot, or a room from its
list, takes it out of those calls at the restart and voids the tokens it holds.

The bot's avatar, status line and commands reach the call through the LiveKit webhook
(`/api/webhook`), which `livekit.yaml.example` already configures.

## Private server

Set `LALA_ACCESS_PASSWORD` to keep the server to people you give the password to. Without it nobody
can list or create rooms or join a call, in the browser or the desktop app. An invite link copied
from the room list lets one person in without the password for 7 days. A device stays signed
in for 30 days of inactivity. Changing the password signs everyone out and voids all invite links. Wrong attempts are limited
to 10 per IP per 15 minutes.

## Ports

Open these to the internet; the web UI and signaling go through the reverse proxy.

| Port | Proto | What |
|------|-------|------|
| 7881 | TCP | ICE/TCP fallback |
| 50000 | UDP | Media |
| 3478 | UDP | TURN |
