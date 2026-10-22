// The wire contract lives in @lala/shared (packages/shared/index.d.ts) so the
// API and this client typecheck against the same shapes. Re-exported here so
// existing imports keep working.
export type {
    RoomInfo,
    CreateRoomRequest,
    TokenRequest,
    TokenResponse,
    ApiErrorCode,
    RoomBan,
    BansResponse,
    AccessStatus,
    InviteResponse,
    Me,
    ServerBan,
    ServerBansResponse,
    ModerationEvent,
    ModerationTopic,
    ParticipantAttribute,
} from '@lala/shared';

/** What the create-room form and room templates produce; the keys are derived before sending. */
export interface NewRoom {
    name: string;
    password?: string;
    maxParticipants?: number;
    stage?: boolean;
}

import type { ApiErrorCode } from '@lala/shared';

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
