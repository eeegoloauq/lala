import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { parse } from 'yaml';

/**
 * The optional server config (LALA_CONFIG, see config/lala.example.yaml): who is an admin
 * or a member, who may use what, and rooms that always exist. Without the file everyone
 * is a guest who may do everything, which is how an open server behaves.
 */

export type Role = 'admin' | 'member';
/** Who may use a right: room creators count as admins in their own room. */
export type Level = 'everyone' | 'members' | 'admins';
export type Right = 'join' | 'speak' | 'video' | 'screen' | 'chat';
export type Rights = Record<Right, Level>;

export interface ConfigRoom {
    id: string;
    name: string;
    rights: Rights;
    maxParticipants: number;
    password?: string;
}

export interface Config {
    /** Keyed by public identity, the ID each person copies from their settings. */
    users: Map<string, { name: string; role: Role }>;
    guests: boolean;
    createRooms: Level | 'nobody';
    defaults: Rights;
    rooms: ConfigRoom[];
}

const RIGHTS: Right[] = ['join', 'speak', 'video', 'screen', 'chat'];
const LEVELS: Level[] = ['everyone', 'members', 'admins'];
const ROLES: Role[] = ['admin', 'member'];
const IDENTITY = /^[0-9a-f]{36}$/;

const OPEN: Config = {
    users: new Map(),
    guests: true,
    createRooms: 'everyone',
    defaults: { join: 'everyone', speak: 'everyone', video: 'everyone', screen: 'everyone', chat: 'everyone' },
    rooms: [],
};

/** Stable across restarts and config edits, so links to a configured room keep working. */
export const configRoomId = (name: string) =>
    createHash('sha256').update(`lala-config-room:${name.trim().toLowerCase()}`).digest('hex').slice(0, 16);

type Raw = Record<string, unknown>;

function parseConfig(raw: unknown): Config {
    const fail = (path: string, problem: string): never => { throw new Error(`${path}: ${problem}`); };
    const object = (value: unknown, path: string): Raw =>
        value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Raw : fail(path, 'expected a mapping');
    const known = (value: Raw, path: string, keys: string[]) => {
        for (const key of Object.keys(value)) if (!keys.includes(key)) fail(path, `unknown key "${key}" (expected one of ${keys.join(', ')})`);
    };
    const oneOf = <T extends string>(value: unknown, path: string, allowed: readonly T[]): T =>
        allowed.includes(value as T) ? value as T : fail(path, `expected one of ${allowed.join(', ')}`);
    const rightsOf = (value: Raw, path: string, base: Rights): Rights =>
        Object.fromEntries(RIGHTS.map((r) => [r, value[r] === undefined ? base[r] : oneOf(value[r], `${path}.${r}`, LEVELS)])) as Rights;

    const top = object(raw ?? {}, 'config');
    known(top, 'config', ['users', 'guests', 'defaults', 'rooms']);

    const users = new Map<string, { name: string; role: Role }>();
    for (const [name, value] of Object.entries(object(top.users ?? {}, 'users'))) {
        const path = `users.${name}`;
        const user = object(value, path);
        known(user, path, ['role', 'ids']);
        const role = oneOf(user.role, `${path}.role`, ROLES);
        if (!Array.isArray(user.ids) || user.ids.length === 0) fail(`${path}.ids`, 'expected a list of IDs from Settings');
        for (const id of user.ids as unknown[]) {
            if (typeof id !== 'string' || !IDENTITY.test(id)) fail(`${path}.ids`, `"${String(id)}" is not an ID from Settings`);
            if (users.has(id as string)) fail(`${path}.ids`, `${String(id)} is listed twice`);
            users.set(id as string, { name, role });
        }
    }

    if (top.guests !== undefined && typeof top.guests !== 'boolean') fail('guests', 'expected true or false');
    const defaultsRaw = object(top.defaults ?? {}, 'defaults');
    known(defaultsRaw, 'defaults', ['createRooms', ...RIGHTS]);
    const createRooms = defaultsRaw.createRooms === undefined
        ? OPEN.createRooms
        : oneOf(defaultsRaw.createRooms, 'defaults.createRooms', [...LEVELS, 'nobody'] as const);
    const defaults = rightsOf(defaultsRaw, 'defaults', OPEN.defaults);

    if (top.rooms != null && !Array.isArray(top.rooms)) fail('rooms', 'expected a list');
    const rooms: ConfigRoom[] = [];
    for (const [i, value] of ((top.rooms ?? []) as unknown[]).entries()) {
        const path = `rooms[${i}]`;
        const room = object(value, path);
        known(room, path, ['name', 'password', 'maxParticipants', ...RIGHTS]);
        const name = typeof room.name === 'string' ? room.name.trim() : '';
        if (!name || name.length > 50) fail(`${path}.name`, 'expected a name of 1 to 50 characters');
        const id = configRoomId(name);
        if (rooms.some((r) => r.id === id)) fail(`${path}.name`, `"${name}" is listed twice`);
        const max = room.maxParticipants ?? 0;
        if (!Number.isInteger(max) || (max as number) < 0 || (max as number) > 100) fail(`${path}.maxParticipants`, 'expected 0 to 100');
        if (room.password !== undefined && (typeof room.password !== 'string' || !room.password)) fail(`${path}.password`, 'expected text');
        rooms.push({ id, name, rights: rightsOf(room, path, defaults), maxParticipants: max as number, password: room.password as string | undefined });
    }

    return { users, guests: (top.guests as boolean | undefined) ?? true, createRooms, defaults, rooms };
}

let loaded: Config = OPEN;

/** Reads LALA_CONFIG once at startup; a file that is there but wrong stops the API. */
export function loadConfig(): void {
    const path = process.env.LALA_CONFIG;
    if (!path) return;
    let text: string;
    try {
        text = readFileSync(path, 'utf8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            console.log(`[config] ${path} not found, running as an open server`);
            return;
        }
        throw err;
    }
    try {
        loaded = parseConfig(parse(text));
    } catch (err) {
        throw new Error(`${path}: ${(err as Error).message}`);
    }
    console.log(`[config] ${loaded.users.size} IDs, ${loaded.rooms.length} rooms, guests ${loaded.guests ? 'allowed' : 'not allowed'}`);
}

export const config = (): Config => loaded;
