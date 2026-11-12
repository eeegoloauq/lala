import type { AvatarResponse, RoomInfo, CreateRoomRequest, TokenRequest, TokenResponse, RoomBan, BansResponse, AccessStatus, InviteResponse, Me, ServerBan, ServerBansResponse, RoomBot, RoomBotsResponse, PresencePerson, PresenceResponse, PresenceTicketResponse, PresenceUpdate } from './types';
import { ApiError } from './types';
import { getDeviceId } from './identity';
import { IS_DEMO } from './env';

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
        res = IS_DEMO
            ? await (await import('../features/demo/server')).handle(path, init)
            : await fetch(`${API_BASE}${path}`, {
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

    return (res.status === 204 ? undefined : res.json()) as Promise<T>;
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

export function getMe(): Promise<Me> {
    return request<Me>('/me');
}

/** Stores the caller's avatar (an image data URL) on the server; returns its version. */
export async function uploadAvatar(dataUrl: string): Promise<string> {
    // Decoded here: fetching a data: URL is a connection the CSP doesn't allow.
    const [head, base64 = ''] = dataUrl.split(',', 2);
    const type = /^data:([^;]+);base64$/.exec(head)?.[1] ?? 'image/jpeg';
    const image = new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type });
    const res = await request<AvatarResponse>('/me/avatar', { method: 'POST', headers: { 'Content-Type': image.type }, body: image });
    return res.avatar;
}

export function deleteAvatar(): Promise<void> {
    return request<void>('/me/avatar', { method: 'DELETE' });
}

export async function getPresence(): Promise<PresencePerson[]> {
    return (await request<PresenceResponse>('/presence')).people;
}

/** A ticket that opens the event stream as this device; EventSource can't send the device header. */
export async function getPresenceTicket(): Promise<string> {
    return (await request<PresenceTicketResponse>('/presence/ticket', { method: 'POST' })).ticket;
}

export function putPresence(update: PresenceUpdate): Promise<void> {
    return request<void>('/presence', send('PUT', update));
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

export const setVoice = (roomId: string, identity: string, allowed: boolean) =>
    request<void>(admin(roomId, 'voice'), send('POST', { identity, allowed }));

/** Asks the person's client to switch to `to`, another room the caller moderates. */
export const moveParticipant = (roomId: string, identity: string, to: string) =>
    request<void>(admin(roomId, 'move'), send('POST', { identity, to }));

export async function getBans(roomId: string): Promise<RoomBan[]> {
    return (await request<BansResponse>(admin(roomId, 'bans'))).bans;
}

export const banFromServer = (identity: string) => request<void>('/admin/ban', send('POST', { identity }));

export const unbanFromServer = (identity: string) => request<void>('/admin/unban', send('POST', { identity }));

export async function getServerBans(): Promise<ServerBan[]> {
    return (await request<ServerBansResponse>('/admin/bans')).bans;
}

const roomBots = (roomId: string, key = '') => `/rooms/${encodeURIComponent(roomId)}/bots${key && `/${encodeURIComponent(key)}`}`;

/** Bots the caller may add to the room, whether each is online and already added. */
export async function getRoomBots(roomId: string): Promise<RoomBot[]> {
    return (await request<RoomBotsResponse>(roomBots(roomId))).bots;
}

/** Adds the bot, or asks it again to join when it was added but didn't come. */
export const addBot = (roomId: string, key: string) => request<void>(roomBots(roomId, key), { method: 'POST' });

/** For whoever added the bot and the room's moderators. */
export const removeBot = (roomId: string, key: string) => request<void>(roomBots(roomId, key), { method: 'DELETE' });
