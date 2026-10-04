# Roadmap

Larger work that shouldn't be done in passing. Remove an item when it ships.

- **Critical path tests.** `e2e/` covers the server password and a two-person call. Still missing: room admin actions (kick, ban, mute, delete need Redis), screen share, and running `e2e` in CI.
- **Desktop main process.** Split the combined window, IPC, updater and tray responsibilities in `packages/desktop/main.js`.
- **Connection translations.** Consolidate duplicated locale text in `packages/desktop/connection.js` and `packages/web/src/locales/`.
