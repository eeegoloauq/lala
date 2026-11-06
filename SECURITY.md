# Security

Found a vulnerability? Please report it privately through
[GitHub security advisories](https://github.com/eeegoloauq/lala/security/advisories/new)
instead of opening a public issue. You'll get a response within a few days, and a fix lands in
the next release — only the latest release is supported.

Lala is self-hosted, so the deployment model matters: secrets live in `.env` (never in the repo
or images), and TLS termination is expected from your reverse proxy. The security mechanisms in
place (E2EE for password-protected rooms, HMAC identity, scrypt password hashes, rate limiting,
security headers) are described in the [README](README.md#security).

## Access-password scan review (2026-11-06)

CodeQL alerts #6 and #8 flag the HMAC operations in
`packages/api/src/routes/access.ts` as inexpensive password hashing. These operations
derive a session-signing key using `LIVEKIT_API_SECRET` and compare fixed-length,
secret-keyed digests with `timingSafeEqual`. They do not persist a password verifier.
The configured instance password remains in the process environment. Session cookies
and invites contain only an expiry and a domain-separated signature.

For this design, the password-hashing warning is a false positive provided that the
server secret is high entropy and private. A cookie alone does not let an attacker
check password guesses without that secret. Changing either secret or password
invalidates sessions and invites. Online password attempts are limited to ten failed
requests per IP per fifteen minutes; this relies on the documented reverse proxy
replacing forwarded client-address headers and the API remaining private behind it.
Do not expose the API directly or replace the server secret with a guessable value.

Room authentication uses a different mechanism: salted scrypt verifiers of the
client-derived room key, with PBKDF2/HKDF separating authentication and media keys.
If instance passwords are ever stored as verifiers or the signing secret is removed,
this review no longer applies; use a password KDF and review the design again.
