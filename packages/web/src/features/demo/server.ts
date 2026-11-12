/**
 * The API of the demo build (`npm run build:demo`), answered inside the page. It keeps
 * the routes, status codes and error codes of packages/api so the client code runs
 * unchanged; state lives in memory and resets on reload. Nothing here goes over the
 * network, and the regular build never includes this module (see IS_DEMO).
 */
import type { AccessStatus, AddedBot, Me, RoomBan, RoomBot, RoomInfo, ServerBan, TokenResponse } from '../../lib/types';
import { deriveRoomKeys } from '../../lib/roomKeys';
import type { BotDetails } from '../../lib/bots';

/** Someone in a room; a bot has its details, which in a real call come from its attributes and permission. */
interface Person { identity: string; name: string; bot?: BotDetails }

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
    voiced: Set<string>;
    sharing: Set<string>;
    bans: RoomBan[];
    added: AddedBot[];
}

/** The visitor: an admin, so every moderation control is there to try. */
const ME = 'demo00000000000000000000000000000you';
/** The password of the seeded locked room; its name says it. */
export const DEMO_PASSWORD = 'lala';

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
const person = (name: string): Person => ({ identity: `demo-${name.toLowerCase()}-${randomId()}`, name });

const bot = (key: string, details: Omit<BotDetails, 'name'>): Person => ({ identity: `bot-${key}`, name: key[0].toUpperCase() + key.slice(1), bot: { name: key[0].toUpperCase() + key.slice(1), ...details } });
const RADIO = bot('radio', {
    status: 'Teardrop · Massive Attack',
    commands: [{ name: '!play', description: 'song name or link' }, { name: '!skip', description: 'next song' }, { name: '!queue', description: "what's next" }],
    speaks: true, chats: true, listens: false,
});
const MINUTES = bot('minutes', {
    status: 'Taking notes',
    commands: [{ name: '!stop', description: 'pause notes' }, { name: '!summary', description: 'summary so far' }],
    speaks: false, chats: true, listens: true,
});

// Bots the visitor can add to a room, as `invite:` in the config allows; Quiz is offline.
const ADDABLE: Array<{ person: Person; online: boolean }> = [
    { person: bot('dice', { status: 'Ready to roll', commands: [{ name: '!roll', description: 'dice such as 2d6' }, { name: '!leave', description: 'take Dice out of this room' }], speaks: false, chats: true, listens: false }), online: true },
    { person: bot('scribe', { status: 'Taking notes', commands: [{ name: '!summary', description: 'summary so far' }], speaks: false, chats: true, listens: true }), online: true },
    { person: bot('quiz', { status: '', commands: [], speaks: false, chats: true, listens: false }), online: false },
];

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
        voiced: new Set(),
        sharing: new Set(),
        bans: [],
        added: [],
        ...extra,
    };
}

// Seeded rooms keep fixed IDs, so a demo link like /room/lounge survives the reset on reload.
const rooms: DemoRoom[] = [
    room('Lounge', [...CROWD.slice(0, 4), RADIO], { id: 'lounge', permanent: true, muted: new Set([CROWD[2].identity]), sharing: new Set([CROWD[1].identity]) }),
    room('Gaming', [...CROWD.slice(4, 7), MINUTES], { id: 'gaming', deafened: new Set([CROWD[6].identity]) }),
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

/** The visitor's identity, for telling their own tile and messages apart. */
export const MY_IDENTITY = ME;

/** What a call in the room would show: who is there and what each is doing. Null once the room is gone. */
export interface CallState {
    people: readonly Person[];
    muted: ReadonlySet<string>;
    deafened: ReadonlySet<string>;
    serverMuted: ReadonlySet<string>;
    sharing: ReadonlySet<string>;
    added: readonly AddedBot[];
}

export function callState(roomId: string): CallState | null {
    const r = rooms.find(x => x.id === roomId);
    return r ? { people: [...r.people], muted: new Set(r.muted), deafened: new Set(r.deafened), serverMuted: new Set(r.serverMuted), sharing: new Set(r.sharing), added: [...r.added] } : null;
}

/** The visitor is in the room's call; a no-op when they already are (the token request adds them). */
export function enterRoom(roomId: string, name: string): void {
    const r = rooms.find(x => x.id === roomId);
    if (!r || r.people.some(p => p.identity === ME)) return;
    r.people.push({ identity: ME, name });
    changed();
}

/** The visitor's own mic, sound and screen in the call, as the sidebar and others would see them. */
export function setMyState(roomId: string, state: { muted: boolean; deafened: boolean; sharing: boolean }): void {
    const r = rooms.find(x => x.id === roomId);
    if (!r) return;
    for (const [set, on] of [[r.muted, state.muted], [r.deafened, state.deafened], [r.sharing, state.sharing]] as const) {
        if (on) set.add(ME); else set.delete(ME);
    }
    callRoom = roomId;
    changed();
}

/** The visitor's demo call ended: they leave the room's participant list. */
export function leaveRoom(roomId: string): void {
    if (callRoom === roomId) callRoom = null;
    const r = rooms.find(x => x.id === roomId);
    if (!r) return;
    removePerson(r, ME);
    changed();
}

function removePerson(r: DemoRoom, identity: string) {
    r.people = r.people.filter(p => p.identity !== identity);
    for (const set of [r.muted, r.deafened, r.serverMuted, r.voiced, r.sharing]) set.delete(identity);
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
        voicedParticipants: [...r.voiced],
        // Every demo room lets everyone speak.
        cannotSpeakParticipants: [],
        listeningParticipants: r.people.filter(p => p.bot?.listens).map(p => p.identity),
        canAddBots: true,
        addedBots: r.added,
    };
}

