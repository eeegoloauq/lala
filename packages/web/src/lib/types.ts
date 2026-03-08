/** Room info returned by the API */
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
    adminSecret?: string;            // only present in POST /api/rooms response — store and don't share
}

/** Payload for creating a room */
export interface CreateRoomRequest {
    name: string;
    password?: string;
    maxParticipants?: number;
    identity?: string; // creator identity — stored in metadata to skip password on reconnect
}

/** Token request payload */
export interface TokenRequest {
    room: string;
    name: string;     // display name shown to others
    deviceId?: string; // stable device UUID — server derives a deterministic identity from it via HMAC
    password?: string;
    adminSecret?: string; // skip password check when rejoining own room
}

/** Token response from API */
export interface TokenResponse {
    token: string;
    identity: string; // HMAC-derived from deviceId — stable per device, cannot be forged without server secret
}

/** API error codes returned by the server */
export type ApiErrorCode =
    | 'wrong_password'
    | 'password_required'
    | 'room_not_found'
    | 'room_full'
    | 'banned'
    | 'rate_limited'
    | 'server_error';

/** Typed API error */
export class ApiError extends Error {
    constructor(
        public readonly code: ApiErrorCode,
        public readonly status: number,
        public readonly retryAfter?: number,
    ) {
        super(code);
    }
}
