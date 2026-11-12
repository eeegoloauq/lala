import { useSyncExternalStore } from 'react';
import type { PresenceChoice, PresencePerson, PresenceStatus, RoomInfo } from './types';
import { isBotIdentity } from './bots';
import { createStore } from './store';

/**
 * Who has the app open (and the config's members who don't), from GET /api/presence.
 * Null while the server has not answered, or when it has no presence (an older API).
 */
const peopleStore = createStore<Map<string, PresencePerson> | null>(null);
/** This device's own status as everyone else sees it, so its rows don't wait for the server. */
const myStatusStore = createStore<PresenceStatus>('online');

export function setPresence(people: PresencePerson[] | null): void {
    peopleStore.set(people && new Map(people.map(p => [p.identity, p])));
}
/** Bumped on each `presence_updated` server event; the sync hook refetches on it. */
const changesStore = createStore(0);
export const presenceChanged = () => changesStore.set(changesStore.get() + 1);
export const usePresenceChanges = () => useSyncExternalStore(changesStore.subscribe, changesStore.get);

export const setMyStatus = (status: PresenceStatus) => myStatusStore.set(status);

export const usePresence = () => useSyncExternalStore(peopleStore.subscribe, peopleStore.get);
export const useMyStatus = () => useSyncExternalStore(myStatusStore.subscribe, myStatusStore.get);

/** What others see of a chosen status: invisible is offline, and online goes idle without input. */
export function shownStatus(choice: PresenceChoice, idle: boolean): PresenceStatus {
    if (choice === 'invisible') return 'offline';
    return choice === 'online' && idle ? 'idle' : choice;
}

/** People with the app open, counted once: everyone in a call (not bots) and everyone else not offline. */
export function countOnline(rooms: RoomInfo[], presence: Map<string, PresencePerson>, myIdentity: string | undefined, myStatus: PresenceStatus): number {
    const ids = new Set<string>();
    for (const room of rooms) for (const p of room.participants) if (!isBotIdentity(p.identity)) ids.add(p.identity);
    for (const p of presence.values()) {
        const status = p.identity === myIdentity ? myStatus : p.status;
        if (status !== 'offline') ids.add(p.identity);
    }
    return ids.size;
}
