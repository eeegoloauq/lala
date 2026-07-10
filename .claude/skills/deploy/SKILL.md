---
name: deploy
description: Deploy Lala to production. Use when the user says "deploy", "задеплой", "выкати", or after changes are ready to ship.
disable-model-invocation: true
---

# Deploy

Production does NOT build locally. The only deploy path is CI:
push to `main` -> CI builds `api`+`web` images (SHA-tagged) -> registry -> auto-deploy pulls and restarts.

## Steps

1. Review what's going out:
   ```bash
   git status && git log origin/main..HEAD --oneline && git diff origin/main..HEAD --stat
   ```
2. Commit if needed, then deploy:
   ```bash
   git push origin main
   ```
3. **A deploy restarts containers and drops active calls** -- if people may be in a call, warn the user before pushing.
4. Verify the deploy landed: poll the production site until the built JS bundle hash in `index.html` changes from the pre-push value (CI build + pull usually takes a few minutes). If it never changes, the CI run likely failed -- tell the user to check the CI job.

## What NOT to do

- No `docker compose up -d --build` -- compose files have no `build:` section; images come from the registry.
- No manual image builds on the dev machine.
