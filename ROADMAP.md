# Roadmap

Larger work that shouldn't be done in passing. Remove an item when it ships.

- **Critical path tests.** Add behavioral coverage for authentication, room management and media calls; the package scripts currently provide no test suite (`packages/api`, `packages/web`, `packages/desktop`).
- **Desktop main process.** Split the combined window, IPC, updater and tray responsibilities in `packages/desktop/main.js`.
- **Connection translations.** Consolidate duplicated locale text in `packages/desktop/connection.js` and `packages/web/src/locales/`.
- **Stale package guidance.** Correct the inline-script CSP claim in `packages/api/CLAUDE.md` against `packages/web/default.conf.template`.
- **First-entry flow.** Add a visible submission control to the display-name entry in `packages/web/src/App.tsx`; it currently relies on Enter.
