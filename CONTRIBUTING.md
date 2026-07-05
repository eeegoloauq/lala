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
| `packages/api` | Express — tokens, rooms, admin | `npm install && npm run dev` (:3001) |
| `packages/web` | Vite + React SPA | `npm install && npm run dev` (:3000) |
| `packages/desktop` | Electron wrapper | `npm install && npm start` |
| `packages/shared` | Types-only wire contract | consumed by api + web |

Changing an API response shape? Change it in `packages/shared` **first** —
api and web both consume it as a `file:` dependency.

For a full local stack (LiveKit, Redis) you'll also need Docker and the
`.env` described in the [README](README.md#setup); for most UI work,
`api` + `web` in dev mode against an existing LiveKit instance is enough.

## Testing your changes

There is no automated test suite yet, so the bar is: **verify with a real
call.** Open two browser tabs (or a tab + the desktop app), join the same
room, and check audio, video, and whatever you touched. If your change goes
anywhere near encryption or passwords, test in a password-protected room
specifically — that path uses E2EE and behaves differently.

Both `npm run build` (web) and `npm run build` (api, `tsc`) must pass —
the typecheck is the CI gate.

## Pull requests

- Keep changes small and focused — one topic per PR.
- Say in the PR description how you tested it (see above); screenshots or a
  short capture for UI changes are very welcome.
- For anything bigger than a fix, link the issue where we discussed it.

## What to expect

This project has a single maintainer working on it in spare time. Issues and
PRs get read, but a response can take a few days — that's normal, not a brush-off.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
