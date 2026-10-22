# API Package (`packages/api`)

Express server for token generation, room management, and admin actions. Uses `livekit-server-sdk` v2.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | `{ status, service }`; 503 while Redis is unavailable |
| POST | `/api/token` | password key and ban check, returns `{ token, identity, url, canModerate }` (`url` = `LIVEKIT_URL`) |
| GET | `/api/rooms` | List rooms, with `canModerate` for the caller |
| GET | `/api/rooms/:id` | One room (the client reads `passwordSalt` from it before joining) |
| POST | `/api/rooms` | Create a room, or get the live room that already has this name |
| DELETE | `/api/rooms/:id` | Delete room (moderator) |
| POST | `/api/rooms/:id/admin/{kick,ban,unban,mute}` | Moderation (moderator) |
| GET | `/api/rooms/:id/admin/bans` | Banned identities with their names (moderator) |
| GET | `/api/events` | SSE stream for room updates |
| GET | `/api/access` | `{ required, granted }`; renews a valid session cookie |
| POST | `/api/access` | `{ password }` or `{ invite }` -> sets the `lala_access` cookie |
| POST | `/api/access/invite` | `{ invite }`: 7-day stand-in for the password; needs a session |

With `LALA_ACCESS_PASSWORD` set, every route except health, webhook and access answers `401 access_required` without a valid cookie. The API does not start without Redis (`REDIS_URL`); locally, `e2e/redis.sh` runs one on port 6380.

## Key Files

- `src/index.ts` -- Express setup: CORS, rate limiters, webhook (raw body), JSON parsing, routes, 404/error handlers, Redis connection, stale-room sweep every 5 minutes
- `src/routes/token.ts` -- token with LiveKit grants from `permissionFor`; wrong-password limiter per IP and room
- `src/routes/rooms.ts` -- list (2s cache, single-flight), get, create-or-get by name, delete; `dropStaleRooms()`
- `src/routes/admin.ts` -- kick/ban/unban/mute for moderators; each success is logged and announced to the room by the server
- `src/routes/events.ts` -- SSE endpoint
- `src/routes/access.ts` -- optional instance password: `requireAccess` gate; stateless cookie `<expiry>.<hmac>` keyed from `LIVEKIT_API_SECRET` + password (changing either signs everyone out); invites are `<expiry>.<hmac>` under a separate label so they can't pass for cookies; fails startup if the password is under 12 chars or the secret is missing
- `src/routes/webhook.ts` -- LiveKit webhook (signature-verified); broadcasts SSE; drops room state on `room_finished`
- `src/lib/rooms.ts` -- room state in Redis: `RoomState`, name claim (Lua, atomic), bans, server mutes
- `src/lib/rights.ts` -- `isModerator()`, `permissionFor()` (what a participant may publish)
- `src/lib/identity.ts` -- `deriveIdentity()`, `callerIdentity()` from the `X-Lala-Device` header
- `src/lib/passwords.ts` -- scrypt hash of the client-derived room key
- `src/lib/livekit.ts` -- `getRoomService()`; `announceModeration()` on the `lala.moderation` data topic
- `src/lib/redis.ts` -- connection; `redisReady()` for health

## Security Architecture

### Identity
- The web client sends its private device UUID as `X-Lala-Device` on every request. The server derives the public identity `hmac(sha256, apiSecret, deviceId).hex.slice(0,36)`, which LiveKit shows to everyone. The device ID must never appear in a response.
- Same device = same identity = LiveKit replaces the old connection (no duplicates on refresh).

### Room state
- Redis is the only store: `lala:room-state:<id>` (JSON `RoomState`), `lala:room-bans:<id>` (hash identity -> name), `lala:room-muted:<id>` (set), `lala:room-name:<lowercased name>` -> id, `lala:rooms` (set of ids). LiveKit room metadata is not used.
- Live room names are unique; claiming a name and storing the room is one Lua script.
- State goes on `room_finished`; the sweep drops state LiveKit has no room for after a minute. LiveKit rooms without state are left to end on their own.

### Moderation
- The room creator moderates (`isModerator`). Authority comes from the caller's identity; there are no admin secrets.
- Rights are LiveKit grants (`canPublishSources`, `canPublishData`), so the media server enforces them. A server mute removes the microphone source live (`updateParticipant`) and is stored, so a rejoin keeps it.
- A ban stores the identity and removes the participant with `revokeTokenTs`, which invalidates tokens it already holds.
- Moderation events go out from the server on the `lala.moderation` topic; clients ignore that topic from participants.

### Room passwords and E2EE
- The client derives two keys from the password with PBKDF2 (200k) and HKDF, salted with the room's public `passwordSalt`: an auth key it sends, and the media E2EE key it keeps. The server stores scrypt of the auth key and never sees the password or the media key.
- Wrong keys are limited to 30 per IP and room per 15 minutes; the saved-password pool (20) fits in that.

### Rate Limiting
- `express-rate-limit` with 15s windows: token 25, room list 60, room create/delete 30, admin 20, SSE 5, access 30.
- Instance password: 10 failed attempts per IP per 15 min (successful ones don't count).
- Nginx defense-in-depth: `limit_req` 10r/s burst=20.
- `X-Forwarded-For` overwritten by nginx with `$remote_addr`.

### Security Hardening
- CSP is set by the web nginx (`packages/web/default.conf.template`), not the API: `script-src 'self'` with no inline scripts, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`.
- Global error handler: catches parse/size errors. No stack traces leaked.
- Input sanitization: null bytes, RTL/LTR overrides, control chars stripped.
- Headers: X-Content-Type-Options, X-Frame-Options, Referrer-Policy. X-Powered-By stripped.
