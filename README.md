# Lala

Self-hosted voice, video and text chat for small groups, in the browser and as a desktop app for
Windows and Linux.

[![Release](https://img.shields.io/github/v/release/eeegoloauq/lala?label=release)](https://github.com/eeegoloauq/lala/releases/latest)
[![Images](https://github.com/eeegoloauq/lala/actions/workflows/images.yml/badge.svg?branch=main)](https://github.com/eeegoloauq/lala/actions/workflows/images.yml)
[![Copr](https://copr.fedorainfracloud.org/coprs/eeegoloauq/lala/package/lala-desktop/status_image/last_build.png)](https://copr.fedorainfracloud.org/coprs/eeegoloauq/lala/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![Screen sharing in Lala](screenshots/stream.png)

- Voice rooms and text chats, like a small Discord
- Screen sharing up to 4K at 60 fps
- No accounts: people join with a name and a link
- Password rooms are end-to-end encrypted
- Bots join calls through a small API
- Set up with one script and Docker Compose

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
public IP and two domains.

```bash
git clone https://github.com/eeegoloauq/lala.git && cd lala
./setup.sh              # asks for your domains and makes the keys
docker compose up -d
```

[Guide](docs/self-hosting.md): HTTPS, firewall, updates, admins and bots.

## Development

[Contributing and local setup](CONTRIBUTING.md) · [Translations](CONTRIBUTING.md#translations) · [Theming](docs/theming.md) · [Architecture and security](docs/architecture.md) · [Client API](docs/api.md) · [Roadmap](ROADMAP.md) · [Security policy](SECURITY.md)

## License

[MIT](LICENSE)
