import { useSyncExternalStore } from 'react';

/**
 * External store for the volatile, high-frequency room status that used to live in
 * App.tsx state (speakingUsers, mutedInRoom, deafenedInRoom, liveParticipants, the
 * live avatar cache). Writers are the room-lifetime hooks (useRoomStatusSync,
 * useAvatarCache) that run deep inside RoomShell; readers are ChannelSidebar's
 * per-participant rows.
 *
 * Why not React state passed down via props/context: an ActiveSpeakersChanged event
 * used to update App state, which re-rendered the whole tree (App -> ChannelSidebar
 * -> RoomView -> RoomShell) for a change that only ever affects a single avatar dot in
 * the sidebar. `useSyncExternalStore` with a per-identity selector lets each sidebar
 * row subscribe to just its own membership in a Set/Map — the row only re-renders when
 * ITS OWN speaking/muted/deafened/avatar value actually changes, and nothing above
 * ChannelSidebar (App, RoomView, RoomShell) re-renders at all since none of them read
 * from this store.
 *
 * No new dependency: this is a ~30-line manual store, the same shape React's own docs
 * use to demonstrate `useSyncExternalStore` without the `use-sync-external-store` shim
 * (safe here since selectors return primitives/stable-until-written references, so
 * `Object.is` comparison in React 18 is all we need — no external "with-selector" package).
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
// In-memory-only layer (localStorage persistence stays exactly where it already
// happened — useAvatarSync.ts and useAvatarCache.ts — this just replaces the old
// App.liveAvatarCache + useAvatarCache's own useState<Map> duplicates of the same data).
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

/** Whole-set snapshot — only used where the full set identity matters (none currently;
 *  kept for symmetry / future use, prefer the per-identity selectors below). */
export function useSpeakingUsers(): Set<string> {
    return useSyncExternalStore(speakingStore.subscribe, speakingStore.get);
}

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
