import { useEffect } from 'react';
import type { RoomInfo } from '../lib/types';
import { avatarUrl } from '../lib/avatarUtils';
import { setAvatars } from '../lib/roomStatusStore';
import { usePresence } from '../lib/presence';

/**
 * Puts everyone's avatar URL in the store that tiles, sidebar rows and profile cards read:
 * people in any listed room and everyone in the people list from the server's lists (they
 * carry each avatar's version), and
 * this device's own from its local copy, which shows at once and without a request.
 */
export function usePublishAvatars(rooms: RoomInfo[], identity: string | undefined, myAvatar: string | null): void {
    const presence = usePresence();
    useEffect(() => {
        const avatars = new Map<string, string>();
        for (const p of presence?.values() ?? []) {
            const url = avatarUrl(p.identity, p.avatar);
            if (url) avatars.set(p.identity, url);
        }
        for (const room of rooms) {
            for (const p of room.participants) {
                const url = avatarUrl(p.identity, p.avatar);
                if (url) avatars.set(p.identity, url);
            }
        }
        if (identity) {
            if (myAvatar) avatars.set(identity, myAvatar);
            else avatars.delete(identity);
        }
        setAvatars(avatars);
    }, [rooms, presence, identity, myAvatar]);
}
