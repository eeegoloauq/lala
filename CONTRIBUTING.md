# Contributing to Lala

First off — thank you for considering a contribution! Bug reports from real
calls, UI fixes, and browser-compat findings are all genuinely useful.

## Reporting bugs

Open a [bug report](https://github.com/eeegoloauq/lala/issues/new/choose).
Real-time audio/video bugs are hard to reproduce, so the details matter:
where you hit it (the demo, your own instance, or the desktop app), the
browser and version, whether the room had a password (that switches on E2EE),
and anything from the browser console.

Security issues don't belong in the issue tracker — see [SECURITY.md](SECURITY.md).

## Suggesting features

Open an issue **before** writing code, especially for UI or media-pipeline
ideas — let's talk it over first so you don't spend an evening on something
that doesn't fit.

## Development setup

Lala is a monorepo with four packages:

| Package | What | Dev command |
|---|---|---|
| `packages/api` | Express — tokens, rooms, admin | `npm ci && npm run dev` (:3001) |
| `packages/web` | Vite + React SPA | `npm ci && npm run dev` (:3000) |
| `packages/desktop` | Electron wrapper | `npm ci && npm start` |
| `packages/shared` | Types-only wire contract | consumed by api + web |

Changing an API response shape? Change it in `packages/shared` **first** —
api and web both consume it as a `file:` dependency.

The API keeps room state in Redis and won't start without it: `e2e/redis.sh`
and `e2e/livekit.sh` run the versions production uses on 6380 and 7880. Then
start the API with `REDIS_URL=redis://127.0.0.1:6380`, `LIVEKIT_URL=ws://127.0.0.1:7880`
and the key pair from `e2e/livekit-e2e.yaml` as `LIVEKIT_API_KEY` /
`LIVEKIT_API_SECRET`.

## Testing your changes

`e2e/` runs a two-person call in headless Chromium against a local LiveKit,
the API and the production web build. It covers the server password, a
password-protected room (E2EE), audio both ways, camera with background blur,
chat, screen share and the room creator's mute, kick, ban and delete:

```bash
cd e2e && npm ci && npm run setup && npm test
```

It downloads the LiveKit server version production uses on first run.
`npm run test:desktop` in `e2e/` runs the same call in the desktop app on
Linux/X11. For the rest (Windows, macOS, Wayland, real devices), open two
browser tabs or a tab and the desktop app, join the same room and check what
you touched. Changes near encryption or passwords need a
password-protected room: that path uses E2EE and behaves differently.

Both `npm run build` (web) and `npm run build` (api, `tsc`) must pass —
the typecheck is the CI gate.

## Translations

The app's text is in `packages/web/src/locales/`, one JSON file per language. To add one:

1. Copy `en.json` to the language code, such as `de.json` or `pt-BR.json`, and translate the
   values. Keep the keys and every `{{placeholder}}` as they are.
2. Plurals follow the language's own forms: English has `_one` and `_other`, Russian adds
   `_few` and `_many` (see `ru.json`). [i18next](https://www.i18next.com/translation-function/plurals)
   lists the forms per language.
3. Run `npm run lint` in `packages/web`. It reports missing or unknown keys and placeholders
   that differ from English.
4. Add a block for the language to `packages/desktop/strings.js` for the desktop app's own
   text: the connection page, tray and edit menu.

The language appears in Settings → Appearance under its own name, with no code change.
A key missing from a file shows in English. Right-to-left languages switch the page direction.

## Pull requests

- Keep changes small and focused — one topic per PR.
- Say in the PR description how you tested it (see above); screenshots or a
  short capture for UI changes are very welcome.
- For anything bigger than a fix, link the issue where we discussed it.

## What to expect

This project has a single maintainer working on it in spare time. Issues and
PRs get read, but a response can take a few days — that's normal, not a brush-off.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Dependency overrides

The web and desktop packages override only `minimatch` versions affected by
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) to patched v11.
The v3/v5 dependencies keep their existing API. Remove this override when the parent
packages require patched versions themselves. Check web lint/build, desktop packaging
and call tests when updating it; a clean audit alone does not establish compatibility.
The desktop `undici` overrides retain separate v6 and v7 lines for their consumers.
