# Lala

Self-hosted voice and video chat for small groups, in the browser and as a desktop app for Windows
and Linux.

[![Release](https://img.shields.io/github/v/release/eeegoloauq/lala?label=release)](https://github.com/eeegoloauq/lala/releases/latest)
[![Images](https://github.com/eeegoloauq/lala/actions/workflows/images.yml/badge.svg?branch=main)](https://github.com/eeegoloauq/lala/actions/workflows/images.yml)
[![Copr](https://copr.fedorainfracloud.org/coprs/eeegoloauq/lala/package/lala-desktop/status_image/last_build.png)](https://copr.fedorainfracloud.org/coprs/eeegoloauq/lala/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![Screen sharing in Lala](screenshots/stream.png)

- End-to-end encryption for password-protected rooms
- Screen sharing with system audio in the desktop app
- RNNoise noise suppression
- No database, no accounts
- Five themes, including AMOLED and Windows XP

[Try the demo](https://eeegoloauq.github.io/lala/) in your browser with simulated people · [All features](docs/features.md)

## Download

Get the desktop app from the [latest release](https://github.com/eeegoloauq/lala/releases/latest).
On Fedora, install it from [Copr](https://copr.fedorainfracloud.org/coprs/eeegoloauq/lala/):

```bash
sudo dnf copr enable eeegoloauq/lala
sudo dnf install lala-desktop
```

## Self-hosting

Runs on [LiveKit](https://livekit.io/) and Redis with Docker Compose. You need a server with a
public IP and a domain.

```bash
git clone https://github.com/eeegoloauq/lala.git && cd lala
cp .env.example .env    # set your IP, domain, keys and passwords
docker network create edge
docker compose up -d
```

[Full guide](docs/self-hosting.md): reverse proxy, environment, admins, private server, ports.

## Development

[Contributing and local setup](CONTRIBUTING.md) · [Architecture and security](docs/architecture.md) · [Client API](docs/api.md) · [Roadmap](ROADMAP.md) · [Security policy](SECURITY.md)

## License

[MIT](LICENSE)
