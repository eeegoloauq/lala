/**
 * Wire contract between the Lala API (packages/api) and its clients
 * (packages/web, packages/desktop). Types only — this package has no runtime
 * code and is consumed as a `file:` devDependency, so it never ships in a
 * bundle or image.
 *
 * If you change a response shape in the API, change it here; both packages
 * typecheck against this file, so drift fails CI instead of failing users.
 */

/** Room info returned by GET /api/rooms and GET /api/rooms/:id */
export interface RoomInfo {
    id: string;            // opaque LiveKit room name (e.g. "a3f8c2d1e9")
    displayName: string;   // human-readable name from metadata
    numParticipants: number;
    maxParticipants: number; // 0 = unlimited
    hasPassword: boolean;
    creationTime: number;
    participants: Array<{ identity: string; name: string }>;
    adminIdentity?: string;          // creator's UUID, shown as crown in UI
    screenSharingParticipants?: string[];  // identities currently screen sharing
    mutedParticipants?: string[];         // identities with mic muted
    deafenedParticipants?: string[];      // identities who are deafened (from participant metadata)
    serverMutedParticipants?: string[];   // identities server-muted by admin (canPublish === false)
    adminSecret?: string;            // only present in POST /api/rooms response — store and don't share
}

/** One banned participant, from GET /api/rooms/:id/admin/bans. Only identities are stored server-side, so `name` is currently always absent — kept optional so a future name-carrying ban store is a non-breaking change. */
export interface RoomBan { identity: string; name?: string; }
/** Response from GET /api/rooms/:id/admin/bans */
export interface BansResponse { bans: RoomBan[]; }

/** Payload for POST /api/rooms */
export interface CreateRoomRequest {
    name: string;
    password?: string;
    maxParticipants?: number;
    identity?: string; // creator identity — stored in metadata to skip password on reconnect
}

/** Payload for POST /api/token */
export interface TokenRequest {
    room: string;
    name: string;     // display name shown to others
    deviceId?: string; // stable device UUID — server derives a deterministic identity from it via HMAC
    password?: string;
    adminSecret?: string; // skip password check when rejoining own room
}

/** Response from POST /api/token */
export interface TokenResponse {
    token: string;
    identity: string; // HMAC-derived from deviceId — stable per device, cannot be forged without server secret
}

/**
 * Error codes in API `{ error: <code> }` responses, plus two codes the web
 * client synthesizes locally: 'rate_limited' (HTTP 429 from the rate
 * limiter, which sends no body code) and 'server_unavailable' (network
 * failure — no response at all).
 */
export type ApiErrorCode =
    | 'banned'
    | 'forbidden'
    | 'invalid_input'
    | 'invalid_json'
    | 'invalid_signature'
    | 'not_found'
    | 'password_required'
    | 'payload_too_large'
    | 'rate_limited'
    | 'room_full'
    | 'room_not_found'
    | 'room_required'
    | 'server_error'
    | 'server_misconfigured'
    | 'server_unavailable'
    | 'too_many_connections'
    | 'wrong_password';
