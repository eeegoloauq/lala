# Design

## Maintenance

Internal work that shouldn't be done in passing. Remove an item when it ships.

Nothing open.

## Dependency overrides

Web and desktop override `minimatch` to patched v11 for
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249); drop it once the
parents require a patched version. Desktop keeps separate `undici` v6 and v7 overrides. After
changing either, run web lint and build, desktop packaging and the call tests.

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

- A per-bot `invite:` setting (`everyone`, `members` or `admins`) lets people add the bot to
  any room without a password. "Add bot" is the last row under the room's people; it lists the
  bots this room may have and calls `POST /api/rooms/:id/bots/:key`. The server checks the
  setting and records the invitation and the inviter in Redis for the room's lifetime.
- The bot keeps `GET /api/bot/events` open (server-sent events) with its credential and gets
  invited and removed events. It then joins through `POST /api/token` as now; the token check
  accepts a room the bot is configured for or invited into. The bot dials out, so it needs no
  open port or webhook URL, as with Discord's gateway or Slack's Socket Mode.
- LiveKit agent dispatch is not used: its workers need the LiveKit API secret, which gives
  full control of the media server.
- The room sees "X added Y". Before adding a bot with `listen`, the inviter confirms that it
  will hear everyone in the call. The inviter or a moderator removes the bot; it is a kick and
  ends the invitation.
- A bot that drops reconnects without a chat line, like a person. A bot that leaves for good
  ends its own invitation with `DELETE /api/rooms/:id/bots/me`, and the room sees "Y left".
- Status is what the bot does now: one line on its tile and profile, updated in place, with no
  running clock (the profile shows when it joined). A card is a chat reply to a command: title,
  one line and an icon from Lala's set, sent beside a plain-text message that older clients and
  read-aloud use. Cards are never edited or deleted, so a music bot shows the current song in
  its status and posts a card only when someone queues one. Clients check the card's lengths;
  no remote images, which would show viewers' addresses to another site.
- Password rooms come later. The bot needs the media key, which the server never sees. Each
  bot gets a key pair with the public key in `lala.yaml`, and the inviter's client encrypts
  the room key to it; the server only relays the result. Add the public key to the config
  shape in the first version so this needs no config change later.

Build it when a real bot needs rooms the config does not list.
