import type { AddedBot } from '@lala/shared';
import { redis } from './redis';
import { botsKey, listRoomStates, type RoomState } from './rooms';
import { botOf } from './bots';
import { notifyRemoved } from './botEvents';

/**
 * Bots people added to a room. Stored per room in Redis and dropped with the room, so an
 * invitation lasts the room's lifetime, unless the inviter or a moderator removes the bot
 * or it leaves for good. Only bots whose config entry has `invite` count.
 */

interface Invitation { by: string; byName: string; at: number }

const parse = (identity: string, raw: string): AddedBot => {
    const { by, byName } = JSON.parse(raw) as Invitation;
    return { identity, addedBy: by, addedByName: byName };
};

/** Whether an invitation still means something: the bot is configured and may be added. */
const stillAllowed = (identity: string) => botOf(identity)?.invite !== undefined;

export async function listAddedBots(roomId: string): Promise<AddedBot[]> {
    const all = await redis().hgetall(botsKey(roomId));
    return Object.entries(all).filter(([identity]) => stillAllowed(identity)).map(([identity, raw]) => parse(identity, raw));
}

export async function getAddedBot(roomId: string, identity: string): Promise<AddedBot | undefined> {
    const raw = await redis().hget(botsKey(roomId), identity);
    return raw && stillAllowed(identity) ? parse(identity, raw) : undefined;
}

/** Records the invitation; false when the bot was already added to the room. */
export async function addBot(roomId: string, identity: string, by: string, byName: string): Promise<boolean> {
    const invitation: Invitation = { by, byName, at: Date.now() };
    return (await redis().hsetnx(botsKey(roomId), identity, JSON.stringify(invitation))) === 1;
}

/** Ends the invitation and tells the bot; false when there was none. */
export async function removeBot(roomId: string, identity: string): Promise<boolean> {
    const removed = (await redis().hdel(botsKey(roomId), identity)) === 1;
    if (removed) notifyRemoved(roomId, [identity]);
    return removed;
}

/** The rooms a bot was added to, for its event stream and its profile. */
export async function roomsAddedTo(identity: string): Promise<RoomState[]> {
    if (!stillAllowed(identity)) return [];
    const rooms = await listRoomStates();
    if (rooms.length === 0) return [];
    const pipeline = redis().pipeline();
    for (const room of rooms) pipeline.hexists(botsKey(room.id), identity);
    const results = await pipeline.exec();
    return rooms.filter((_, i) => results?.[i]?.[1] === 1);
}

/** At startup: invitations of bots the config dropped or no longer lets people add. */
export async function dropStaleInvitations(): Promise<void> {
    for (const room of await listRoomStates()) {
        const stale = (await redis().hkeys(botsKey(room.id))).filter((identity) => !stillAllowed(identity));
        if (stale.length > 0) await redis().hdel(botsKey(room.id), ...stale);
    }
}
