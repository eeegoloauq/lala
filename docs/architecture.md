# Architecture

```
Browser → Nginx (:3000)
            ├── /       → React SPA
            └── /api/*  → Express API (:3001)
          → LiveKit (:7880 WS, :50000/udp, :3478/udp TURN)
```

Four packages:

- `packages/api`: Express. Token generation, room CRUD, admin actions, SSE. Uses `livekit-server-sdk` v2.
- `packages/web`: Vite and React. `livekit-client` v2, custom UI.
- `packages/desktop`: Electron. Native screen share, tray, auto-updates.
- `packages/shared`: shared types for the api and web wire format.

Identity is an HMAC of a stable device UUID, so the same device is always the same participant.

## Security

- End-to-end encryption with LiveKit's E2EE (AES-GCM); the media key and the key the server checks are derived separately from the room password on the client, so the server never sees either the password or the media key
- HMAC identity that cannot be forged without the API secret
- Room creators moderate by identity; rights are LiveKit grants, so the media server enforces them, and a ban revokes the tokens the banned client holds
- Optional server password with an HttpOnly session cookie and a limit on failed attempts
- Rate limiting in nginx and Express; null bytes, RTL overrides and control chars stripped from input
- CSP without inline scripts; containers with `no-new-privileges` and memory limits, the API as a non-root user

Found a vulnerability? See [SECURITY.md](../SECURITY.md).
