# Roadmap

## Next

In this order; each builds on the one before.

1. **Presence and the people list.** The server learns who has the app open, not only who is
   in a call: the event stream gets a short-lived signed ticket from a request that carries
   the device ID (`EventSource` can't send headers), and open streams are kept in Redis with
   a 30-second heartbeat, so a closed tab drops out by itself and more than one API instance
   would agree. A panel on the right lists everyone online, grouped "In a call" and "Online".
2. **Server chat and mentions.** One chat for the whole server, readable by anyone with access,
   in or out of a call. Like everything the server keeps, it can be lost: the last 200
   messages for 24 hours. `@name` in any chat notifies the person mentioned when they are
   online (desktop notification, badge on the room).
3. **Moving people and an AFK room.** Moderators drag someone into another room; the server
   gives the client a token for it and the client switches. An AFK room from the config, where
   people idle for a set time are moved with their microphone off.
4. **Pinned rooms.** An admin pins a room someone created so it stays when empty, with its
   bans, stored like the rooms from the config.

## Later

- Bots in password rooms ([design](docs/design.md#adding-a-bot-to-a-room))
- Timed bans and handing over a room
- An identity that isn't lost with the browser's storage: export it, or link a second device

Maintenance work is in the [design notes](docs/design.md#maintenance).
