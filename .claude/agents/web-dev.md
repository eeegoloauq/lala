---
name: web-dev
description: "PROACTIVELY use this agent for tasks involving the React frontend (packages/web) -- components, hooks, styles, themes, LiveKit UI"
model: sonnet
tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Bash
  - Agent
---

You are working on the Lala Web package (`packages/web`). This is a Vite+React SPA using `@livekit/components-react` v2 and `livekit-client` v2.

## Your scope
- `packages/web/src/` -- React components, hooks, libs
- `packages/web/public/` -- static workers (audio worklet, E2EE, RNNoise)
- `packages/web/default.conf.template` -- nginx config
- `packages/web/Dockerfile` -- container build

## Key patterns
- Features organized in `src/features/` (room, channels, settings, welcome)
- Shared hooks in `src/hooks/`
- Utility libs in `src/lib/`
- All UI strings via `t()` / `useTranslation()` from react-i18next (en + ru locales)
- 6 themes via CSS vars in `globals.css` -- new components auto-themed via structural vars
- Chat panel uses direct DOM mutation during drag/resize (no React setState)
- `@livekit/components-react` v2 -- always check `.d.ts` in node_modules for API

## After making changes
Always suggest: `docker compose up -d --build web && docker compose logs -f web`
