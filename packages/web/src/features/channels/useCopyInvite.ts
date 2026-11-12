import { useCallback } from 'react';
import { getRoomPassword } from '../../lib/passwords';
import { createAccessInvite } from '../../lib/api';
import { useAccessRequired } from '../access/accessContext';
import { useTimedValue } from '../../hooks/useTimedValue';
import { IS_TOUCH } from '../../lib/env';

/** The room's link; the password and server invite go in the fragment, which browsers never send to a server. */
function roomLink(roomId: string, password: string | null, invite: string | null): string {
    const params = new URLSearchParams();
    if (password) params.set('pw', password);
    if (invite) params.set('invite', invite);
    const hash = params.toString();
    return `${window.location.origin}${import.meta.env.BASE_URL}room/${roomId}${hash ? `#${hash}` : ''}`;
}

/**
 * Copies a link to a room: with its saved password and, on a private server, a server
 * invite. `copied` is the room whose link was just copied, for a moment.
 *
 * `share` opens the system share sheet on touch screens, the usual way to send a link from
 * a phone, and copies elsewhere. It shares only a link it can build at once: the share sheet
 * needs the tap that asked for it, and fetching a server invite first can outlast that, so a
 * private server's link is copied instead (the clipboard accepts a pending link).
 */
export function useCopyInvite(): {
    copy: (roomId: string, hasPassword: boolean) => void;
    share: (roomId: string, hasPassword: boolean) => void;
    copied: string | null;
} {
    const accessRequired = useAccessRequired();
    const [copied, showCopied] = useTimedValue<string>(1500);

    const copy = useCallback((roomId: string, hasPassword: boolean) => {
        const password = hasPassword ? getRoomPassword(roomId) : null;
        const buildUrl = async () => roomLink(roomId, password, accessRequired ? await createAccessInvite() : null);
        // Handing the clipboard a promise keeps the click's permission to write while the invite loads.
        const text = buildUrl().then(url => new Blob([url], { type: 'text/plain' }));
        navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })]).then(() => {
            showCopied(roomId);
        }).catch(err => console.warn('[useCopyInvite] Copying the invite failed:', err));
    }, [accessRequired, showCopied]);

    const share = useCallback((roomId: string, hasPassword: boolean) => {
        if (!IS_TOUCH || accessRequired || typeof navigator.share !== 'function') {
            copy(roomId, hasPassword);
            return;
        }
        const url = roomLink(roomId, hasPassword ? getRoomPassword(roomId) : null, null);
        navigator.share({ url }).catch(err => {
            // AbortError: the person closed the sheet. Anything else: no share target, so copy.
            if ((err as Error).name !== 'AbortError') copy(roomId, hasPassword);
        });
    }, [accessRequired, copy]);

    return { copy, share, copied };
}
