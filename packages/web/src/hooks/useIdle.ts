import { useEffect, useState } from 'react';
import { useIsSpeaking } from '../lib/roomStatusStore';

/** Input events that count as being at the computer. */
const ACTIVITY = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * True after `afterMs` without input. The desktop app knows input anywhere on the computer,
 * so working in another program isn't idle; a browser only sees input in this page.
 * Talking in a call counts as activity, so someone in a long conversation who doesn't
 * touch the keyboard doesn't go idle.
 */
export function useIdle(afterMs: number, identity: string | undefined): boolean {
    const [idle, setIdle] = useState(false);
    const speaking = useIsSpeaking(identity ?? '');
    useEffect(() => {
        let last = Date.now();
        const onActivity = () => {
            last = Date.now();
            setIdle(false);
        };
        const systemIdle = window.electronAPI?.getSystemIdleTime;
        // Checked on a timer, not on each event: pointermove fires many times a second.
        const check = async () => {
            const seconds = systemIdle ? await systemIdle().catch(() => null) : null;
            // The page's own input and speaking reset `last`; the system's covers other programs.
            const since = Math.min(Date.now() - last, seconds === null ? Infinity : seconds * 1000);
            setIdle(since >= afterMs);
        };
        for (const type of ACTIVITY) window.addEventListener(type, onActivity, { passive: true });
        const timer = setInterval(check, Math.min(afterMs / 4, 15_000));
        return () => {
            for (const type of ACTIVITY) window.removeEventListener(type, onActivity);
            clearInterval(timer);
        };
    }, [afterMs, speaking]);
    return idle;
}
