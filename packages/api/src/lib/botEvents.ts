import type { Response } from 'express';
import type { BotRemovedEvent } from '@lala/shared';

/**
 * The event streams bots hold open (`GET /api/bot/events`), by identity. A bot dials out
 * and waits here to be told it was added to or removed from a room, so it needs no open
 * port or webhook URL. In memory: a bot reconnects after an API restart and is sent its
 * invitations again.
 */
const streams = new Map<string, Set<Response>>();

/** Streams one bot may hold at once, such as an old one not yet timed out and its replacement. */
export const MAX_STREAMS_PER_BOT = 3;

export function addBotStream(identity: string, res: Response): boolean {
    const set = streams.get(identity) ?? new Set();
    if (set.size >= MAX_STREAMS_PER_BOT) return false;
    set.add(res);
    streams.set(identity, set);
    return true;
}

export function removeBotStream(identity: string, res: Response): void {
    const set = streams.get(identity);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) streams.delete(identity);
}

/** Whether the bot is connected and can be told to join. */
export const isBotOnline = (identity: string) => streams.has(identity);

export function writeEvent(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function sendBotEvent(identity: string, event: string, data: unknown): void {
    for (const res of streams.get(identity) ?? []) writeEvent(res, event, data);
}

/** Tells bots their invitation to a room ended: removed, or the room is gone. */
export function notifyRemoved(roomId: string, identities: Iterable<string>): void {
    const event: BotRemovedEvent = { room: { id: roomId } };
    for (const identity of identities) sendBotEvent(identity, 'removed', event);
}
