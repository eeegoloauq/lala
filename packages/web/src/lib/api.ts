import type { RoomInfo, CreateRoomRequest, TokenRequest, TokenResponse } from './types';
import { ApiError } from './types';

const API_BASE = '/api';

/**
 * Shared fetch wrapper for every API call. Unifies network-error wrapping,
 * 429 + Retry-After handling, and snake_case error-code extraction from the
 * response body so every caller gets the same behavior instead of each
 * re-implementing (and occasionally forgetting) it.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`${API_BASE}${path}`, init);
    } catch {
        throw new ApiError('server_unavailable', 0);
    }

    if (!res.ok) {
        if (res.status === 429) {
            const retryAfter = parseInt(res.headers.get('Retry-After') ?? '15', 10);
            throw new ApiError('rate_limited', 429, isNaN(retryAfter) ? 15 : retryAfter);
        }
        const body = await res.json().catch(() => ({ error: 'server_error' }));
        throw new ApiError(body.error ?? 'server_error', res.status);
    }

    return res.json() as Promise<T>;
}

const jsonBody = (body: object): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

export function getToken(req: TokenRequest): Promise<TokenResponse> {
    return request<TokenResponse>('/token', jsonBody(req));
}

export async function getRooms(): Promise<RoomInfo[]> {
    const data = await request<{ rooms: RoomInfo[] }>('/rooms');
    return data.rooms;
}

export function createRoom(req: CreateRoomRequest): Promise<RoomInfo> {
    return request<RoomInfo>('/rooms', jsonBody(req));
}

function adminPost(roomId: string, action: string, body: object): Promise<void> {
    return request<void>(`/rooms/${encodeURIComponent(roomId)}/admin/${action}`, jsonBody(body));
}

export const kickParticipant = (roomId: string, identity: string, adminSecret: string) =>
    adminPost(roomId, 'kick', { identity, adminSecret });

export const banParticipant = (roomId: string, identity: string, adminSecret: string) =>
    adminPost(roomId, 'ban', { identity, adminSecret });

export const muteParticipant = (roomId: string, identity: string, adminSecret: string, muted: boolean) =>
    adminPost(roomId, 'mute', { identity, adminSecret, muted });
