import type { AvatarResponse, RoomInfo, CreateRoomRequest, TokenRequest, TokenResponse, RoomBan, BansResponse, AccessStatus, InviteResponse, Me, ServerBan, ServerBansResponse, RoomBot, RoomBotsResponse, PresencePerson, PresenceResponse, PresenceTicketResponse, PresenceUpdate, PresenceUpdateResponse, ActivityImageResponse, ChannelsResponse, MessagesResponse, ChatMessage, ChatAttachment, UploadResponse, SendMessageRequest, PinsResponse } from './types';
import { ApiError } from './types';
import { getDeviceId } from './identity';
import { IS_DEMO } from './env';

const API_BASE = '/api';

/** Fired when the instance password session is missing or expired; AccessGate shows the password screen. */
export const ACCESS_REQUIRED_EVENT = 'lala:access-required';

/** Fired when the server wants the rules agreed to first; the app shows them again. */
export const RULES_REQUIRED_EVENT = 'lala:rules-required';

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
        if (body.error === 'rules_required') window.dispatchEvent(new Event(RULES_REQUIRED_EVENT));
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

/** Redeems the one-time link that makes the caller the server's first admin. */
export const claimAdmin = (token: string) => request<void>('/claim', send('POST', { token }));

/** An image data URL as a Blob; decoded here because fetching a data: URL is a connection the CSP doesn't allow. */
function dataUrlBlob(dataUrl: string): Blob {
    const [head, base64 = ''] = dataUrl.split(',', 2);
    const type = /^data:([^;]+);base64$/.exec(head)?.[1] ?? 'image/jpeg';
    return new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type });
}

/** Stores the caller's avatar (an image data URL) on the server; returns its version. */
export async function uploadAvatar(dataUrl: string): Promise<string> {
    const image = dataUrlBlob(dataUrl);
    const res = await request<AvatarResponse>('/me/avatar', { method: 'POST', headers: { 'Content-Type': image.type }, body: image });
    return res.avatar;
}

/** Stores a cover or game icon (an image data URL); returns its version for the activity. */
export async function uploadActivityImage(dataUrl: string): Promise<string> {
    const image = dataUrlBlob(dataUrl);
    const res = await request<ActivityImageResponse>('/presence/images', { method: 'POST', headers: { 'Content-Type': image.type }, body: image });
    return res.image;
}

/** Where an activity's image is served; the demo has no server and keeps data URLs. */
export function activityImageUrl(image: string | undefined): string | undefined {
    if (!image) return undefined;
    if (IS_DEMO) return image.startsWith('data:') ? image : undefined;
    return /^[0-9a-f]{16}$/.test(image) ? `${API_BASE}/presence/images/${image}` : undefined;
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

/** Sends the status and profile; answers what the server is missing (an image to upload again), if anything. */
export async function putPresence(update: PresenceUpdate): Promise<PresenceUpdateResponse | undefined> {
    return request<PresenceUpdateResponse | undefined>('/presence', send('PUT', update));
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

const chat = (channel: string, rest = '') => `/chats/${encodeURIComponent(channel)}${rest}`;

/** The text chats, the rules and the messages that mention the caller. */
export function getChannels(): Promise<ChannelsResponse> {
    return request<ChannelsResponse>('/chats');
}

/** Agrees to this version of the rules. */
export const acceptRules = (version: string) => request<void>('/rules/accept', send('POST', { version }));

/** Up to `limit` messages before `before` (the newest when absent), oldest first. */
export function getMessages(channel: string, before?: string, limit = 50): Promise<MessagesResponse> {
    const query = new URLSearchParams({ limit: String(limit), ...(before ? { before } : {}) });
    return request<MessagesResponse>(chat(channel, `/messages?${query}`));
}

/** Stores a file for a message that is about to be sent. */
export async function uploadChatFile(channel: string, file: File): Promise<ChatAttachment> {
    const res = await request<UploadResponse>(chat(channel, '/files'), {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
    });
    return res.attachment;
}

export function sendMessage(channel: string, req: SendMessageRequest): Promise<ChatMessage> {
    return request<ChatMessage>(chat(channel, '/messages'), send('POST', req));
}

/** One's own message, or anyone's for an admin. */
export const deleteMessage = (channel: string, id: string) =>
    request<void>(chat(channel, `/messages/${encodeURIComponent(id)}`), { method: 'DELETE' });

/** Adds or takes back the caller's reaction. */
export const setReaction = (channel: string, id: string, emoji: string, on: boolean) =>
    request<void>(chat(channel, `/messages/${encodeURIComponent(id)}/reactions/${encodeURIComponent(emoji)}`), { method: on ? 'PUT' : 'DELETE' });

/** The chat's pinned messages, newest pin first. */
export async function getPins(channel: string): Promise<ChatMessage[]> {
    return (await request<PinsResponse>(chat(channel, '/pins'))).messages;
}

/** For admins: pins or unpins a message. */
export const setPinned = (channel: string, id: string, on: boolean) =>
    request<void>(chat(channel, `/pins/${encodeURIComponent(id)}`), { method: on ? 'PUT' : 'DELETE' });
