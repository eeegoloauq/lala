import { useEffect, useState } from 'react';
import { getMe } from '../lib/api';
import { redeemPendingClaim } from '../lib/adminClaim';
import type { Me } from '../lib/types';

/** Who this device is to the server and what it may do; null until known or if the server can't be reached. */
export function useMe(): Me | null {
    const [me, setMe] = useState<Me | null>(null);
    useEffect(() => {
        redeemPendingClaim().then(getMe).then(setMe, (err) => console.warn('[useMe] failed:', err));
    }, []);
    return me;
}
