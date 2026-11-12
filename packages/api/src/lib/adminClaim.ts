import { createHash, timingSafeEqual } from 'crypto';
import { config } from './config';
import { redis } from './redis';

/**
 * The first admin of a new server, without editing the config: `setup.sh` puts a random
 * token in `LALA_ADMIN_CLAIM` and prints a link carrying it. Whoever opens that link first
 * becomes admin, once: the token is spent for good, and it does nothing on a server that
 * already has an admin. A server set up before this has no token, so nobody can claim it.
 */

const CLAIMED = 'lala:claimed-admins';  // set of identities
const SPENT = 'lala:admin-claim-spent'; // the identity that used the token

let claimed = new Set<string>();

export async function loadClaimedAdmins(): Promise<void> {
    claimed = new Set(await redis().smembers(CLAIMED));
}

export const isClaimedAdmin = (identity: string) => claimed.has(identity);

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Makes the caller admin when the token is right and unused and there is no admin yet. */
export async function claimAdmin(identity: string, token: string): Promise<boolean> {
    const expected = process.env.LALA_ADMIN_CLAIM ?? '';
    if (expected.length < 16 || !timingSafeEqual(digest(token), digest(expected))) return false;
    if (claimed.size > 0 || [...config().users.values()].some((u) => u.role === 'admin')) return false;
    // One winner even if the link is opened twice at once.
    if (await redis().set(SPENT, identity, 'NX') !== 'OK') return false;
    await redis().sadd(CLAIMED, identity);
    claimed.add(identity);
    console.log(`[claim] ${identity} is now admin`);
    return true;
}
