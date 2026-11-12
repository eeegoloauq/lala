# Design

## Maintenance

Internal work that shouldn't be done in passing. Remove an item when it ships.

Nothing open.

## Dependency overrides

Web and desktop override `minimatch` to patched v11 for
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249); drop it once the
parents require a patched version. Desktop keeps separate `undici` v6 and v7 overrides. After
changing either, run web lint and build, desktop packaging and the call tests.

## Presence

- The people list needs to know who has the app open, not only who is in a call. Each open
  app holds the event stream, so that is where presence lives. `EventSource` can't send the
  `X-Lala-Device` header, and the device ID must not go into a URL, so the client trades it
  for a ticket (`<identity>.<expiry>.<hmac>`, 5 minutes, signed with a key from
  `LIVEKIT_API_SECRET`) that names only the public identity.
- A stream alone doesn't show that an app is gone: writes to a computer that went to sleep
  keep succeeding until TCP gives up. So the client also sends its status every 30 seconds,
  and Redis keeps online identities in a sorted set (`lala:presence:online`) scored by when
  they lapse, 2.5 minutes after the last beat. That leaves room for background tabs, which
  browsers throttle to about one timer a minute. A closed stream removes its identity after
  a 5-second grace, so a reconnect doesn't flicker, and only when no other tab of it is
  open on this instance. Several API instances agree on who is online; the
  `presence_updated` event is sent only by the instance that saw the change, like
  `rooms_updated`.
- The last name and status stay for 90 days (`lala:presence:<identity>`), so a member who is
  offline is listed under the name they used. Members come from the config, grouped by their
  key, so someone with several devices is one row. Guests appear only while online.
- Idle is the client's: 10 minutes without input, from the system's idle time in the desktop
  app (input in other programs counts) and from input in the page in a browser. Speaking in
  a call counts as input.

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

### Adding a bot to a room

Besides the rooms listed for it in `lala.yaml`, a bot can be added to any room by the people
its config allows, including rooms they created, while the server keeps the say:

- A per-bot `invite:` setting (`everyone`, `members` or `admins`, ranked as room rights, so a
  creator counts as an admin in their own room) lets people add the bot to any room without a
  password. "Add bot" is the last row under the room's people; it lists the bots this room may
  have and calls `POST /api/rooms/:id/bots/:key`. The server checks the setting and that the
  inviter is in the call, and records the invitation and the inviter in Redis for the room's
  lifetime.
- The bot keeps `GET /api/bot/events` open (server-sent events) with its credential and gets
  invited and removed events; a bot without the stream open shows as offline and can't be
  added. It then joins through `POST /api/token`; the token check accepts a room the bot is
  configured for or invited into. The bot dials out, so it needs no open port or webhook URL,
  as with Discord's gateway or Slack's Socket Mode. The stream lives in the API process and the
  invitation in Redis, so a restarted API re-sends invitations when the bot reconnects.
- LiveKit agent dispatch is not used: its workers need the LiveKit API secret, which gives
  full control of the media server.
- The room sees "X added Y", announced by the server. Before adding a bot with `listen`, the
  inviter confirms that it will hear everyone in the call. The inviter or a moderator removes
  the bot; it is a kick with token revocation and ends the invitation. A moderator's plain
  kick or ban of an added bot ends it too.
- A bot that drops reconnects like a person. A bot that leaves for good ends its own
  invitation with `DELETE /api/rooms/:id/bots/me`, and the room sees "Y left".
- The inviter's client shows a joining tile until the bot arrives and "didn't join" after 20
  seconds, with Try again (the server asks the bot again) and Dismiss (which ends the
  invitation, so the bot doesn't turn up later unasked).
- Status is what the bot does now: one line on its tile and profile, updated in place, with no
  running clock (the profile shows when it joined). A card is a chat reply to a command: title,
  one line and an icon from Lala's set, sent as the `lala.card` attribute beside a plain-text
  message that older clients and read-aloud use. Cards are never edited or deleted, so a music
  bot shows the current song in its status and posts a card only when someone queues one.
  Clients check the card's lengths; no remote images, which would show viewers' addresses to
  another site.
- `examples/bots/dice.mjs` is a working bot on LiveKit's Node SDK, and the e2e suite runs it.

Password rooms come later. The bot needs the media key, which the server never sees. Each bot
gets a key pair with the public key in `lala.yaml`, and the inviter's client encrypts the room
key to it; the server only relays the result. The config already takes `publicKey:`, so this
needs no config change.
