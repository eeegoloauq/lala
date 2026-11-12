import { useSyncExternalStore } from 'react';
import { addBot, removeBot } from './api';
import { createStore } from './store';
import type { RoomBot } from './types';

/**
 * Bots this client added that are not in the call yet: shown as a joining tile, and as
 * "didn't join" when the bot hasn't come within JOIN_TIMEOUT. Only the person who added
 * the bot sees these; everyone sees "X added Y" in chat.
 */
export interface PendingBot {
    roomId: string;
    key: string;
    identity: string;
    name: string;
    avatar?: string;
    state: 'joining' | 'failed';
}

const JOIN_TIMEOUT = 20_000;
const store = createStore<PendingBot[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function drop(identity: string): void {
    clearTimeout(timers.get(identity));
    timers.delete(identity);
    if (store.get().some(b => b.identity === identity)) store.set(store.get().filter(b => b.identity !== identity));
}

function put(bot: PendingBot): void {
    store.set([...store.get().filter(b => b.identity !== bot.identity), bot]);
}

/** Adds the bot to the room; throws the API error, with nothing left pending. */
export async function addBotToRoom(roomId: string, bot: RoomBot): Promise<void> {
    const pending: PendingBot = { roomId, key: bot.key, identity: bot.identity, name: bot.name, avatar: bot.avatar, state: 'joining' };
    put(pending);
    try {
        await addBot(roomId, bot.key);
    } catch (err) {
        drop(bot.identity);
        throw err;
    }
    // It may have joined while the request was still answering.
    if (!store.get().some(b => b.identity === bot.identity)) return;
    clearTimeout(timers.get(bot.identity));
    timers.set(bot.identity, setTimeout(() => {
        timers.delete(bot.identity);
        if (store.get().some(b => b.identity === bot.identity)) put({ ...pending, state: 'failed' });
    }, JOIN_TIMEOUT));
}

/** "Try again": the server asks the bot once more. */
export function retryBot(bot: PendingBot): void {
    addBotToRoom(bot.roomId, { key: bot.key, identity: bot.identity, name: bot.name, avatar: bot.avatar, listens: false, online: true, added: true })
        .catch(() => put({ ...bot, state: 'failed' }));
}

/** "Dismiss": also ends the invitation, so the bot doesn't turn up later unasked. */
export function dismissBot(bot: PendingBot): void {
    drop(bot.identity);
    removeBot(bot.roomId, bot.key).catch(() => { /* gone already */ });
}

/** Called with the bots in the call; they are no longer pending. */
export function botsArrived(identities: Iterable<string>): void {
    for (const identity of identities) drop(identity);
}

export function clearPendingBots(): void {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    store.set([]);
}

export const usePendingBots = () => useSyncExternalStore(store.subscribe, store.get);
