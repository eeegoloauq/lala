import { TrackSource, type ParticipantPermission } from 'livekit-server-sdk';
import { config, type Level, type Right, type Role } from './config';
import type { Flags, RoomState } from './rooms';

const RANK: Record<Level, number> = { everyone: 0, members: 1, admins: 2 };

export const roleOf = (identity: string | undefined): Role | undefined =>
    identity === undefined ? undefined : config().users.get(identity)?.role;

/** Admins, and the creator in their own room, rank as admins; members as members. */
function rank(identity: string | undefined, room?: RoomState): number {
    const role = roleOf(identity);
    if (role === 'admin' || (room?.creator !== undefined && identity === room.creator)) return RANK.admins;
    return role === 'member' ? RANK.members : RANK.everyone;
}

/** Whether this person may use the server at all; the config may turn guests away. */
export const mayEnter = (identity: string | undefined) => config().guests || roleOf(identity) !== undefined;

export const isModerator = (identity: string | undefined, room: RoomState) =>
    identity !== undefined && rank(identity, room) === RANK.admins;

export const can = (identity: string | undefined, room: RoomState, right: Right) =>
    mayEnter(identity) && rank(identity, room) >= RANK[room.rights[right]];

export function canCreateRooms(identity: string | undefined): boolean {
    const level = config().createRooms;
    return mayEnter(identity) && level !== 'nobody' && rank(identity) >= RANK[level];
}

/**
 * What a participant may publish. It goes into their token and, on a change, to LiveKit
 * directly, so the media server enforces it whatever the client does.
 */
export function permissionFor(identity: string, room: RoomState, { muted, voiced }: Flags): Partial<ParticipantPermission> {
    const sources: TrackSource[] = [];
    if ((can(identity, room, 'speak') || voiced) && !muted) sources.push(TrackSource.MICROPHONE);
    if (can(identity, room, 'video')) sources.push(TrackSource.CAMERA);
    if (can(identity, room, 'screen')) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
    return {
        canSubscribe: true,
        canPublish: sources.length > 0,
        canPublishSources: sources,
        canPublishData: can(identity, room, 'chat'),
        canUpdateMetadata: true,
    };
}

/**
 * Shown on the participant so every client can mark them. Set by the server only; a
 * participant clearing its own copy changes nothing but its icon.
 */
export function attributesFor({ muted, voiced }: Flags): Record<string, string> {
    return { 'lala.server-muted': muted ? '1' : '', 'lala.voice': voiced ? '1' : '' };
}
