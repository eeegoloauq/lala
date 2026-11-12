# Contributing to Lala

## Bugs and ideas

Open a [bug report](https://github.com/eeegoloauq/lala/issues/new/choose) with your browser or
the desktop app, whether the room had a password, and the console output. For a feature, open
an issue before writing code. Security issues go to [SECURITY.md](SECURITY.md).

## Run it

| Package | Command |
|---|---|
| [`packages/api`](packages/api) | `npm ci && npm run dev` (port 3001) |
| [`packages/web`](packages/web) | `npm ci && npm run dev` (port 3000) |
| [`packages/desktop`](packages/desktop) | `npm ci && npm start` |

The API needs Redis and LiveKit: run [`e2e/redis.sh`](e2e/redis.sh) and
[`e2e/livekit.sh`](e2e/livekit.sh), then start it with `REDIS_URL=redis://127.0.0.1:6380`,
`LIVEKIT_URL=ws://127.0.0.1:7880` and the keys from [`e2e/livekit-e2e.yaml`](e2e/livekit-e2e.yaml).
API response types live in [`packages/shared`](packages/shared/index.d.ts).

## Test

```bash
cd e2e && npm ci && npm run setup && npm test
```

`npm run build` must pass in `packages/api` and `packages/web`. Changes near passwords need a
call in a password room.

## Translations

Copy [`packages/web/src/locales/en.json`](packages/web/src/locales/en.json) to your language code
and translate the values. Do the same in [`packages/desktop/locales/`](packages/desktop/locales).
`npm run lint` in `packages/web` checks the keys.

## Pull requests

One topic per pull request. Say how you tested it.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
