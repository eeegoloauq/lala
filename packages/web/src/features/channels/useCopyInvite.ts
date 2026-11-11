import { useCallback } from 'react';
import { getRoomPassword } from '../../lib/passwords';
import { createAccessInvite } from '../../lib/api';
import { useAccessRequired } from '../access/accessContext';
import { useTimedValue } from '../../hooks/useTimedValue';

/**
 * Copies a link to a room: with its saved password and, on a private server, a server
 * invite, both in the fragment, which browsers never send to a server. `copied` is the
 * room whose link was just copied, for a moment.
 */
export function useCopyInvite(): { copy: (roomId: string, hasPassword: boolean) => void; copied: string | null } {
    const accessRequired = useAccessRequired();
    const [copied, showCopied] = useTimedValue<string>(1500);

    const copy = useCallback((roomId: string, hasPassword: boolean) => {
        const buildUrl = async () => {
            const params = new URLSearchParams();
            const pw = hasPassword ? getRoomPassword(roomId) : null;
            if (pw) params.set('pw', pw);
            if (accessRequired) params.set('invite', await createAccessInvite());
            const hash = params.toString();
            return `${window.location.origin}${import.meta.env.BASE_URL}room/${roomId}${hash ? `#${hash}` : ''}`;
        };
        // Handing the clipboard a promise keeps the click's permission to write while the invite loads.
        const text = buildUrl().then(url => new Blob([url], { type: 'text/plain' }));
        navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })]).then(() => {
            showCopied(roomId);
        }).catch(err => console.warn('[useCopyInvite] Copying the invite failed:', err));
    }, [accessRequired, showCopied]);

    return { copy, copied };
}
