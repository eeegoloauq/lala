import { createHmac, timingSafeEqual } from 'crypto';
import type { PresenceChoice, PresencePerson, PresenceStatus } from '@lala/shared';
import { redis } from './redis';
import { broadcastSse } from './sse';

/**
 * Who has the app open. Each open app holds the event stream with a ticket that names its
 * identity, and sends its status every 30 seconds. Online people are a sorted set in Redis
 * scored by when they drop out without another heartbeat, so several API instances agree
 * and an app that vanished without closing its stream (a laptop put to sleep) drops out by
 * itself. A closed stream takes its person out at once, after a short grace for reconnects.
 */

const ONLINE = 'lala:presence:online';                       // identity -> expiry (ms)
const stateKey = (identity: string) => `lala:presence:${identity}`; // hash: name, status, idle, at

/** Clients send their status this often; a few missed beats in a throttled background tab still count. */
export const BEAT_MS = 30_000;
const ONLINE_FOR_MS = 5 * BEAT_MS;
/** The last name and status are kept this long, so an offline member still shows under their name. */
const STATE_TTL_S = 90 * 24 * 60 * 60;
/** A stream that reconnects within this time doesn't flicker offline. */
const CLOSE_GRACE_MS = 5_000;
const TICKET_TTL_S = 5 * 60;
const BROADCAST_DELAY_MS = 1_000;

export const PRESENCE_CHOICES: readonly PresenceChoice[] = ['online', 'idle', 'dnd', 'invisible'];

export interface PresenceState {
    name?: string;
    status?: PresenceChoice;
    idle?: boolean;
    /** When the app last sent its status (ms), to pick a member's latest device. */
    at?: number;
}

// ─── Tickets ───
// EventSource can't send the device header, so the client trades it for a ticket that
// names only the public identity. It proves the stream belongs to that identity.

function ticketSignature(identity: string, expiry: number): string {
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!secret) throw new Error('LIVEKIT_API_SECRET must be set');
    const key = createHmac('sha256', secret).update('lala-presence-ticket').digest();
    return createHmac('sha256', key).update(`${identity}.${expiry}`).digest('base64url');
}

export function issueTicket(identity: string, now = Date.now()): string {
    const expiry = Math.floor(now / 1000) + TICKET_TTL_S;
    return `${identity}.${expiry}.${ticketSignature(identity, expiry)}`;
}

/** The identity of a valid, unexpired ticket, or null. */
export function verifyTicket(ticket: string, now = Date.now()): string | null {
    const parts = ticket.split('.');
    if (parts.length !== 3) return null;
    const [identity, expiryText, sig] = parts;
    const expiry = Number(expiryText);
    if (!identity || !Number.isInteger(expiry) || expiry <= now / 1000) return null;
    const expected = Buffer.from(ticketSignature(identity, expiry));
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected) ? identity : null;
}

// ─── Status ───

/** What others see of a chosen status: invisible is offline, and online goes idle without input. */
export function shownStatus(state: PresenceState | undefined): PresenceStatus {
    const choice = state?.status ?? 'online';
    if (choice === 'invisible') return 'offline';
    return choice === 'online' && state?.idle ? 'idle' : choice;
}

let broadcastTimer: ReturnType<typeof setTimeout> | undefined;
/** One event for a burst of changes; clients refetch the list on it. */
function announce(): void {
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
        broadcastTimer = undefined;
        broadcastSse('presence_updated');
    }, BROADCAST_DELAY_MS);
}

/** Marks the identity online for another stretch; announces it when it wasn't. */
async function markOnline(identity: string): Promise<void> {
    const added = await redis().zadd(ONLINE, Date.now() + ONLINE_FOR_MS, identity);
    if (added > 0) announce();
}

/** A heartbeat with the app's status; announces a change others would see. */
export async function beat(identity: string, state: Required<Omit<PresenceState, 'at'>>): Promise<void> {
    const key = stateKey(identity);
    const [[, before]] = (await redis().multi()
        .hgetall(key)
        .hset(key, { name: state.name, status: state.status, idle: state.idle ? '1' : '0', at: String(Date.now()) })
        .expire(key, STATE_TTL_S)
        .exec()) as [[Error | null, Record<string, string>]];
    const previous = parseState(before);
    if (previous.name !== state.name || shownStatus(previous) !== shownStatus(state)) announce();
    await markOnline(identity);
}

