#!/bin/sh
# Runs Redis 7, the major production uses (docker-compose.yml), built once from the
# release tarball into .bin/ and checked against the published checksum. Redis ships
# no binaries, and the API keeps room admin secrets only there.
set -eu
cd "$(dirname "$0")"

VERSION=7.4.11
SHA256=3c266ece0abd54ed3b1c912c6eb86b7508cf382cb690ee6649d3843f018f6357

BIN=.bin/redis-server-$VERSION
if [ ! -x "$BIN" ]; then
    mkdir -p .bin
    TGZ=.bin/redis-$VERSION.tar.gz
    curl -fsSL -o "$TGZ" "https://download.redis.io/releases/redis-$VERSION.tar.gz"
    echo "$SHA256  $TGZ" | sha256sum -c - >/dev/null
    tar -xzf "$TGZ" -C .bin
    make -s -C ".bin/redis-$VERSION" -j"$(nproc)" BUILD_TLS=no redis-server >/dev/null
    mv ".bin/redis-$VERSION/src/redis-server" "$BIN"
    rm -rf "$TGZ" ".bin/redis-$VERSION"
fi

exec "$BIN" --bind 127.0.0.1 --port 6380 --save '' --appendonly no --loglevel warning
