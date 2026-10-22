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
    id: string;            // opaque room ID, also the LiveKit room name
    displayName: string;
    numParticipants: number;
    maxParticipants: number; // 0 = unlimited
    passwordSalt?: string;   // present when the room has a password; input to the client-side key derivation
    creationTime: number;    // ms since epoch
    participants: Array<{ identity: string; name: string }>;
    adminIdentity?: string;          // creator's identity, shown as crown in UI
    permanent: boolean;              // listed in the server config; exists even when empty, can't be deleted
    canModerate: boolean;            // whether the caller (X-Lala-Device) may kick, ban, mute and delete
    canJoin: boolean;                // whether the caller may join (the config can limit a room to members)
    screenSharingParticipants: string[];
    mutedParticipants: string[];         // mic muted by the participant
    deafenedParticipants: string[];      // from participant metadata
    serverMutedParticipants: string[];   // muted by a moderator
}

/** One banned participant, from GET /api/rooms/:id/admin/bans. */
export interface RoomBan { identity: string; name: string; }
/** Response from GET /api/rooms/:id/admin/bans */
export interface BansResponse { bans: RoomBan[]; }

/**
 * Keys derived on the client from a room password (see the web client's roomKeys): the
 * server checks `key` and never sees the password or the encryption key.
 */
export interface RoomPassword {
    salt: string;
    key: string;
}

/**
 * Payload for POST /api/rooms. The caller (X-Lala-Device) becomes the creator. When a live
 * room already has this name, the response is that room and nothing is created.
 */
export interface CreateRoomRequest {
    name: string;
    password?: RoomPassword;
    maxParticipants?: number;
}

/** One server ban, from GET /api/admin/bans; the address the person last used is banned for a day. */
export interface ServerBan { identity: string; name: string; ipBannedUntil?: number; }
/** Response from GET /api/admin/bans */
export interface ServerBansResponse { bans: ServerBan[]; }

/** Response from GET /api/me */
export interface Me {
    identity: string;   // public; what goes into the server config to make someone a member or admin
    role: 'admin' | 'member' | 'guest';
    allowed: boolean;   // false when the config turns guests away
    canCreateRooms: boolean;
}

/** Payload for POST /api/token; the identity comes from the X-Lala-Device header. */
export interface TokenRequest {
    room: string;
    name?: string;        // display name shown to others
    passwordKey?: string; // RoomPassword.key derived with the room's passwordSalt
}

/** Response from POST /api/token */
export interface TokenResponse {
    token: string;
    identity: string; // derived from the device ID; public
    url: string;      // LiveKit WebSocket URL to connect with this token
    canModerate: boolean;
}

/** Payload for POST /api/rooms/:id/admin/{kick,ban,unban} */
export interface ModerationRequest { identity: string; }
/** Payload for POST /api/rooms/:id/admin/mute */
export interface MuteRequest { identity: string; muted: boolean; }

/** Data topic of moderation events. Only the server publishes on it. */
export type ModerationTopic = 'lala.moderation';

/** Sent by the server to everyone in the room after a moderation action succeeds. */
export interface ModerationEvent {
    action: 'kicked' | 'banned' | 'muted' | 'unmuted';
    target: string;     // identity
    targetName: string;
    byName: string;
}

/** Response from GET /api/access. POST /api/access takes `{ password }` or `{ invite }` and sets the session cookie. */
export interface AccessStatus {
    required: boolean; // the instance has LALA_ACCESS_PASSWORD set
    granted: boolean;  // this client has a valid session (always true when not required)
}

/** Response from POST /api/access/invite: `<expiry>.<signature>`, valid for 7 days. */
export interface InviteResponse {
    invite: string;
}

/**
 * Error codes in API `{ error: <code> }` responses, plus two codes the web
 * client synthesizes locally: 'rate_limited' (HTTP 429 from the rate
 * limiter, which sends no body code) and 'server_unavailable' (network
 * failure — no response at all).
 */
export type ApiErrorCode =
    | 'access_required'
    | 'banned'
    | 'forbidden'
    | 'invalid_input'
    | 'invalid_invite'
    | 'invalid_json'
    | 'invalid_signature'
    | 'identity_required'
    | 'not_allowed'
    | 'not_found'
    | 'password_required'
    | 'payload_too_large'
    | 'rate_limited'
    | 'room_full'
    | 'room_not_found'
    | 'room_required'
    | 'server_error'
    | 'server_unavailable'
    | 'too_many_connections'
    | 'wrong_password';
