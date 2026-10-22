import { redis } from './redis';

/**
 * Server bans, set by admins. The identity stays banned until lifted; the address it
 * last joined from is banned for a day, which stops the easy way around (a new device
 * ID) without shutting a shared or reassigned address out for good.
 */

const BANS = 'lala:server-bans';                              // identity -> name
const lastIpKey = (identity: string) => `lala:last-ip:${identity}`;
const ipBanKey = (ip: string) => `lala:ip-ban:${ip}`;          // -> banned identity
const bannedIpKey = (identity: string) => `lala:banned-ip:${identity}`; // -> its banned address
const IP_DAY = 24 * 60 * 60;

/** Kept as long as an address ban would last, and only so that one can be made. */
export const recordIp = (identity: string, ip: string) => redis().set(lastIpKey(identity), ip, 'EX', IP_DAY);

export async function banFromServer(identity: string, name: string): Promise<void> {
    const ip = await redis().get(lastIpKey(identity));
    const tx = redis().multi().hset(BANS, identity, name);
    if (ip) tx.set(ipBanKey(ip), identity, 'EX', IP_DAY).set(bannedIpKey(identity), ip, 'EX', IP_DAY);
    await tx.exec();
}

export async function unbanFromServer(identity: string): Promise<void> {
    const ip = await redis().get(bannedIpKey(identity));
    const tx = redis().multi().hdel(BANS, identity).del(bannedIpKey(identity));
    if (ip) tx.del(ipBanKey(ip));
    await tx.exec();
}

export async function isShutOut(identity: string, ip: string | undefined): Promise<boolean> {
    const [banned, ipBanned] = await Promise.all([
        redis().hexists(BANS, identity),
        ip ? redis().exists(ipBanKey(ip)) : Promise.resolve(0),
    ]);
    return banned === 1 || ipBanned === 1;
}

/** Each ban with when its address ban ends, if there is one. */
export async function listServerBans(): Promise<Array<{ identity: string; name: string; ipBannedUntil?: number }>> {
    const bans = Object.entries(await redis().hgetall(BANS));
    return Promise.all(bans.map(async ([identity, name]) => {
        const ttl = await redis().ttl(bannedIpKey(identity));
        return { identity, name, ipBannedUntil: ttl > 0 ? Date.now() + ttl * 1000 : undefined };
    }));
}
