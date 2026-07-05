#!/usr/bin/env bash
# Cut a desktop release: bump version, commit, tag, push.
# The v<version> tag (once mirrored to GitHub) triggers
# .github/workflows/electron.yml, which builds Windows + Linux clients and
# publishes them to GitHub Releases — the auto-updater picks them up from there.
#
# Usage: ./release.sh patch|minor|major|<x.y.z>
set -euo pipefail

cd "$(dirname "$0")"

BUMP="${1:-}"
if [[ -z "$BUMP" ]]; then
    echo "Usage: ./release.sh patch|minor|major|<x.y.z>" >&2
    exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is not clean — commit or stash first." >&2
    exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
    echo "Releases are cut from main (currently on '$BRANCH')." >&2
    exit 1
fi

git pull --ff-only origin main

# Bump packages/desktop version (also updates its package-lock.json)
pushd packages/desktop >/dev/null
NEW_VERSION="$(npm version "$BUMP" --no-git-tag-version)"
NEW_VERSION="${NEW_VERSION#v}"
popd >/dev/null

TAG="v${NEW_VERSION}"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    echo "Tag $TAG already exists." >&2
    git checkout -- packages/desktop/package.json packages/desktop/package-lock.json
    exit 1
fi

git add packages/desktop/package.json packages/desktop/package-lock.json
git commit -m "release: desktop ${TAG}"
git tag "$TAG"
git push origin main "$TAG"

echo
echo "Released ${TAG}."
echo "Watch the build: https://github.com/eeegoloauq/lala/actions"
echo "(Requires the Forgejo→GitHub mirror to sync tags — if the workflow"
echo " doesn't start, push the tag to GitHub directly.)"
