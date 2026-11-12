import { useEffect, useRef } from 'react';
import type { PresenceChoice } from '../lib/types';
import { getPresence, putPresence } from '../lib/api';
import { ApiError } from '../lib/types';
import { presenceChanged, setMyStatus, setPresence, shownStatus, usePresenceChanges } from '../lib/presence';
import { IS_DEMO } from '../lib/env';
import { useIdle } from './useIdle';

/** No input for this long shows someone as idle; shorter in the demo, so a visitor sees it happen. */
const IDLE_AFTER_MS = IS_DEMO ? 60_000 : 10 * 60_000;
/** The heartbeat: the server drops a device that stops sending it (a computer put to sleep). */
const BEAT_MS = 30_000;

/**
 * Tells the server this device's status, every 30 seconds and on each change, and keeps the
 * presence store current: fetched again on every `presence_updated` event (see useRooms).
 */
export function usePresenceSync(identity: string | undefined, name: string, choice: PresenceChoice): void {
    const idle = useIdle(IDLE_AFTER_MS, identity);

    useEffect(() => {
        setMyStatus(shownStatus(choice, idle));
        if (!identity || !name) return;
        const send = () => putPresence({ status: choice, idle, name }).catch(() => { /* the next beat tries again */ });
        send();
        const timer = setInterval(send, BEAT_MS);
        return () => clearInterval(timer);
    }, [identity, name, choice, idle]);

    // The demo announces its people's changes with its room changes.
    useEffect(() => {
        if (!IS_DEMO) return;
        let unsubscribe: (() => void) | undefined;
        let active = true;
        import('../features/demo/server').then(demo => {
            if (active) unsubscribe = demo.onRoomsChanged(presenceChanged);
        });
        return () => { active = false; unsubscribe?.(); };
    }, []);

    // A burst of events is one request in flight and at most one after it.
    const changes = usePresenceChanges();
    const loading = useRef<Promise<void> | null>(null);
    const stale = useRef(false);
    useEffect(() => {
        if (loading.current) {
            stale.current = true;
            return;
        }
        const run = async () => {
            do {
                stale.current = false;
                try {
                    setPresence(await getPresence());
                } catch (err) {
                    // A server without presence answers 404; the people list then stays away.
                    if (err instanceof ApiError && err.status === 404) setPresence(null);
                }
            } while (stale.current);
            loading.current = null;
        };
        loading.current = run();
    }, [changes, identity]);
}
