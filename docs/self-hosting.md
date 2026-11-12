# Self-hosting

**Requirements:** a Linux server with Docker and a public IP, and two domains for it: one for
the app (`lala.example.com`) and one for calls (`rtc.example.com`).

## Install

```bash
git clone https://github.com/eeegoloauq/lala.git && cd lala
./setup.sh
docker compose up -d
```

`setup.sh` asks for the domains and whether the server should have a password, and writes
`.env` with new keys. At the end it prints a link that makes you the server's admin; it works
once. To write `.env` by hand instead, start from [`.env.example`](../.env.example).

## HTTPS

Lala serves plain HTTP on `127.0.0.1:3000` (the app) and `127.0.0.1:7880` (calls). Put a reverse
proxy with HTTPS in front, for example [Caddy](https://caddyserver.com/):

```
lala.example.com {
    reverse_proxy 127.0.0.1:3000
}
rtc.example.com {
    reverse_proxy 127.0.0.1:7880
}
```

With nginx, raise `client_max_body_size` so files can be sent in text chats.

## Firewall

| Port | For |
|---|---|
| 80, 443/tcp | The reverse proxy |
| 50000/udp | Call audio and video |
| 3478/udp | TURN, for people behind strict networks |
| 7881/tcp | Calls where UDP is blocked |

## Update

```bash
git pull && docker compose pull && docker compose up -d
```

## Admins, rooms and text chats

Copy [`config/lala.example.yaml`](../config/lala.example.yaml) to `config/lala.yaml`; every
option is explained in it. More admins and members go under `users:`, by the ID from
Settings → Profile. Apply changes with `docker compose restart api`; calls keep going.

Without the file the server is open to everyone.

## Bots

```bash
docker compose exec api node dist/bot-secret.js radio
```

The bot gets the printed credential, and the printed `secret:` line goes under `bots:` in
`config/lala.yaml`. [`examples/bots`](../examples/bots) has a bot to start from; the
[client API](api.md) has the rest.

## `.env`

| Variable | What |
|---|---|
| `NODE_IP` | The server's public IP |
| `LIVEKIT_URL`, `LIVEKIT_DOMAIN` | `wss://rtc.example.com`, `rtc.example.com` |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Any name and a random secret of 32+ characters; LiveKit and the API share them |
| `REDIS_PASSWORD` | Letters and digits |
| `ALLOWED_ORIGINS` | `https://lala.example.com` |
| `LALA_REGISTRY`, `LALA_TAG` | Where images come from: `ghcr.io/eeegoloauq`, and `latest` or a version |
| `LALA_ACCESS_PASSWORD` | Optional: one password for the whole server, 12+ characters. Invite links copied from a room let people in without it |
| `LALA_ADMIN_CLAIM` | Optional: the token in the admin link from `setup.sh`; it does nothing once the server has an admin |
| `CSP_CONNECT_SRC` | Optional: `wss://rtc.example.com` to allow only your LiveKit |
| `LALA_MAX_EVENT_STREAMS` | Optional: how many people can be online at once (1000) |
| `LALA_MAX_EVENT_STREAMS_PER_IP` | Optional: open apps from one address (20) |

After changing `.env`, run `docker compose up -d`.
