import type { RoomInfo, CreateRoomRequest, TokenRequest, TokenResponse, RoomBan, BansResponse, AccessStatus, InviteResponse } from './types';
import { ApiError } from './types';
import { getDeviceId } from './identity';

const API_BASE = '/api';

/** Fired when the instance password session is missing or expired; AccessGate shows the password screen. */
export const ACCESS_REQUIRED_EVENT = 'lala:access-required';

/**
 * Shared fetch wrapper for every API call. Unifies network-error wrapping,
 * 429 + Retry-After handling, and snake_case error-code extraction from the
 * response body so every caller gets the same behavior. Every request carries the
 * device ID, which is how the server knows who is asking.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`${API_BASE}${path}`, {
            ...init,
            headers: { ...init.headers, 'X-Lala-Device': getDeviceId() },
        });
    } catch {
        throw new ApiError('server_unavailable', 0);
    }

    if (!res.ok) {
        if (res.status === 429) {
            const retryAfter = parseInt(res.headers.get('Retry-After') ?? '15', 10);
            throw new ApiError('rate_limited', 429, isNaN(retryAfter) ? 15 : retryAfter);
        }
        const body = await res.json().catch(() => ({ error: 'server_error' }));
        if (body.error === 'access_required') window.dispatchEvent(new Event(ACCESS_REQUIRED_EVENT));
        throw new ApiError(body.error ?? 'server_error', res.status);
    }

    return res.json() as Promise<T>;
}

const send = (method: string, body: object): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

export function getAccess(): Promise<AccessStatus> {
    return request<AccessStatus>('/access');
}

export function submitAccessPassword(password: string): Promise<void> {
    return request<void>('/access', send('POST', { password }));
}

export function submitAccessInvite(invite: string): Promise<void> {
    return request<void>('/access', send('POST', { invite }));
}

export async function createAccessInvite(): Promise<string> {
    return (await request<InviteResponse>('/access/invite', { method: 'POST' })).invite;
}

export function getToken(req: TokenRequest): Promise<TokenResponse> {
    return request<TokenResponse>('/token', send('POST', req));
}

export async function getRooms(): Promise<RoomInfo[]> {
    return (await request<{ rooms: RoomInfo[] }>('/rooms')).rooms;
}

export function getRoom(roomId: string): Promise<RoomInfo> {
    return request<RoomInfo>(`/rooms/${encodeURIComponent(roomId)}`);
}

/** Returns the live room with this name if there is one, otherwise a new room. */
export function createRoom(req: CreateRoomRequest): Promise<RoomInfo> {
    return request<RoomInfo>('/rooms', send('POST', req));
}

export function deleteRoom(roomId: string): Promise<void> {
    return request<void>(`/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
}

const admin = (roomId: string, action: string) => `/rooms/${encodeURIComponent(roomId)}/admin/${action}`;

export const kickParticipant = (roomId: string, identity: string) =>
    request<void>(admin(roomId, 'kick'), send('POST', { identity }));

export const banParticipant = (roomId: string, identity: string) =>
    request<void>(admin(roomId, 'ban'), send('POST', { identity }));

export const unbanParticipant = (roomId: string, identity: string) =>
    request<void>(admin(roomId, 'unban'), send('POST', { identity }));

export const muteParticipant = (roomId: string, identity: string, muted: boolean) =>
    request<void>(admin(roomId, 'mute'), send('POST', { identity, muted }));

export async function getBans(roomId: string): Promise<RoomBan[]> {
    return (await request<BansResponse>(admin(roomId, 'bans'))).bans;
}
