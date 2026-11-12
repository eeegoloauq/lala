import { useEffect } from 'react';
import { applyChatEvent, loadChannels, setChatIdentity } from '../lib/textChat';
import { IS_DEMO } from '../lib/env';

/**
 * Loads the text chats once the caller is known. Events arrive on the event stream that
 * useRooms keeps open (it calls applyChatEvent and, after a reconnect, resyncChat); the demo
 * announces its own.
 */
export function useTextChatSync(identity: string | undefined, enabled: boolean): void {
    // A server without text chats says so in /api/me; asking it anyway would only log a 404.
    useEffect(() => {
        setChatIdentity(identity);
        if (identity && enabled) loadChannels();
    }, [identity, enabled]);

    useEffect(() => {
        if (!IS_DEMO) return;
        let unsubscribe: (() => void) | undefined;
        let active = true;
        import('../features/demo/server').then(demo => {
            if (active) unsubscribe = demo.onChatEvent(applyChatEvent);
        });
        return () => { active = false; unsubscribe?.(); };
    }, []);
}
