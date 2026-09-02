#!/usr/bin/env bash
set -euo pipefail
cd /opt/lala
TAG="${1:-${SSH_ORIGINAL_COMMAND:-}}"
git fetch --quiet origin main
if [[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]]; then
  git merge --ff-only "$TAG"
else
  git merge --ff-only origin/main
fi
export LALA_TAG="$(git rev-parse HEAD)"
echo "$(date -Is) deploying ${LALA_TAG:0:12}"
docker compose pull api web
docker compose up -d
# Персист тега в .env: reboot / ручной `up` берут образ отсюда и НЕ откатывают
# на устаревший SHA (тот же урок, что MUSICBOT_TAG у music-bot).
if grep -q '^LALA_TAG=' .env 2>/dev/null; then
  sed -i "s/^LALA_TAG=.*/LALA_TAG=${LALA_TAG}/" .env
else
  echo "LALA_TAG=${LALA_TAG}" >> .env
fi
echo "$(date -Is) deployed $(git rev-parse --short HEAD)"
