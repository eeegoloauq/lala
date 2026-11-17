import { useEffect, useRef, useState } from 'react';
import { getMe } from '../lib/api';
import { redeemPendingClaim } from '../lib/adminClaim';
import type { Me } from '../lib/types';

/** Who this device is to the server and what it may do; null until known or if the server can't be reached. */
export function useMe() {
    const [me, setMe] = useState<Me | null>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const claim = useRef<Promise<void> | null>(null);
    useEffect(() => {
        let active = true;
        claim.current ??= redeemPendingClaim();
        claim.current.then(getMe).then(
            value => { if (active) setMe(value); },
            err => {
                if (!active) return;
                console.warn('[useMe] failed:', err);
                setFailed(true);
            },
        );
        return () => { active = false; };
    }, [attempt]);
    return { me, failed, retry: () => { setFailed(false); setAttempt(n => n + 1); } };
}
