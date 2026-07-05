# Security

Found a vulnerability? Please report it privately through
[GitHub security advisories](https://github.com/eeegoloauq/lala/security/advisories/new)
instead of opening a public issue. You'll get a response within a few days, and a fix lands in
the next release — only the latest release is supported.

Lala is self-hosted, so the deployment model matters: secrets live in `.env` (never in the repo
or images), and TLS termination is expected from your reverse proxy. The security mechanisms in
place (E2EE for password-protected rooms, HMAC identity, scrypt password hashes, rate limiting,
security headers) are described in the [README](README.md#security).
