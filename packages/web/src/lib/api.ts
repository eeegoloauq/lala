import type { RoomInfo, CreateRoomRequest, TokenRequest, TokenResponse } from './types';
import { ApiError } from './types';

const API_BASE = '/api';

export async function getToken(request: TokenRequest): Promise<TokenResponse> {
    const res = await fetch(`${API_BASE}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });

    if (!res.ok) {
        if (res.status === 429) {
            const retryAfter = parseInt(res.headers.get('Retry-After') ?? '15', 10);
            throw new ApiError('rate_limited', 429, isNaN(retryAfter) ? 15 : retryAfter);
        }
        const body = await res.json().catch(() => ({ error: 'server_error' }));
        throw new ApiError(body.error ?? 'server_error', res.status);
    }

    return res.json() as Promise<TokenResponse>;
}

export async function getRooms(): Promise<RoomInfo[]> {
    const res = await fetch(`${API_BASE}/rooms`);
    if (!res.ok) throw new ApiError('server_error', res.status);
    const data = await res.json();
    return data.rooms;
}

export async function createRoom(request: CreateRoomRequest): Promise<RoomInfo> {
    const res = await fetch(`${API_BASE}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'server_error' }));
        throw new ApiError(body.error ?? 'server_error', res.status);
    }
    return res.json();
}

async function adminPost(roomId: string, action: string, body: object): Promise<void> {
    const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/admin/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        if (res.status === 429) {
            const retryAfter = parseInt(res.headers.get('Retry-After') ?? '15', 10);
            throw new ApiError('rate_limited', 429, isNaN(retryAfter) ? 15 : retryAfter);
        }
        const data = await res.json().catch(() => ({ error: 'server_error' }));
        throw new ApiError(data.error ?? 'server_error', res.status);
    }
}

export const kickParticipant = (roomId: string, identity: string, adminSecret: string) =>
    adminPost(roomId, 'kick', { identity, adminSecret });

export const banParticipant = (roomId: string, identity: string, adminSecret: string) =>
    adminPost(roomId, 'ban', { identity, adminSecret });

export const muteParticipant = (roomId: string, identity: string, adminSecret: string, muted: boolean) =>
    adminPost(roomId, 'mute', { identity, adminSecret, muted });
