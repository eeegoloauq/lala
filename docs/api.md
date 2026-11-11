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

## Bots

A bot account sends `Authorization: Bearer <credential>` on every request instead of
`X-Lala-Device`. The admin makes the credential (see [self-hosting](self-hosting.md#bots)); it
is `<key>.<secret>`, and the bot's identity is `bot-<key>`. A valid credential stands in for the
server password; a wrong one answers `401 invalid_bot_credential`, and after 10 wrong ones in
15 minutes an IP gets `429`.

| Request | Body | Result |
|---|---|---|
| `GET /api/bot` | | `BotInfo`: identity, name, rooms, rights, status and commands |
| `POST /api/bot/profile` | `BotProfile`, fields optional | The stored `BotProfile` |

A bot joins with `POST /api/token` like anyone else, only into the rooms its entry lists, and
password rooms still need the room key. Its token:

- carries the name from the config, whatever `name` the request sends;
- lets it publish the microphone with `speak` and send data (chat, files) with `chat`, never
  camera or screen;
- lets it subscribe to tracks only with `listen`; chat reaches it either way;
- does not let it change its own name, metadata or attributes, and is never `hidden`.

A bot never moderates or creates rooms and can't make server invites. Moderators can mute,
kick and ban it as they would a person, but not give it the floor.

The server sets the bot's attributes when it joins and on every profile change:
`lala.avatar` (from the config), `lala.bot-status` (at most 100 characters) and
`lala.bot-commands` (JSON `BotCommand[]`: at most 20, each named `!` plus 1 to 24 of `a-z`,
`0-9`, `_`, `-`, with a description of at most 80 characters). Clients read these and mark a
participant as a bot only for identities starting with `bot-`. `RoomInfo.listeningParticipants`
lists the bots in a room that can listen.

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
| Attribute | `lala.avatar`, `lala.bot-status`, `lala.bot-commands` | server, on bots | See [Bots](#bots) |
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
