---
name: deploy
description: "Build and deploy services via docker compose. Use when user says 'deploy', 'rebuild', 'restart services', or after making code changes that need verification."
user-invocable: true
---

# Deploy Skill

Rebuild and restart Lala services.

## Steps

1. Check which services have changes:
   ```bash
   git diff --name-only HEAD
   ```

2. Determine affected services:
   - `packages/api/**` -> rebuild `api`
   - `packages/web/**` -> rebuild `web`
   - `docker-compose.yml` or `.env` -> rebuild all
   - `livekit.yaml*` -> restart `livekit`

3. Rebuild only affected services:
   ```bash
   docker compose up -d --build <service1> <service2>
   ```

4. Verify health:
   ```bash
   # Wait for startup
   sleep 3
   # Check API
   curl -s http://localhost:3001/api/health
   # Check logs for errors
   docker compose logs --tail=20 <service>
   ```

5. Report status to user.

## If something fails
- Check `docker compose logs -f <service>` for errors
- Common issues: port conflicts, missing env vars, TypeScript compilation errors
- For full reset: `docker compose down && docker compose up -d --build`
