# Roadmap

## Next

In this order; each builds on the one before.

1. **Server chat and mentions.** One chat for the whole server, readable by anyone with access,
   in or out of a call. Like everything the server keeps, it can be lost: the last 200
   messages for 24 hours. `@name` in any chat notifies the person mentioned when they are
   online (desktop notification, badge on the room).
2. **An AFK room.** From the config: people idle for a set time are moved there with their
   microphone off, using the move moderators already have.
3. **Pinned rooms.** An admin pins a room someone created so it stays when empty, with its
   bans, stored like the rooms from the config.

## Later

- Bots in password rooms ([design](docs/design.md#adding-a-bot-to-a-room))
- Timed bans and handing over a room
- An identity that isn't lost with the browser's storage: export it, or link a second device

Maintenance work is in the [design notes](docs/design.md#maintenance).
