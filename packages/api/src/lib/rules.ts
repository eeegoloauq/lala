import type { NextFunction, Request, Response } from 'express';
import type { ServerRules } from '@lala/shared';
import { config } from './config';
import { redis } from './redis';
import { callerIdentity } from './identity';
import { isBotIdentity } from './bots';

/**
 * The server's rules from the config. Each version (a hash of the text) is dated by when
 * the server first saw it, and each person's agreement names the version they agreed to,
 * so an edit asks everyone again. While the rules are required, people who haven't agreed
 * get `403 rules_required` from rooms, tokens, presence and chats.
 */

const SEEN = 'lala:rules-seen';          // version -> first seen (ms)
const ACCEPTED = 'lala:rules-accepted';  // identity -> version agreed to

let seenAt = Date.now();
/** People who agreed to the current version; nobody takes an agreement back. */
const acceptedCache = new Set<string>();

/** Records when this version of the rules first appeared; at startup. */
export async function loadRules(): Promise<void> {
    const rules = config().rules;
    if (!rules) return;
    await redis().hsetnx(SEEN, rules.version, String(Date.now()));
    seenAt = Number(await redis().hget(SEEN, rules.version)) || Date.now();
}

/** Whether these people agreed to the current version; the rest of the identities given. */
export async function acceptedAmong(identities: string[]): Promise<Set<string>> {
    const rules = config().rules;
    if (!rules) return new Set(identities);
    const result = new Set(identities.filter((id) => acceptedCache.has(id)));
    const unknown = [...new Set(identities.filter((id) => !result.has(id)))];
    if (unknown.length === 0) return result;
    const versions = await redis().hmget(ACCEPTED, ...unknown);
    unknown.forEach((id, i) => {
        if (versions[i] === rules.version) {
            acceptedCache.add(id);
            result.add(id);
        }
    });
    return result;
}

export const hasAccepted = async (identity: string) => (await acceptedAmong([identity])).has(identity);

/** Whether this person still has to agree before doing anything. Bots never do. */
export async function rulesPending(identity: string | undefined): Promise<boolean> {
    if (!config().rules?.required || isBotIdentity(identity)) return false;
    return !identity || !await hasAccepted(identity);
}

/** False for a version that isn't the current one: the person read something else. */
export async function acceptRules(identity: string, version: string): Promise<boolean> {
    const rules = config().rules;
    if (!rules || version !== rules.version) return false;
    await redis().hset(ACCEPTED, identity, version);
    acceptedCache.add(identity);
    return true;
}

export async function rulesFor(identity: string): Promise<ServerRules | undefined> {
    const rules = config().rules;
    if (!rules) return undefined;
    return { text: rules.text, version: rules.version, required: rules.required, accepted: await hasAccepted(identity), updatedAt: seenAt };
}

/** The gate in front of rooms, tokens, presence and chats. */
export function requireRules(req: Request, res: Response, next: NextFunction): void {
    rulesPending(callerIdentity(req)).then((pending) => {
        if (pending) res.status(403).json({ error: 'rules_required' });
        else next();
    }, next);
}
