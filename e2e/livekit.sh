#!/bin/sh
# Runs the LiveKit server version production uses (docker-compose.yml), fetched once
# into .bin/ and checked against the release checksum.
set -eu
cd "$(dirname "$0")"

VERSION=1.13.7
case "$(uname -m)" in
    x86_64) ARCH=amd64; SHA256=6634aeeb2fb1366b6723708ae4320b9d5408106a4c63457c5e845ae3979c90e2 ;;
    aarch64 | arm64) ARCH=arm64; SHA256=5d167fdf52cf43c0c72972f25325364479f41f854bfef651056eab2504da5de9 ;;
    *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

BIN=.bin/livekit-server-$VERSION
if [ ! -x "$BIN" ]; then
    mkdir -p .bin
    TGZ=.bin/livekit-$VERSION.tar.gz
    curl -fsSL -o "$TGZ" "https://github.com/livekit/livekit/releases/download/v$VERSION/livekit_${VERSION}_linux_$ARCH.tar.gz"
    echo "$SHA256  $TGZ" | sha256sum -c - >/dev/null
    tar -xzf "$TGZ" -C .bin livekit-server
    mv .bin/livekit-server "$BIN"
    rm "$TGZ"
fi

exec "$BIN" --config livekit-e2e.yaml
