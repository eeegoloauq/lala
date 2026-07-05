# API Package (`packages/api`)

Express server for token generation, room management, and admin actions. Uses `livekit-server-sdk` v2.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | `{ status: 'ok', service: 'lala-api' }` |
| POST | `/api/token` | HMAC-derived identity, password/ban check, returns `{ token, identity }` |
| GET | `/api/rooms` | List rooms |
| POST | `/api/rooms` | Create room (returns `adminSecret`) |
| DELETE | `/api/rooms/:id` | Delete room (requires `adminSecret` in body) |
| POST | `/api/rooms/:id/admin/kick` | Kick participant |
| POST | `/api/rooms/:id/admin/ban` | Ban participant |
| POST | `/api/rooms/:id/admin/mute` | Mute participant |
| POST | `/api/rooms/:id/admin/unban` | Unban participant |
| GET | `/api/rooms/:id/admin/bans` | List banned identities (`adminSecret` via `X-Admin-Secret` header) |
| GET | `/api/events` | SSE stream for room updates |

## Key Files

- `src/index.ts` -- Express setup: CORS, rate limiters, webhook (raw body), JSON parsing, routes, 404/error handlers, Redis init
- `src/routes/token.ts` -- receives `deviceId`, derives HMAC-stable identity; verifies password/ban; admin bypass via Redis
- `src/routes/rooms.ts` -- CRUD; room name sanitized (null bytes, RTL, control chars stripped); `maxParticipants` 1-100
- `src/routes/admin.ts` -- kick/ban/mute/unban; requires `adminSecret`; strips adminSecret before writing metadata
- `src/routes/events.ts` -- SSE endpoint
- `src/routes/webhook.ts` -- LiveKit webhook (signature-verified); broadcasts SSE; evicts Redis on `room_finished`
- `src/lib/roomMeta.ts` -- `RoomMeta` interface; `hashPassword`/`verifyPassword` (scrypt); `generateRoomId()` (16 hex, 64-bit entropy)
- `src/lib/auth.ts` -- `verifyAdminSecret()` (timingSafeEqual), `getAuthedRoom()` (Redis + LK metadata fallback)
- `src/lib/livekit.ts` -- `getRoomService()` lazy singleton; uses `LIVEKIT_HOST` for Docker, falls back to `localhost:7880`
- `src/lib/roomStore.ts` -- Redis cache: `cacheRoomMeta()`, `getCachedMeta()`, `evictRoomMeta()`. Key `lala:room:<roomId>`, TTL 24h

## Security Architecture

### Identity
- `POST /api/token` receives `deviceId` -> `hmac(sha256, apiSecret, deviceId).hex.slice(0,36)` = LiveKit identity
- Same device = same identity = LiveKit replaces old connection (no duplicates on refresh)

### Room Passwords
- Stored as scrypt hash in LiveKit room metadata (`passwordHash: "salt:hash"`). Plain text never stored.
- Password pool: client tries saved passwords automatically before prompting.
- Invite links: password in URL hash fragment (`#pw=...`).

### E2EE
- Enabled automatically for password-protected rooms via `ExternalE2EEKeyProvider`.
- Password = E2EE key (AES-GCM via WebCrypto). Server forwards encrypted streams.

### Admin
- `adminSecret`: 32 hex chars, stored only in Redis -- never in LiveKit metadata (would leak to participants).
- Actions: kick, ban (`bannedIdentities[]` in metadata), mute (`canPublish: false`).
- Broadcast via LiveKit data channel (`lala_admin` type).

### Rate Limiting
- `express-rate-limit` with 15s windows: token 25, rooms 30, admin 20, SSE 5.
- Nginx defense-in-depth: `limit_req` 10r/s burst=20.
- `X-Forwarded-For` overwritten by nginx with `$remote_addr`.

### Security Hardening
- CSP: `script-src 'self' 'unsafe-inline'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`.
- Global error handler: catches parse/size errors. No stack traces leaked.
- Input sanitization: null bytes, RTL/LTR overrides, control chars stripped.
- Headers: X-Content-Type-Options, X-Frame-Options, Referrer-Policy. X-Powered-By stripped.
