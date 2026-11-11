# Client API (v1)

The HTTP API the web and desktop clients use, and what a third-party client or bot needs to
join a call. Media goes through LiveKit; this API issues the LiveKit token and holds room state.
Wire types are in [`packages/shared/index.d.ts`](../packages/shared/index.d.ts).

Breaking changes to anything on this page are listed in the release notes.

## Identity

Every request carries `X-Lala-Device: <device ID>`, a random string of up to 100 characters
that the client generates once and keeps. The device ID is a credential: anyone holding it acts
as that device. The server turns it into a public identity (an HMAC under the LiveKit secret),
which is what other participants see and what the [server config](self-hosting.md) lists.
`GET /api/me` returns the caller's identity and role.

Without the header, `/api/token` issues a one-off identity, and creating rooms fails with
`identity_required`.

## Server password

When the server has `LALA_ACCESS_PASSWORD`, every endpoint except `/api/health` and
`/api/access` answers `401 access_required` until the client has a session.

| Request | Body | Result |
|---|---|---|
| `GET /api/access` | | `{ required, granted }` |
| `POST /api/access` | `{ password }` or `{ invite }` | Sets the `lala_access` cookie (HttpOnly, 30 days, renewed daily while used) |
| `POST /api/access/invite` | | `{ invite }`, valid for 7 days |

Send the cookie back on every request. Failed attempts are limited to 10 per 15 minutes per IP.

## Rooms

| Request | Body | Result |
|---|---|---|
| `GET /api/rooms` | | `{ rooms: RoomInfo[] }`, cached for 2 s |
| `GET /api/rooms/:id` | | `RoomInfo` |
| `POST /api/rooms` | `CreateRoomRequest` | `201` with the new room, or `200` with a live room of that name |
| `DELETE /api/rooms/:id` | | `{ ok: true }`; moderators only, not for configured rooms |
| `GET /api/events` | | Server-sent events; `rooms_updated` when rooms or participants change |

`RoomInfo.canJoin` and `canModerate` describe the caller. A room with `passwordSalt` has a
password and uses end-to-end encryption.

## Joining a call

`POST /api/token` with `{ room, name?, passwordKey? }` returns `{ token, url, identity,
canModerate }`. Connect a LiveKit client to `url` with `token`. The token's grants carry the
caller's rights in that room (speak, video, screen, chat), and LiveKit enforces them.

### Password rooms

The password never leaves the client. Derive two keys from it and the room's `passwordSalt`:

1. `master` = PBKDF2-SHA256(password, salt as UTF-8 bytes, 200 000 iterations, 32 bytes)
2. `authKey` = HKDF-SHA256(master, empty salt, info `lala room auth`, 32 bytes), base64
3. `e2eeKey` = HKDF-SHA256(master, empty salt, info `lala room e2ee`, 32 bytes)

Send `authKey` as `passwordKey`. Use `e2eeKey` as the LiveKit shared E2EE key; the server
never sees it. The reference implementation is
[`packages/web/src/lib/roomKeys.ts`](../packages/web/src/lib/roomKeys.ts). Wrong keys are
limited to 30 per 15 minutes per IP and room.

## In the call

| Channel | Name | Set by | Content |
|---|---|---|---|
| Attribute | `lala.avatar` | the participant | JPEG data URL, at most 32 KB; empty clears it |
| Attribute | `lala.hand` | the participant | `1` while asking for the floor |
| Attribute | `lala.server-muted`, `lala.voice` | server | `1` or empty |
| Metadata | `{ "deafened": true }` | the participant | JSON |
| Text stream | `lk.chat` | the participant | Chat message, as sent by LiveKit's `useChat` |
| Byte stream | `files` | the participant | File transfer |
| Data | `lala.moderation` | server | `ModerationEvent` JSON |

Clients ignore `lala.moderation` messages from anyone but the server.

## Moderation

`POST /api/rooms/:id/admin/{kick,ban,unban,mute,voice}` and `GET /api/rooms/:id/admin/bans`,
for the room's creator and server admins. Bodies are `ModerationRequest`, `MuteRequest` and
`VoiceRequest`. Server admins also have `GET /api/admin/bans` and
`POST /api/admin/{ban,unban}` for server-wide bans.

## Errors and limits

Errors are `{ error: <code> }` with a code from `ApiErrorCode`. Rate limits return `429`
with `RateLimit-*` headers and no body code. Request bodies are limited to 16 KB.
