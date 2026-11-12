# Self-hosting

You need a Linux server with a public IP, Docker, and two domains pointing at it: one for the
app (`lala.example.com`) and one for calls (`rtc.example.com`).

## Setup

1. Point both domains at the server's IP.

2. Get Lala, run the setup and start it. The setup asks for the domains and makes every key
   and password in `.env`:

   ```bash
   git clone https://github.com/eeegoloauq/lala.git && cd lala
   ./setup.sh
   docker compose up -d
   ```

3. Open these ports in the firewall: 80, 443 and 7881 (TCP), 3478 and 50000 (UDP).

4. Put a reverse proxy with HTTPS in front. The setup prints a [Caddy](https://caddyserver.com/)
   config for your domains:

   ```
   lala.example.com {
       reverse_proxy 127.0.0.1:3000
   }
   rtc.example.com {
       reverse_proxy 127.0.0.1:7880
   }
   ```

5. Open `https://lala.example.com`.

6. Make yourself admin: `cp config/lala.example.yaml config/lala.yaml`, put your ID from
   Settings → Profile under `users:`, and run `docker compose restart api`.

To update: `docker compose pull && docker compose up -d`.

## Config

`config/lala.yaml` sets who may do what, rooms, text chats and more. Every option is explained in
[`config/lala.example.yaml`](../config/lala.example.yaml). Without the file the server is open
to everyone and has no admins. After a change, run `docker compose restart api`; calls keep going.

If your reverse proxy limits upload size (nginx does, Caddy doesn't), raise it for files sent in
text chats.

## Private server

Set `LALA_ACCESS_PASSWORD` in `.env` (at least 12 characters) and run `docker compose up -d`.
Only people with the password, or an invite link copied from a room, can get in.

## Bots

1. Make a credential: `docker compose exec api node dist/bot-secret.js radio`
2. Give the credential to the bot, and put the printed `secret:` line under `bots:` in
   `config/lala.yaml` with its rooms and rights.
3. Run `docker compose restart api`.

[`examples/bots`](../examples/bots) has a bot to start from; the [client API](api.md) has the rest.

## Reference

`./setup.sh` writes `.env`; to write it yourself, start from [`.env.example`](../.env.example).
The LiveKit key and secret are made up, not signed up for: any name and a long random string.

| `.env` variable | What |
|----------|------|
| `NODE_IP` | The server's public IP |
| `LIVEKIT_URL` | `wss://rtc.example.com` |
| `LIVEKIT_DOMAIN` | `rtc.example.com` |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | A name of letters and digits / 32+ random characters |
| `REDIS_PASSWORD` | Letters and digits |
| `ALLOWED_ORIGINS` | `https://lala.example.com` |
| `LALA_REGISTRY` / `LALA_TAG` | Where images come from: `ghcr.io/eeegoloauq`, and `latest` or a version |
| `LALA_ACCESS_PASSWORD` | Optional, see [Private server](#private-server) |
| `CSP_CONNECT_SRC` | Optional: `wss://rtc.example.com` to allow only your LiveKit |
| `LALA_MAX_EVENT_STREAMS` | Optional: how many people can be online at once (1000) |
| `LALA_MAX_EVENT_STREAMS_PER_IP` | Optional: open apps from one address (20) |

| Port | Protocol | For |
|------|-------|------|
| 80, 443 | TCP | Reverse proxy |
| 7881 | TCP | Calls, when UDP is blocked |
| 50000 | UDP | Call audio and video |
| 3478 | UDP | TURN, for people behind strict networks |
