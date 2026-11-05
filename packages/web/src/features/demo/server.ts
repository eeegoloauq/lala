/**
 * The API of the demo build (`npm run build:demo`), answered inside the page. It keeps
 * the routes, status codes and error codes of packages/api so the client code runs
 * unchanged; state lives in memory and resets on reload. Nothing here goes over the
 * network, and the regular build never includes this module (see IS_DEMO).
 */
import type { AccessStatus, Me, RoomBan, RoomInfo, ServerBan, TokenResponse } from '../../lib/types';
import { deriveRoomKeys } from '../../lib/roomKeys';

interface Person { identity: string; name: string }

interface DemoRoom {
    id: string;
    name: string;
    createdAt: number;
    creator: string;
    maxParticipants: number;
    permanent: boolean;
    salt?: string;
    key?: string;
    people: Person[];
    muted: Set<string>;
    deafened: Set<string>;
    serverMuted: Set<string>;
    sharing: Set<string>;
    bans: RoomBan[];
}

/** The visitor: an admin, so every moderation control is there to try. */
const ME = 'demo00000000000000000000000000000you';
/** The password of the seeded locked room; its name says it. */
export const DEMO_PASSWORD = 'lala';

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
const person = (name: string): Person => ({ identity: `demo-${name.toLowerCase()}-${randomId()}`, name });

const CROWD = ['Mira', 'Theo', 'Sasha', 'Ines', 'Kofi', 'Lena', 'Ravi', 'Yuki', 'Omar', 'Elsa', 'Nika', 'Jonas'].map(person);

function room(name: string, people: Person[], extra: Partial<DemoRoom> = {}): DemoRoom {
    return {
        id: randomId(),
        name,
        createdAt: Date.now() - 1000 * 60 * (5 + Math.floor(Math.random() * 120)),
        creator: people[0]?.identity ?? ME,
        maxParticipants: 0,
        permanent: false,
        people,
        muted: new Set(),
        deafened: new Set(),
        serverMuted: new Set(),
        sharing: new Set(),
        bans: [],
        ...extra,
    };
}

// Seeded rooms keep fixed IDs, so a demo link like /room/lounge survives the reset on reload.
const rooms: DemoRoom[] = [
    room('Lounge', CROWD.slice(0, 4), { id: 'lounge', permanent: true, muted: new Set([CROWD[2].identity]), sharing: new Set([CROWD[1].identity]) }),
    room('Gaming', CROWD.slice(4, 7), { id: 'gaming', deafened: new Set([CROWD[6].identity]) }),
    room('Study', CROWD.slice(7, 9), { id: 'study', maxParticipants: 2 }),
    room(`Locked · ${DEMO_PASSWORD}`, CROWD.slice(9, 10), { id: 'locked' }),
    room('Late night', [], { id: 'late-night' }),
];
const serverBans: ServerBan[] = [{ identity: person('Spammer').identity, name: 'Spammer' }];
// Derived in the background like a real client would; the locked room is ready long before anyone reaches it.
const lockedRoom = rooms[3];
const lockedKeys = (async () => {
    lockedRoom.salt = btoa(randomId());
    lockedRoom.key = (await deriveRoomKeys(DEMO_PASSWORD, lockedRoom.salt)).authKey;
})();

const listeners = new Set<() => void>();
const changed = () => listeners.forEach(fn => fn());

/** Called on every room change, like the `rooms_updated` server event. Returns the unsubscribe. */
export function onRoomsChanged(fn: () => void): () => void {
    listeners.add(fn);
    startActivity();
    return () => listeners.delete(fn);
}

/** Who is in the room, as the call's live participant list would have them. */
export function peopleIn(roomId: string): Map<string, string> {
    const r = rooms.find(x => x.id === roomId);
    return new Map(r?.people.map(p => [p.identity, p.name]));
}

/** The visitor's demo call ended: they leave the room's participant list. */
export function leaveRoom(roomId: string): void {
    const r = rooms.find(x => x.id === roomId);
    if (!r) return;
    removePerson(r, ME);
    changed();
}

function removePerson(r: DemoRoom, identity: string) {
    r.people = r.people.filter(p => p.identity !== identity);
    for (const set of [r.muted, r.deafened, r.serverMuted, r.sharing]) set.delete(identity);
}

function describe(r: DemoRoom): RoomInfo {
    return {
        id: r.id,
        displayName: r.name,
        numParticipants: r.people.length,
        maxParticipants: r.maxParticipants,
        passwordSalt: r.salt,
        creationTime: r.createdAt,
        participants: r.people.map(({ identity, name }) => ({ identity, name })),
        adminIdentity: r.creator,
        permanent: r.permanent,
        canModerate: true,
        canJoin: true,
        screenSharingParticipants: [...r.sharing],
        mutedParticipants: [...r.muted],
        deafenedParticipants: [...r.deafened],
        serverMutedParticipants: [...r.serverMuted],
    };
}

