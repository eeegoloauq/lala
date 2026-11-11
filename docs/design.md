# Design

## Maintenance

Internal work that shouldn't be done in passing. Remove an item when it ships.

- **Connection translations.** Consolidate duplicated locale text in `packages/desktop/connection.js` and `packages/web/src/locales/`.

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

## Planned interface work

Agreed from the [bot prototype](prototypes/bots.html). Remove an item when it ships.

- **Themes:** each theme in its own file. A theme is colors and sizes plus optional CSS, so
  Windows XP keeps its rules. Users can add their own CSS in the client; it stays on their
  device. A server default theme in `lala.yaml` takes colors and sizes only, because CSS sent to
  every client could hide the BOT badge or the listening icon.
- **App icon:** one icon. The icon picker and its variants go; the dark sphere design is kept
  in `docs/archive/`.
