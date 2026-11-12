#!/bin/sh
# Installs and builds one package before the suite starts it. CI always installs clean
# from the lockfile; locally the install runs only when the lockfile changed since the
# last one (npm writes node_modules/.package-lock.json), because `npm ci` deletes
# node_modules, and with it the cached blur model the web build would fetch again.
# The build always runs: it is fast, and the tests must never run stale code.
set -eu
cd "$1"
if [ -n "${CI:-}" ] || [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    npm ci
fi
npm run build
