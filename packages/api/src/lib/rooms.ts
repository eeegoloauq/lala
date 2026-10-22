import { randomBytes } from 'crypto';
import { redis } from './redis';
import type { Rights } from './config';

/**
 * The server's view of a room. Redis is the only place it lives: LiveKit holds media and
 * participants, nothing else, so there is never a second copy to disagree with.
 */
export interface RoomState {
    id: string;
    name: string;
    createdAt: number;
    /** Identity of the creator, who moderates the room. */
    creator?: string;
    maxParticipants: number; // 0 = unlimited
    /** Salt for the client-side key derivation (public) and the scrypt hash of the derived key. */
    password?: { salt: string; verifier: string };
    rights: Rights;
    /** A room from the config: it exists while it is listed there, empty or not. */
    permanent?: { position: number };
}

// The old room cache used `lala:room:<id>` for a different shape; these keys must not overlap it.
const ROOMS = 'lala:rooms';
const roomKey = (id: string) => `lala:room-state:${id}`;
const bansKey = (id: string) => `lala:room-bans:${id}`;
const mutedKey = (id: string) => `lala:room-muted:${id}`;
const NAME_PREFIX = 'lala:room-name:';

/** Live room names are unique regardless of case and surrounding spaces. */
const nameKey = (name: string) => NAME_PREFIX + name.trim().toLowerCase();

/** 16 hex chars, 64 bits: opaque, and unguessable enough to keep room URLs private. */
export const generateRoomId = () => randomBytes(8).toString('hex');

// Claims the name for a new room and stores it, or returns the live room that already
// holds the name. One script, so two people creating "General" at once get one room.
const CLAIM = `
local current = redis.call('GET', KEYS[1])
if current then
  local existing = redis.call('GET', ARGV[3] .. current)
  if existing then return existing end
end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', ARGV[3] .. ARGV[1], ARGV[2])
redis.call('SADD', KEYS[2], ARGV[1])
return false
`;

// Drops a room and releases its name, unless a newer room already took the name over.
const DROP = `
if redis.call('GET', KEYS[5]) == ARGV[1] then redis.call('DEL', KEYS[5]) end
redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])
redis.call('SREM', KEYS[4], ARGV[1])
`;

/** Stores a new room under its name, or returns the live room that already has that name. */
export async function claimRoom(room: RoomState): Promise<{ room: RoomState; created: boolean }> {
    const existing = await redis().eval(CLAIM, 2, nameKey(room.name), ROOMS, room.id, JSON.stringify(room), roomKey('')) as string | null;
    return existing ? { room: JSON.parse(existing), created: false } : { room, created: true };
}

/** Stores a configured room under its name, taking the name over from a live room that has it. */
export async function putPermanentRoom(room: RoomState): Promise<void> {
    await redis().multi()
        .set(roomKey(room.id), JSON.stringify(room))
        .set(nameKey(room.name), room.id)
        .sadd(ROOMS, room.id)
        .exec();
}

export async function getRoom(id: string): Promise<RoomState | undefined> {
    const raw = await redis().get(roomKey(id));
    return raw ? JSON.parse(raw) : undefined;
}

export async function findRoomByName(name: string): Promise<RoomState | undefined> {
    const id = await redis().get(nameKey(name));
    return id ? getRoom(id) : undefined;
}

export async function listRoomStates(): Promise<RoomState[]> {
    const ids = await redis().smembers(ROOMS);
    if (ids.length === 0) return [];
    const raws = await redis().mget(ids.map(roomKey));
    return raws.filter((raw): raw is string => raw !== null).map((raw) => JSON.parse(raw));
}

export async function dropRoom(id: string): Promise<void> {
    const room = await getRoom(id);
    const name = room ? nameKey(room.name) : NAME_PREFIX;
    await redis().eval(DROP, 5, roomKey(id), bansKey(id), mutedKey(id), ROOMS, name, id);
}

/** Banned identities with the name each had when banned, so moderators can tell them apart. */
export async function listBans(id: string): Promise<Array<{ identity: string; name: string }>> {
    return Object.entries(await redis().hgetall(bansKey(id))).map(([identity, name]) => ({ identity, name }));
}
export const isBanned = async (id: string, identity: string) => (await redis().hexists(bansKey(id), identity)) === 1;
export const addBan = (id: string, identity: string, name: string) => redis().hset(bansKey(id), identity, name);
export const removeBan = (id: string, identity: string) => redis().hdel(bansKey(id), identity);

export const listMuted = (id: string) => redis().smembers(mutedKey(id));
export const isMuted = async (id: string, identity: string) => (await redis().sismember(mutedKey(id), identity)) === 1;
export const setMuted = (id: string, identity: string, muted: boolean) =>
    muted ? redis().sadd(mutedKey(id), identity) : redis().srem(mutedKey(id), identity);
