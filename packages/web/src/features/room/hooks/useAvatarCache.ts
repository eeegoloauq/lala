import { useEffect } from 'react';
import type { LocalParticipant, Participant, Room } from 'livekit-client';
import { useAvatarSync } from '../../../hooks/useAvatarSync';
import { getCachedAvatar, setCachedAvatar, clearCachedAvatar } from '../../../lib/avatarUtils';
import { useAvatarCacheMap, setAvatarCacheEntry, seedAvatarCacheIfMissing } from '../../../lib/roomStatusStore';

export interface UseAvatarCacheOptions {
    room: Room;
    /** Current participant snapshot, used only to pre-seed the cache from localStorage. */
    participants: Participant[];
    localParticipant: LocalParticipant;
    myAvatarUrl?: string | null;
}

/**
 * Feeds the identity -> avatar cache in the room-status store (lib/roomStatusStore.ts),
 * which tiles and ChannelSidebar both read. Three sources:
 *  1. Pre-population from localStorage for participants already in the room on mount

 *  2. `useAvatarSync`, which broadcasts our own avatar and receives others' over the
 *     data channel.
 *  3. The local participant's own avatar (from `myAvatarUrl`), persisted to
 *     localStorage so ChannelSidebar can find it by identity too.
 */
export function useAvatarCache({
    room,
    participants,
    localParticipant,
    myAvatarUrl,
}: UseAvatarCacheOptions): Map<string, string> {
    // Pre-populate avatarCache from localStorage for participants already in the room.
    useEffect(() => {
        for (const p of participants) {
            const cached = getCachedAvatar(p.identity);
            if (cached) seedAvatarCacheIfMissing(p.identity, cached);
        }
    }, [participants]);

    // setAvatarCacheEntry already persists nothing itself (in-memory only) — the
    // localStorage side of a received avatar is handled inside useAvatarSync itself.
    useAvatarSync({ room, myAvatarUrl: myAvatarUrl ?? null, onAvatarReceived: setAvatarCacheEntry });

    // Keep own avatar in the cache so local participant tile shows it too.
    // Also persist to localStorage, where the sidebar reads it.
    useEffect(() => {
        const id = localParticipant.identity;
        if (!id) return;
        setAvatarCacheEntry(id, myAvatarUrl ?? null);
        // Persist to localStorage so ChannelSidebar can find own avatar by LiveKit identity
        if (myAvatarUrl) setCachedAvatar(id, myAvatarUrl);
        else clearCachedAvatar(id);
    }, [myAvatarUrl, localParticipant.identity]);

    return useAvatarCacheMap();
}
