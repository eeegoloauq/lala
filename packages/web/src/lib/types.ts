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
} from '@lala/shared';

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
