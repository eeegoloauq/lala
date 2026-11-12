import { TrackSource, type ParticipantPermission, type VideoGrant } from 'livekit-server-sdk';
import { config, type BotConfig, type ConfigChat, type Level, type Right, type Role } from './config';
import { botOf, isBotIdentity } from './bots';
import { isClaimedAdmin } from './adminClaim';
import type { Flags, RoomState } from './rooms';

const RANK: Record<Level, number> = { everyone: 0, members: 1, admins: 2 };

/** From the config, or admin through the claim link (`adminClaim.ts`). */
export const roleOf = (identity: string | undefined): Role | undefined =>
    identity === undefined ? undefined : config().users.get(identity)?.role ?? (isClaimedAdmin(identity) ? 'admin' : undefined);

/** Admins, and the creator in their own room, rank as admins; members as members. */
function rank(identity: string | undefined, room?: RoomState): number {
    const role = roleOf(identity);
    if (role === 'admin' || (room?.creator !== undefined && identity === room.creator)) return RANK.admins;
    return role === 'member' ? RANK.members : RANK.everyone;
}

/**
 * Whether this person may use the server at all; the config may turn guests away. A bot
 * may while the config lists it.
 */
export const mayEnter = (identity: string | undefined) =>
    isBotIdentity(identity) ? botOf(identity) !== undefined : config().guests || roleOf(identity) !== undefined;

/** Bots never moderate, whatever room they are in. */
export const isModerator = (identity: string | undefined, room: RoomState) =>
    identity !== undefined && !isBotIdentity(identity) && rank(identity, room) === RANK.admins;

/**
 * A bot's rights come from its own entry, not from the room's levels: it joins the rooms
 * listed there and rooms someone added it to (`invited`, while its entry still allows
 * that), speaks and chats when it has those rights, and never shows video or a screen.
 */
export function can(identity: string | undefined, room: RoomState, right: Right, invited = false): boolean {
    if (isBotIdentity(identity)) {
        const bot = botOf(identity);
        if (!bot || !(bot.rooms.has(room.id) || (invited && bot.invite !== undefined))) return false;
        return right === 'join' || (right === 'speak' && bot.rights.speak) || (right === 'chat' && bot.rights.chat);
    }
    return mayEnter(identity) && rank(identity, room) >= RANK[room.rights[right]];
}

/**
 * Whether this person may add the bot to the room: its `invite` level, counted as for room
 * rights (a creator ranks as an admin in their own room), and they must be allowed in.
 * Bots never add bots.
 */
export function mayAddBot(identity: string | undefined, room: RoomState, bot: BotConfig): boolean {
    return bot.invite !== undefined && !isBotIdentity(identity) && can(identity, room, 'join')
        && rank(identity, room) >= RANK[bot.invite];
}

/** Text chats are for people: admins (from the config) moderate them, `post` says who writes. */
export const isServerAdmin = (identity: string | undefined) => !isBotIdentity(identity) && roleOf(identity) === 'admin';

export const mayPost = (identity: string | undefined, chat: ConfigChat) =>
    mayEnter(identity) && !isBotIdentity(identity) && rank(identity) >= RANK[chat.post];

export function canCreateRooms(identity: string | undefined): boolean {
    const level = config().createRooms;
    return mayEnter(identity) && !isBotIdentity(identity) && level !== 'nobody' && rank(identity) >= RANK[level];
}

/**
 * What a participant may publish. It goes into their token and, on a change, to LiveKit
 * directly, so the media server enforces it whatever the client does.
 */
export function permissionFor(identity: string, room: RoomState, { muted, voiced, invited }: Flags): Partial<ParticipantPermission> {
    // A moderator can mute a bot but not give it the floor: what it may do is the admin's call.
    const bot = isBotIdentity(identity);
    const may = (right: Right) => can(identity, room, right, invited);
    const sources: TrackSource[] = [];
    if ((may('speak') || (voiced && !bot)) && !muted) sources.push(TrackSource.MICROPHONE);
    if (may('video')) sources.push(TrackSource.CAMERA);
    if (may('screen')) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
    return {
        // Without listen a bot gets no one's audio or video; chat still reaches it.
        canSubscribe: bot ? botOf(identity)?.rights.listen === true : true,
        canPublish: sources.length > 0,
        canPublishSources: sources,
        canPublishData: may('chat'),
        // Name, avatar, status and commands of a bot are set by the server only.
        canUpdateMetadata: !bot,
        hidden: false,
    };
}

/** The token grant for joining a room, from the same permission LiveKit gets on a change. */
export function grantFor(identity: string, room: RoomState, flags: Flags): VideoGrant {
    const permission = permissionFor(identity, room, flags);
    return {
        room: room.id,
        roomJoin: true,
        canSubscribe: permission.canSubscribe,
        canPublish: permission.canPublish,
        canPublishSources: permission.canPublishSources,
        canPublishData: permission.canPublishData,
        canUpdateOwnMetadata: permission.canUpdateMetadata,
        hidden: false,
    };
}

/**
 * Shown on the participant so every client can mark them. Set by the server only; a
 * participant clearing its own copy changes nothing but its icon.
 */
export function attributesFor({ muted, voiced }: Flags): Record<string, string> {
    return { 'lala.server-muted': muted ? '1' : '', 'lala.voice': voiced ? '1' : '' };
}
