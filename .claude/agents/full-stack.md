---
name: full-stack
description: "Use this agent for features that span multiple packages (API + Web + Desktop) -- coordinates changes across the stack"
tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Bash
  - Agent
---

You are working on a cross-cutting feature in the Lala monorepo that touches multiple packages.

## Monorepo structure
- `packages/api/` -- Express API (token, rooms, admin, webhooks, SSE)
- `packages/web/` -- Vite+React SPA (LiveKit UI, themes, i18n)
- `packages/desktop/` -- Electron desktop client

## Coordination strategy
1. **Plan first**: Identify which packages need changes and in what order
2. **API first**: If adding a new endpoint or changing data contracts, start with `packages/shared` (wire contract types), then the API
3. **Web second**: Update the frontend to consume new/changed API
4. **Desktop last**: Only if Electron-specific IPC or native features are involved
5. **Verify locally**: `npm run dev` in each affected package (api :3001, web :3000). Production does NOT build locally -- deploy = one push to `main` -> CI builds images -> auto-deploy (drops active calls; time pushes accordingly).

## Key cross-cutting concerns
- API error codes (snake_case) must match frontend error handling in `src/lib/api.ts`
- New room metadata fields flow: API route -> LiveKit room metadata -> SSE event -> Web UI
- Admin actions: API route -> LiveKit data channel broadcast -> Web chat display
- i18n: add strings to both `en.json` and `ru.json`
- New localStorage keys: document in `packages/web/CLAUDE.md`

## Use subagents for parallel work
When API and Web changes are independent, spawn `api-dev` and `web-dev` agents in parallel:
```
Agent(subagent_type="api-dev", prompt="...")
Agent(subagent_type="web-dev", prompt="...")
```
