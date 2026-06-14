---
name: add-feature
description: "Guided workflow for adding a new feature across the Lala stack. Use when the user describes a new feature to implement."
user-invocable: true
---

# Add Feature Skill

Structured workflow for implementing features in the Lala monorepo.

## Phase 1: Plan
1. Identify which packages are affected (API / Web / Desktop)
2. Check existing patterns in affected areas
3. Present the plan to the user for approval

## Phase 2: API (if needed)
1. Add/modify route in `packages/api/src/routes/`
2. Add error codes to match `ApiErrorCode` in web types
3. Add rate limiting if it's a new endpoint
4. Sanitize any user inputs (room names, display names)

## Phase 3: Web (if needed)
1. Add i18n strings to BOTH `en.json` and `ru.json`
2. Use theme CSS vars (never hardcode colors)
3. Use `useTranslation()` for all UI text
4. If adding settings: update `AppSettings` interface + defaults in `useSettings.ts`
5. If adding localStorage: use `lala_` prefix, document in `packages/web/CLAUDE.md`

## Phase 4: Desktop (if needed)
1. Add IPC handler in `main.js` if native features needed
2. Expose via `preload.js` contextBridge
3. Add TypeScript types in `src/types/electron.d.ts`

## Phase 5: Verify
1. Rebuild affected services: `docker compose up -d --build <services>`
2. Check logs: `docker compose logs -f <service>`
3. Verify API health: `curl http://localhost:3001/api/health`

## Gotchas
- `@livekit/components-react` v2 -- check `.d.ts` files, not just docs
- Admin secrets must stay in Redis only, never in LiveKit room metadata
- E2EE worker path is hardcoded to `/lala-e2ee-worker.js`
- Screen share audio only works on Windows in Electron
