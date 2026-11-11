# Design

## Maintenance

Internal work that shouldn't be done in passing. Remove an item when it ships.

- **Connection translations.** Consolidate duplicated locale text in `packages/desktop/connection.js` and `packages/web/src/locales/`.
- **Desktop renderer crash.** After `render-process-gone` the window stays black until the app
  is restarted (seen on Linux with an NVIDIA driver mapping failure). Reload the window and
  show a notice, with a limit so a crash loop stops.

## Bots

A bot is a separate program that joins a call through the [client API](api.md), like any
other client. Lala does not load plugins into the server or the clients, so a bot can do no
more than its token allows. Bot accounts (set up as in [self-hosting](self-hosting.md#bots)):

- The admin defines each bot in `lala.yaml` with a hashed secret. Removing the entry revokes it.
- The server gives a bot an identity starting with `bot-`. The bot cannot change it, and
  clients show a BOT badge next to it.
- Name and avatar come from the config; the bot cannot change its own.
- Rights per bot: which rooms, speak, chat and listen. A bot never moderates, creates rooms
  or gets the `hidden` grant.
- Listen is off by default. Without it LiveKit does not let the bot subscribe to anyone's
  audio or video. Clients mark a bot that can listen.
- Chat reaches every participant in the room, bots included; LiveKit has no grant to stop
  that. The chat right only controls whether the bot can send.
- The bot secret stands in for the server password. A password room still needs the room
  password, because the bot needs the media key to speak in an encrypted call.

### Planned: adding a bot to a room

Not built yet. Today a bot joins only the rooms listed for it in `lala.yaml`. The plan lets
people add a bot to any room, including rooms they created, while the server keeps the say:

- A per-bot `invite:` setting (`everyone`, `members` or `admins`) and `rooms: any` to allow
  created rooms. An "Add bot" control in the room header lists the bots this room may have
  and calls `POST /api/rooms/:id/bots/:key`. The server checks the setting and records the
  invitation in Redis for the room's lifetime.
- The bot keeps `GET /api/bot/events` open (server-sent events) with its credential and gets
  invited and removed events. It then joins through `POST /api/token` as now; the token check
  accepts a room the bot is configured for or invited into. The bot dials out, so it needs no
  open port or webhook URL, as with Discord's gateway or Slack's Socket Mode.
- LiveKit agent dispatch is not used: its workers need the LiveKit API secret, which gives
  full control of the media server.
- The room sees "X added Y". Before adding a bot with `listen`, the inviter confirms that it
  will hear everyone in the call. A moderator removes the bot with the existing kick, which
  also ends the invitation.
- Password rooms come later. The bot needs the media key, which the server never sees. Each
  bot gets a key pair with the public key in `lala.yaml`, and the inviter's client encrypts
  the room key to it; the server only relays the result. Add the public key to the config
  shape in the first version so this needs no config change later.

Build it when a real bot needs rooms the config does not list.
