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
`GET /api/me` returns the caller's identity and role, and the server's name.

Without the header, `/api/token` and creating rooms fail with `identity_required`. A room ban
also covers the address the banned person last came from, for the room's lifetime, so a new
device ID doesn't lift it; moderators and bots are exempt from the address check.

### Avatars

| Request | Body | Result |
|---|---|---|
| `POST /api/me/avatar` | the image, `Content-Type: image/jpeg`, `image/png` or `image/webp`, at most 24 KB | `{ avatar: <version> }`; `400 invalid_image` for anything else |
| `DELETE /api/me/avatar` | | `204` |
| `GET /api/avatars/:identity?v=<version>` | | The image; `404` without one |

The version is a hash of the image, so a URL with it never changes its content and is cached
for good. `GET /api/me` (as `avatar`) and `RoomInfo.participants` carry each person's version.
A bot's avatar comes from the config and is served the same way. The server drops an avatar
nobody has used for 90 days; a client keeps its own copy and uploads it again when `/api/me`
has none. Every change sends `rooms_updated`.

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
| `GET /api/bot/events` | | Server-sent events: `invited` (`BotInvitedEvent`) and `removed` (`BotRemovedEvent`) |
| `DELETE /api/rooms/:id/bots/me` | | Leaves a room it was added to, for good |

A bot joins with `POST /api/token` like anyone else, into the rooms its entry lists and the
rooms people added it to, and password rooms still need the room key. Its token:

- carries the name from the config, whatever `name` the request sends;
- lets it publish the microphone with `speak` and send data (chat, files) with `chat`, never
  camera or screen;
- lets it subscribe to tracks only with `listen`; chat reaches it either way;
- does not let it change its own name, metadata or attributes, and is never `hidden`.

A bot never moderates or creates rooms and can't make server invites. Moderators can mute,
kick and ban it as they would a person, but not give it the floor.

### Adding a bot to a room

A bot whose entry has `invite:` can be added to any room without a password by the people
that level names (a room's creator counts as an admin there). The bot keeps
`GET /api/bot/events` open; while it does, it is online and can be added. On connect the stream
sends `invited` for each room it was already added to, so a bot that restarts finds its rooms
again. On `invited` it joins with `POST /api/token`; on `removed` (it was removed, or the room
ended) it leaves. A bot that drops and reconnects keeps its invitation. A bot that leaves for
good calls `DELETE /api/rooms/:id/bots/me`, and the room sees "Y left".

| Request | Body | Result |
|---|---|---|
| `GET /api/rooms/:id/bots` | | `{ bots: RoomBot[] }`: the bots the caller may add here |
| `POST /api/rooms/:id/bots/:key` | | `201` added, `200` already added (the bot is asked to join again); `409 bot_offline`, `409 password_room` |
| `DELETE /api/rooms/:id/bots/:key` | | Removes it from the call and ends the invitation; for whoever added it and moderators |

Only someone in the call adds to it. The invitation lasts the room's lifetime. Kicking or
banning an added bot also ends its invitation. `RoomInfo.addedBots` lists who added which bot,
and `RoomInfo.canAddBots` says whether the caller may add any. The server announces
`added`, `removed` and `left` on `lala.moderation`.

Password rooms can't have added bots yet: the bot would need the media key, which the server
never has. The config takes a `publicKey:` per bot for that already; it is not used yet.

### Cards

A bot can attach a card to a chat message: the `lala.card` attribute of the `lk.chat` text
stream, JSON `BotCard` with a title (at most 60 characters), an optional line (at most 120) and
an icon from `BotCardIcon`. Send the message text with it, which older clients and read-aloud
use. Clients show cards only from `bot-` identities and never load remote images. Cards are not
edited or deleted; put what changes in the status line.

The server sets the bot's attributes when it joins and on every profile change:
`lala.bot-status` (at most 100 characters) and
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
never sees it. Turn encryption on before connecting: with livekit-client, pass the key provider
as `encryption` (which also covers chat and files) and call `room.setE2EEEnabled(true)`; a key
provider alone publishes unencrypted. The reference implementation is
[`packages/web/src/lib/roomKeys.ts`](../packages/web/src/lib/roomKeys.ts). Wrong keys are
limited to 30 per 15 minutes per IP and room.

## In the call

| Channel | Name | Set by | Content |
|---|---|---|---|
| Attribute | `lala.hand` | the participant | `1` while asking for the floor |
| Attribute | `lala.server-muted`, `lala.voice` | server | `1` or empty |
| Attribute | `lala.bot-status`, `lala.bot-commands` | server, on bots | See [Bots](#bots) |
| Metadata | `{ "deafened": true }` | the participant | JSON |
| Text stream | `lk.chat` | the participant | Chat message, as sent by LiveKit's `useChat`; a bot's may carry `lala.card` (see [Cards](#cards)) |
| Byte stream | `files` | the participant | File transfer |
| Data | `lala.moderation` | server | `ModerationEvent` JSON, also when a bot is added, removed or leaves |

Clients ignore `lala.moderation` messages from anyone but the server.

## Moderation

`POST /api/rooms/:id/admin/{kick,ban,unban,mute,voice}` and `GET /api/rooms/:id/admin/bans`,
for the room's creator and server admins. Bodies are `ModerationRequest`, `MuteRequest` and
`VoiceRequest`. Server admins also have `GET /api/admin/bans` and
`POST /api/admin/{ban,unban}` for server-wide bans.

## Errors and limits

Errors are `{ error: <code> }` with a code from `ApiErrorCode`. Rate limits return `429`
with `RateLimit-*` headers and no body code. Request bodies are limited to 16 KB.