// Streams this instance holds, by identity: several tabs and devices share one identity.
const streams = new Map<string, number>();

export async function streamOpened(identity: string): Promise<void> {
    streams.set(identity, (streams.get(identity) ?? 0) + 1);
    await markOnline(identity);
}

export function streamClosed(identity: string): void {
    const left = (streams.get(identity) ?? 1) - 1;
    if (left > 0) {
        streams.set(identity, left);
        return;
    }
    streams.delete(identity);
    setTimeout(() => {
        if (streams.has(identity)) return;
        redis().zrem(ONLINE, identity)
            .then((removed) => { if (removed > 0) announce(); })
            .catch((err) => console.error('[presence] dropping a closed stream failed:', err));
    }, CLOSE_GRACE_MS);
}

/** Drops people whose heartbeats stopped; runs on a timer. */
export async function sweepPresence(): Promise<void> {
    const removed = await redis().zremrangebyscore(ONLINE, '-inf', Date.now());
    if (removed > 0) announce();
}

function parseState(raw: Record<string, string> | undefined): PresenceState {
    if (!raw) return {};
    const status = PRESENCE_CHOICES.includes(raw.status as PresenceChoice) ? raw.status as PresenceChoice : undefined;
    const at = Number(raw.at);
    return { name: raw.name || undefined, status, idle: raw.idle === '1', at: Number.isFinite(at) ? at : undefined };
}

/** The online identities, and the stored state of those and of `also` (the config's members). */
export async function loadPresence(also: Iterable<string>): Promise<{ online: Set<string>; states: Map<string, PresenceState> }> {
    const online = new Set(await redis().zrangebyscore(ONLINE, Date.now(), '+inf'));
    const ids = [...new Set([...online, ...also])];
    const states = new Map<string, PresenceState>();
    if (ids.length === 0) return { online, states };
    const pipeline = redis().pipeline();
    for (const id of ids) pipeline.hgetall(stateKey(id));
    const results = (await pipeline.exec()) ?? [];
    ids.forEach((id, i) => states.set(id, parseState(results[i]?.[1] as Record<string, string> | undefined)));
    return { online, states };
}

interface ListInput {
    online: Set<string>;
    states: Map<string, PresenceState>;
    /** The config's people by identity; one member may have several. */
    users: Map<string, { name: string }>;
    banned: Set<string>;
    caller: string;
}

/**
 * The people list: everyone online once, a member with several devices as one row (their
 * latest), members who aren't online as offline, and nobody who is invisible except to
 * themselves. Without avatars, which the route adds.
 */
export function buildPresenceList({ online, states, users, banned, caller }: ListInput): PresencePerson[] {
    const visible = (id: string) => id === caller || (online.has(id) && states.get(id)?.status !== 'invisible');
    const statusOf = (id: string): PresenceStatus => online.has(id) ? shownStatus(states.get(id)) : 'offline';
    const latest = (ids: string[]) => ids.reduce((a, b) => (states.get(b)?.at ?? 0) > (states.get(a)?.at ?? 0) ? b : a);

    const members = new Map<string, string[]>();
    for (const [id, user] of users) {
        if (banned.has(id)) continue;
        members.set(user.name, [...(members.get(user.name) ?? []), id]);
    }

    const people: PresencePerson[] = [];
    const listed = new Set<string>();
    for (const [memberName, ids] of members) {
        for (const id of ids) listed.add(id);
        const shown = ids.filter(id => visible(id) && statusOf(id) !== 'offline');
        // The caller's own row stays theirs, even when another of their devices is online.
        const id = ids.includes(caller) ? caller : latest(shown.length > 0 ? shown : ids);
        people.push({ identity: id, name: states.get(id)?.name ?? memberName, status: shown.includes(id) || id === caller ? statusOf(id) : 'offline' });
    }
    for (const id of new Set([...online, caller])) {
        if (listed.has(id) || banned.has(id) || !visible(id)) continue;
        const name = states.get(id)?.name;
        if (name) people.push({ identity: id, name, status: statusOf(id) });
    }
    return people;
}