// People drift between rooms, mute and share screens, so the sidebar looks like a live server.
const MAX_CROWD = 5;
let activity: ReturnType<typeof setInterval> | undefined;
function startActivity() {
    if (activity) return;
    activity = setInterval(() => {
        const busy = rooms.filter(r => r.people.some(p => p.identity !== ME));
        const from = busy[Math.floor(Math.random() * busy.length)];
        if (!from) return;
        const others = from.people.filter(p => p.identity !== ME);
        const who = others[Math.floor(Math.random() * others.length)];
        const roll = Math.random();
        if (roll < 0.35) {
            const to = rooms.filter(r => r !== from && !r.salt && r.people.length < (r.maxParticipants || MAX_CROWD));
            const target = to[Math.floor(Math.random() * to.length)];
            if (!target || from.bans.some(b => b.identity === who.identity)) return;
            removePerson(from, who.identity);
            target.people.push(who);
        } else if (roll < 0.75) {
            if (from.muted.has(who.identity)) from.muted.delete(who.identity);
            else from.muted.add(who.identity);
        } else if (from.sharing.has(who.identity)) {
            from.sharing.delete(who.identity);
        } else if (from.sharing.size === 0) {
            from.sharing.add(who.identity);
        }
        changed();
    }, 7000);
}

type Body = Record<string, unknown>;
const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = () => json(200, { ok: true });
const fail = (status: number, error: string) => json(status, { error });

/** Answers one API request, given the path after `/api`, as packages/api would. */
export async function handle(path: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    const body: Body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    // A little latency keeps loading states visible, as they are against a server.
    await new Promise(resolve => setTimeout(resolve, 120));

    if (path === '/access' && method === 'GET') return json(200, { required: false, granted: true } satisfies AccessStatus);
    if (path === '/me') return json(200, { identity: ME, role: 'admin', allowed: true, canCreateRooms: true } satisfies Me);
    if (path === '/rooms' && method === 'GET') return json(200, { rooms: rooms.map(describe) });
    if (path === '/rooms' && method === 'POST') return createRoom(body);
    if (path === '/token' && method === 'POST') return token(body);
    if (path === '/admin/bans') return json(200, { bans: serverBans });
    if (path === '/admin/ban' || path === '/admin/unban') return serverBan(path === '/admin/ban', String(body.identity ?? ''));

    const m = path.match(/^\/rooms\/([^/]+)(?:\/admin\/([a-z]+))?$/);
    const r = m && rooms.find(x => x.id === decodeURIComponent(m[1]));
    if (m && !r) return fail(404, 'room_not_found');
    if (r && !m![2]) {
        if (method === 'GET') return json(200, describe(r));
        if (method === 'DELETE') {
            if (r.permanent) return fail(403, 'forbidden');
            rooms.splice(rooms.indexOf(r), 1);
            changed();
            return ok();
        }
    }
    if (r && m![2]) return moderate(r, m![2], body);
    return fail(404, 'not_found');
}

function createRoom(body: Body): Response {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
    const max = body.maxParticipants ?? 0;
    if (!name || !Number.isInteger(max) || (max as number) < 0 || (max as number) > 100) return fail(400, 'invalid_input');
    const existing = rooms.find(x => x.name === name);
    if (existing) return json(200, describe(existing));
    const password = body.password as { salt?: string; key?: string } | undefined;
    const created = room(name, [], { creator: ME, createdAt: Date.now(), maxParticipants: max as number, salt: password?.salt, key: password?.key });
    rooms.push(created);
    changed();
    return json(201, describe(created));
}

async function token(body: Body): Promise<Response> {
    const r = rooms.find(x => x.id === body.room);
    if (!r) return fail(404, 'room_not_found');
    if (r.bans.some(b => b.identity === ME)) return fail(403, 'banned');
    if (r === lockedRoom) await lockedKeys;
    if (r.key && !body.passwordKey) return fail(401, 'password_required');
    if (r.key && body.passwordKey !== r.key) return fail(401, 'wrong_password');
    const inside = r.people.some(p => p.identity === ME);
    if (!inside && r.maxParticipants && r.people.length >= r.maxParticipants) return fail(403, 'room_full');
    if (!inside) {
        r.people.push({ identity: ME, name: typeof body.name === 'string' && body.name ? body.name : 'You' });
        changed();
    }
    return json(200, { token: 'demo', identity: ME, url: '', canModerate: true } satisfies TokenResponse);
}

function moderate(r: DemoRoom, action: string, body: Body): Response {
    if (action === 'bans') return json(200, { bans: r.bans });
    const target = String(body.identity ?? '');
    const name = r.people.find(p => p.identity === target)?.name ?? r.bans.find(b => b.identity === target)?.name ?? target;
    switch (action) {
        case 'kick': removePerson(r, target); break;
        case 'ban':
            if (!r.bans.some(b => b.identity === target)) r.bans.push({ identity: target, name });
            removePerson(r, target);
            break;
        case 'unban': r.bans = r.bans.filter(b => b.identity !== target); break;
        case 'mute':
            if (typeof body.muted !== 'boolean') return fail(400, 'invalid_input');
            if (body.muted) r.serverMuted.add(target); else r.serverMuted.delete(target);
            break;
        case 'voice':
            if (typeof body.allowed !== 'boolean') return fail(400, 'invalid_input');
            break;
        default: return fail(404, 'not_found');
    }
    changed();
    return ok();
}

function serverBan(ban: boolean, identity: string): Response {
    if (!identity) return fail(400, 'invalid_input');
    const i = serverBans.findIndex(b => b.identity === identity);
    if (ban && i < 0) {
        const name = rooms.flatMap(r => r.people).find(p => p.identity === identity)?.name ?? identity;
        serverBans.push({ identity, name });
        for (const r of rooms) removePerson(r, identity);
        changed();
    }
    if (!ban && i >= 0) serverBans.splice(i, 1);
    return ok();
}
