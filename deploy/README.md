# Production deploy

A systemd timer runs `lala-pull` every 5 minutes. When `main` moves and CI has published images
for the new commit, it checks that commit out, starts it and waits up to 2 minutes for
`/api/health`. If the release does not come up, it goes back to the previous commit and skips the
rejected one until `main` moves again. A deploy restarts the containers and drops active calls.

## Host setup

1. A `deploy` user in the `docker` group.
2. The repository cloned to `/opt/lala`, owned by `deploy`, with `origin` pointing at the
   repository CI builds from.
3. `/opt/lala/.env` filled in from [`.env.example`](../.env.example), with `LALA_TAG` set to the
   commit to start from.
4. `docker network create edge`, and a reverse proxy on that network (see the main README).
5. `sudo deploy/install.sh` installs `lala-pull` and enables the timer. Run it again after changing
   anything in `deploy/`.

## Operating

- Logs: `journalctl -u lala-pull`.
- Deploy now: `sudo systemctl start lala-pull`.
- To roll back a release that came up but misbehaves, revert the commit on `main`; the timer
  deploys the revert like any other commit.
