import { useSyncExternalStore } from 'react';

/**
 * External store for volatile, high-frequency room status: speaking, muted and deafened
 * identities, live participants and the live avatar cache. Room-lifetime hooks deep in
 * RoomShell (useRoomStatusSync, useAvatarCache) write it; ChannelSidebar rows read it.
 *
 * Not React state passed down: an active-speaker change would re-render App and
 * everything under it for one avatar dot. With useSyncExternalStore and a per-identity
 * selector, only the row whose value changed re-renders. Selectors return primitives or
 * references that stay the same until written, so Object.is comparison is enough.
 */

type Listener = () => void;

function createStore<T>(initial: T) {
    let state = initial;
    const listeners = new Set<Listener>();
    return {
        get: () => state,
        set(next: T): void {
            state = next;
            listeners.forEach((l) => l());
        },
        subscribe(listener: Listener): () => void {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

const speakingStore = createStore<Set<string>>(new Set());
const mutedStore = createStore<Set<string>>(new Set());
const deafenedStore = createStore<Set<string>>(new Set());
const liveParticipantsStore = createStore<Map<string, string>>(new Map());
// In memory only; useAvatarSync and useAvatarCache persist avatars to localStorage.
const avatarCacheStore = createStore<Map<string, string>>(new Map());

// ---- Writers — called from room-lifetime hooks (RoomShell subtree) ----

export function setSpeakingUsers(identities: string[]): void {
    speakingStore.set(new Set(identities));
}

export function setMutedInRoom(ids: Set<string>): void {
    mutedStore.set(ids);
}

export function setDeafenedInRoom(ids: Set<string>): void {
    deafenedStore.set(ids);
}

export function setLiveParticipants(participants: Map<string, string>): void {
    liveParticipantsStore.set(participants);
}

/** Records a received/local avatar (or removes it, when `dataUrl` is null) in the
 *  in-memory cache. Does NOT touch localStorage — callers that need persistence
 *  (useAvatarSync's data-channel receive handler, useAvatarCache's own-avatar effect)
 *  keep doing that themselves, unchanged. */
export function setAvatarCacheEntry(identity: string, dataUrl: string | null): void {
    const current = avatarCacheStore.get();
    if (dataUrl) {
        if (current.get(identity) === dataUrl) return;
        const next = new Map(current);
        next.set(identity, dataUrl);
        avatarCacheStore.set(next);
    } else {
        if (!current.has(identity)) return;
        const next = new Map(current);
        next.delete(identity);
        avatarCacheStore.set(next);
    }
}

/** Pre-seeds the in-memory cache (e.g. from localStorage) without clobbering a value
 *  already present — used once per newly-seen participant on room join. */
export function seedAvatarCacheIfMissing(identity: string, dataUrl: string): void {
    if (avatarCacheStore.get().has(identity)) return;
    setAvatarCacheEntry(identity, dataUrl);
}

/** Resets every room-scoped slice — mirrors the previous App.handleLeave resets
 *  (speakingUsers/mutedInRoom/deafenedInRoom/liveParticipants/liveAvatarCache all
 *  cleared together when the user explicitly leaves a room). */
export function resetRoomSession(): void {
    speakingStore.set(new Set());
    mutedStore.set(new Set());
    deafenedStore.set(new Set());
    liveParticipantsStore.set(new Map());
    avatarCacheStore.set(new Map());
}

// ---- Reader hooks ----

export function useIsSpeaking(identity: string): boolean {
    return useSyncExternalStore(speakingStore.subscribe, () => speakingStore.get().has(identity));
}

export function useIsMutedInRoom(identity: string): boolean {
    return useSyncExternalStore(mutedStore.subscribe, () => mutedStore.get().has(identity));
}

export function useIsDeafenedInRoom(identity: string): boolean {
    return useSyncExternalStore(deafenedStore.subscribe, () => deafenedStore.get().has(identity));
}

export function useLiveParticipants(): Map<string, string> {
    return useSyncExternalStore(liveParticipantsStore.subscribe, liveParticipantsStore.get);
}

export function useAvatarCacheMap(): Map<string, string> {
    return useSyncExternalStore(avatarCacheStore.subscribe, avatarCacheStore.get);
}

export function useAvatarForIdentity(identity: string): string | undefined {
    return useSyncExternalStore(avatarCacheStore.subscribe, () => avatarCacheStore.get().get(identity));
}
