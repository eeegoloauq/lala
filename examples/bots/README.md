# Example bot: Dice

A bot that people add to their room from "Add bot". It rolls dice on `!roll 2d6` and answers
with a card, and leaves the room for good on `!leave`. It uses the [client API](../../docs/api.md#bots)
and LiveKit's Node SDK, and runs anywhere that can reach the Lala server: it needs no open
port or webhook URL.

In `config/lala.yaml`, with the secret from `node dist/bot-secret.js dice` (see
[self-hosting](../../docs/self-hosting.md#bots)):

```yaml
bots:
  dice:
    name: Dice
    secret: "scrypt$16384$8$1$…"
    invite: everyone       # who may add it: everyone, members or admins
    rights: [chat]
```

Run it with Node 22 or later:

```sh
npm ci
LALA_URL=https://lala.example.com LALA_BOT_CREDENTIAL=dice.<secret> node dice.mjs
```

The e2e suite (`e2e/tests/add-bot.spec.ts`) runs this bot under two accounts.