// People drift between rooms, mute and share screens, so the sidebar looks like a live server.
// While the visitor is in a call, much of it happens in or around their room.
const MAX_CROWD = 5;
let callRoom: string | null = null;
let activity: ReturnType<typeof setInterval> | undefined;
const pick = <T,>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];
function startActivity() {
    if (activity) return;
    activity = setInterval(() => {
        // Bots stay where they are.
        const busy = rooms.filter(r => r.people.some(p => p.identity !== ME && !p.bot));
        const mine = rooms.find(r => r.id === callRoom);
        const from = (mine && busy.includes(mine) && Math.random() < 0.4 ? mine : undefined) ?? pick(busy);
        if (!from) return;
        const others = from.people.filter(p => p.identity !== ME && !p.bot);
        const who = others[Math.floor(Math.random() * others.length)];
        const roll = Math.random();
        if (roll < 0.35) {
            const to = rooms.filter(r => r !== from && !r.salt && r.people.length < (r.maxParticipants || MAX_CROWD));
            const target = (mine && to.includes(mine) && Math.random() < 0.5 ? mine : undefined) ?? pick(to);
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
let myAvatarVersion: string | undefined;
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
    if (path === '/me') return json(200, { identity: ME, role: 'admin', allowed: true, canCreateRooms: true, serverName: 'Lala', avatar: myAvatarVersion } satisfies Me);
    // The picture stays on the page (DemoCall shows the visitor's own copy); only its version is kept.
    if (path === '/me/avatar' && method === 'POST') {
        myAvatarVersion = Math.random().toString(16).slice(2, 10).padEnd(16, '0');
        return json(200, { avatar: myAvatarVersion });
    }
    if (path === '/me/avatar' && method === 'DELETE') {
        myAvatarVersion = undefined;
        return new Response(null, { status: 204 });
    }
    if (path === '/rooms' && method === 'GET') return json(200, { rooms: rooms.map(describe) });
    if (path === '/rooms' && method === 'POST') return createRoom(body);
    if (path === '/token' && method === 'POST') return token(body);
    if (path === '/admin/bans') return json(200, { bans: serverBans });
    if (path === '/admin/ban' || path === '/admin/unban') return serverBan(path === '/admin/ban', String(body.identity ?? ''));

    const b = path.match(/^\/rooms\/([^/]+)\/bots(?:\/([a-z0-9-]+))?$/);
    if (b) return roomBots(decodeURIComponent(b[1]), b[2], method);

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

function roomBots(roomId: string, key: string | undefined, method: string): Response {
    const r = rooms.find(x => x.id === roomId);
    if (!r) return fail(404, 'room_not_found');
    if (!key && method === 'GET') {
        const bots: RoomBot[] = ADDABLE.map(({ person, online }) => ({
            key: person.identity.slice(4), identity: person.identity, name: person.name,
            listens: !!person.bot?.listens, online, added: r.added.some(a => a.identity === person.identity),
        }));
        return json(200, { bots });
    }
    const entry = ADDABLE.find(a => a.person.identity === `bot-${key}`);
    if (!entry) return fail(404, 'bot_not_found');
    const identity = entry.person.identity;
    if (method === 'POST') {
        if (r.salt) return fail(409, 'password_room');
        if (!entry.online) return fail(409, 'bot_offline');
        const created = !r.added.some(a => a.identity === identity);
        if (created) r.added.push({ identity, addedBy: ME, addedByName: r.people.find(p => p.identity === ME)?.name ?? 'You' });
        changed();
        // It takes the bot a moment to come, as a real one would.
        setTimeout(() => {
            if (!r.added.some(a => a.identity === identity) || r.people.some(p => p.identity === identity)) return;
            r.people.push(entry.person);
            changed();
        }, 1200);
        return json(created ? 201 : 200, { ok: true });
    }
    if (method === 'DELETE') {
        if (!r.added.some(a => a.identity === identity)) return fail(404, 'not_found');
        r.added = r.added.filter(a => a.identity !== identity);
        removePerson(r, identity);
        changed();
        return ok();
    }
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
            if (body.allowed) r.voiced.add(target); else r.voiced.delete(target);
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
