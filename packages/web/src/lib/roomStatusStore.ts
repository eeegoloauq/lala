import { useSyncExternalStore } from 'react';
import type { BotDetails } from './bots';
import { createStore } from './store';
import { clearPendingBots } from './pendingBots';

/**
 * External store for volatile, high-frequency room status: speaking, muted and deafened
 * identities, live participants, and everyone's avatar URL. Room-lifetime hooks deep in
 * RoomShell (useRoomStatusSync) write the call's slices and App the avatars (usePublishAvatars);
 * ChannelSidebar rows, tiles and profile cards read it.
 *
 * Not React state passed down: an active-speaker change would re-render App and
 * everything under it for one avatar dot. With useSyncExternalStore and a per-identity
 * selector, only the row whose value changed re-renders. Selectors return primitives or
 * references that stay the same until written, so Object.is comparison is enough.
 */

const speakingStore = createStore<Set<string>>(new Set());
const mutedStore = createStore<Set<string>>(new Set());
const deafenedStore = createStore<Set<string>>(new Set());
const liveParticipantsStore = createStore<Map<string, string>>(new Map());
// Avatar URL by identity, for everyone in any listed room; not room-scoped.
const avatarStore = createStore<Map<string, string>>(new Map());
// Bots in the active room, by identity.
const botsStore = createStore<Map<string, BotDetails>>(new Map());
// Text a profile card asks the chat composer to take (a bot command); the composer clears it.
const chatDraftStore = createStore<string | null>(null);

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

export function setBotsInRoom(bots: Map<string, BotDetails>): void {
    botsStore.set(bots);
}

/** Puts text in the chat box without sending it. */
export function requestChatDraft(text: string | null): void {
    chatDraftStore.set(text);
}

/** Replaces the avatar map; a map with the same entries keeps the old one, so nothing re-renders. */
export function setAvatars(next: Map<string, string>): void {
    const current = avatarStore.get();
    if (current.size === next.size && [...next].every(([id, url]) => current.get(id) === url)) return;
    avatarStore.set(next);
}

/** Resets every room-scoped slice — mirrors the previous App.handleLeave resets
 *  (speakingUsers/mutedInRoom/deafenedInRoom/liveParticipants all
 *  cleared together when the user explicitly leaves a room). */
export function resetRoomSession(): void {
    speakingStore.set(new Set());
    mutedStore.set(new Set());
    deafenedStore.set(new Set());
    liveParticipantsStore.set(new Map());
    botsStore.set(new Map());
    chatDraftStore.set(null);
    clearPendingBots();
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

export function useAvatarMap(): Map<string, string> {
    return useSyncExternalStore(avatarStore.subscribe, avatarStore.get);
}

export function useAvatarForIdentity(identity: string): string | undefined {
    return useSyncExternalStore(avatarStore.subscribe, () => avatarStore.get().get(identity));
}

export function useBotsInRoom(): Map<string, BotDetails> {
    return useSyncExternalStore(botsStore.subscribe, botsStore.get);
}

export function useBotDetails(identity: string): BotDetails | undefined {
    return useSyncExternalStore(botsStore.subscribe, () => botsStore.get().get(identity));
}

export function useChatDraft(): string | null {
    return useSyncExternalStore(chatDraftStore.subscribe, chatDraftStore.get);
}
