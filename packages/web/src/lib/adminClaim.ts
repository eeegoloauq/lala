import { claimAdmin } from './api';

/**
 * The link `setup.sh` prints (`#claim=<token>`) makes whoever opens it the server's first
 * admin. The token is taken from the URL at startup and redeemed before the app asks who
 * it is, so `/api/me` already says admin.
 */
let pending: string | null = null;

export const setPendingClaim = (token: string | null) => { pending = token; };

export async function redeemPendingClaim(): Promise<void> {
    const token = pending;
    pending = null;
    if (!token) return;
    // Refused when the server already has an admin or the token was used: nothing to do then.
    await claimAdmin(token).catch((err) => console.warn('[adminClaim] The admin link was not accepted:', err));
}
