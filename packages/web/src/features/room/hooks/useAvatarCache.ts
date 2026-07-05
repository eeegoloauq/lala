import { useEffect, useCallback, useState } from 'react';
import type { LocalParticipant, Participant, Room } from 'livekit-client';
import { useAvatarSync } from '../../../hooks/useAvatarSync';
import { getCachedAvatar, setCachedAvatar, clearCachedAvatar } from '../../../lib/avatarUtils';

export interface UseAvatarCacheOptions {
    room: Room;
    /** Current participant snapshot, used only to pre-seed the cache from localStorage. */
    participants: Participant[];
    localParticipant: LocalParticipant;
    myAvatarUrl?: string | null;
    onIdentityAssigned?: (identity: string) => void;
    onAvatarReceived?: (identity: string, dataUrl: string | null) => void;
}

/**
 * Owns the identity -> avatar-data-URL cache shown on participant tiles.
 * Three sources feed it, in the same order they ran as separate effects in RoomShell:
 *  1. Pre-population from localStorage for participants already in the room on mount
 *     (name-based fallback so avatars survive identity rotation across page refreshes).
 *  2. `useAvatarSync`, which broadcasts our own avatar and receives others' over the
 *     data channel.
 *  3. The local participant's own avatar (from `myAvatarUrl`), plus notifying the
 *     parent of the freshly-assigned LiveKit identity and persisting to localStorage
 *     so ChannelSidebar can find it by identity too.
 */
export function useAvatarCache({
    room,
    participants,
    localParticipant,
    myAvatarUrl,
    onIdentityAssigned,
    onAvatarReceived,
}: UseAvatarCacheOptions): Map<string, string> {
    const [avatarCache, setAvatarCache] = useState<Map<string, string>>(new Map());

    // Pre-populate avatarCache from localStorage for participants already in the room.
    useEffect(() => {
        setAvatarCache(prev => {
            let changed = false;
            const next = new Map(prev);
            for (const p of participants) {
                if (!next.has(p.identity)) {
                    const cached = getCachedAvatar(p.identity);
                    if (cached) { next.set(p.identity, cached); changed = true; }
                }
            }
            return changed ? next : prev;
        });
    }, [participants]);

    const handleAvatarReceived = useCallback((identity: string, dataUrl: string | null) => {
        setAvatarCache(prev => {
            const next = new Map(prev);
            if (dataUrl) next.set(identity, dataUrl);
            else next.delete(identity);
            return next;
        });
        onAvatarReceived?.(identity, dataUrl);
    }, [onAvatarReceived]);

    useAvatarSync({ room, myAvatarUrl: myAvatarUrl ?? null, onAvatarReceived: handleAvatarReceived });

    // Keep own avatar in the cache so local participant tile shows it too.
    // Also persist to localStorage (sidebar reads from there) and notify parent of LiveKit identity.
    useEffect(() => {
        const id = localParticipant.identity;
        if (!id) return;
        onIdentityAssigned?.(id);
        setAvatarCache(prev => {
            if (prev.get(id) === (myAvatarUrl ?? undefined)) return prev;
            const next = new Map(prev);
            if (myAvatarUrl) {
                next.set(id, myAvatarUrl);
            } else {
                next.delete(id);
            }
            return next;
        });
        // Persist to localStorage so ChannelSidebar can find own avatar by LiveKit identity
        if (myAvatarUrl) setCachedAvatar(id, myAvatarUrl);
        else clearCachedAvatar(id);
    }, [myAvatarUrl, localParticipant.identity]);

    return avatarCache;
}
