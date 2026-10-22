import { Router, type Request, type Response } from 'express';
import { TrackSource } from 'livekit-server-sdk';
import type { CreateRoomRequest, RoomInfo } from '@lala/shared';
import { getRoomService, isNotFound } from '../lib/livekit';
import { callerIdentity } from '../lib/identity';
import { hashRoomKey } from '../lib/passwords';
import { isModerator } from '../lib/rights';
import { OPEN_RIGHTS, claimRoom, dropRoom, generateRoomId, getRoom, listMuted, listRoomStates, type RoomState } from '../lib/rooms';
import { sanitizeDisplayText } from '../lib/sanitize';

type ListedRoom = Omit<RoomInfo, 'canModerate'> & { state: RoomState };

// GET /api/rooms is unauthenticated and fans out one LiveKit call per room, and every
// client refetches it when anyone joins or leaves, so the list is cached briefly. The
// webhook invalidates it on room events.
const CACHE_TTL_MS = 2000;
let cache: { rooms: ListedRoom[]; expiresAt: number } | null = null;
let inflight: Promise<ListedRoom[]> | null = null;
let generation = 0;

export function invalidateRoomsCache(): void {
    generation++;
    cache = null;
    inflight = null;
}

function readDeafened(metadata: string): boolean {
    try { return JSON.parse(metadata || '{}').deafened === true; } catch { return false; }
}

async function describe(state: RoomState): Promise<ListedRoom> {
    const [participants, serverMuted] = await Promise.all([
        getRoomService().listParticipants(state.id).catch((err) => {
            if (isNotFound(err)) return [];   // created a moment ago, LiveKit has no room yet
            throw err;
        }),
        listMuted(state.id),
    ]);
    const withTrack = (source: TrackSource, muted?: boolean) => participants
        .filter((p) => p.tracks.some((t) => t.source === source && (muted === undefined || t.muted === muted)))
        .map((p) => p.identity);
    return {
        state,
        id: state.id,
        displayName: state.name,
        numParticipants: participants.length,
        maxParticipants: state.maxParticipants,
        passwordSalt: state.password?.salt,
        creationTime: state.createdAt,
        participants: participants.map((p) => ({ identity: p.identity, name: p.name || p.identity })),
        adminIdentity: state.creator,
        screenSharingParticipants: withTrack(TrackSource.SCREEN_SHARE),
        mutedParticipants: withTrack(TrackSource.MICROPHONE, true),
        deafenedParticipants: participants.filter((p) => readDeafened(p.metadata)).map((p) => p.identity),
        serverMutedParticipants: serverMuted,
    };
}

async function listRooms(): Promise<ListedRoom[]> {
    if (cache && cache.expiresAt > Date.now()) return cache.rooms;
    if (inflight) return inflight;
    const started = generation;
    const fetch = (async () => {
        const states = await listRoomStates();
        const rooms = await Promise.all(states.sort((a, b) => a.createdAt - b.createdAt).map(describe));
        // A webhook may have invalidated the list while this was in flight.
        if (generation === started) cache = { rooms, expiresAt: Date.now() + CACHE_TTL_MS };
        return rooms;
    })();
    inflight = fetch;
    try {
        return await fetch;
    } finally {
        if (inflight === fetch) inflight = null;
    }
}

/** The cached part is the same for everyone; whether the caller may moderate is not. */
function forCaller(req: Request, { state, ...room }: ListedRoom): RoomInfo {
    return { ...room, canModerate: isModerator(callerIdentity(req), state) };
}

function parsePassword(input: unknown): CreateRoomRequest['password'] | null {
    if (input === undefined) return undefined;
    const { salt, key } = (input ?? {}) as Record<string, unknown>;
    const valid = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200;
    return valid(salt) && valid(key) ? { salt: salt as string, key: key as string } : null;
}

/**
 * State that LiveKit has no room for (a missed webhook, a crash mid-create) would list
 * rooms nobody can join. Rooms LiveKit has without state are left alone: they hold live
 * calls, can't be joined again and end once empty.
 */
export async function dropStaleRooms(): Promise<void> {
    const [states, live] = await Promise.all([listRoomStates(), getRoomService().listRooms()]);
    const liveIds = new Set(live.map((r) => r.name));
    const cutoff = Date.now() - 60_000;
    const stale = states.filter((s) => !liveIds.has(s.id) && s.createdAt < cutoff);
    await Promise.all(stale.map((s) => dropRoom(s.id)));
    if (stale.length > 0) invalidateRoomsCache();
}

export function createRoomsRouter(): Router {
    const router = Router();

    router.get('/', async (req: Request, res: Response) => {
        res.json({ rooms: (await listRooms()).map((room) => forCaller(req, room)) });
    });

    router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
        const room = (await listRooms()).find((r) => r.id === req.params.id);
        if (!room) {
            res.status(404).json({ error: 'room_not_found' });
            return;
        }
        res.json(forCaller(req, room));
    });

    router.post('/', async (req: Request, res: Response) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const name = typeof body.name === 'string' ? sanitizeDisplayText(body.name, 50) : '';
        const max = body.maxParticipants ?? 0;
        const password = parsePassword(body.password);
        const creator = callerIdentity(req);
        if (!name || password === null || !Number.isInteger(max) || (max as number) < 0 || (max as number) > 100) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        if (!creator) {
            res.status(400).json({ error: 'identity_required' });
            return;
        }

        const { room, created } = await claimRoom({
            id: generateRoomId(),
            name,
            createdAt: Date.now(),
            creator,
            maxParticipants: max as number,
            password: password && { salt: password.salt, verifier: await hashRoomKey(password.key) },
            rights: OPEN_RIGHTS,
        });
        if (created) {
            try {
                await getRoomService().createRoom({ name: room.id, emptyTimeout: 300, maxParticipants: room.maxParticipants });
            } catch (err) {
                await dropRoom(room.id);
                throw err;
            }
            invalidateRoomsCache();
        }
        res.status(created ? 201 : 200).json(forCaller(req, await describe(room)));
    });

    router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
        const room = await getRoom(req.params.id);
        if (!room) {
            res.status(404).json({ error: 'room_not_found' });
            return;
        }
        if (!isModerator(callerIdentity(req), room)) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        await getRoomService().deleteRoom(room.id).catch((err) => { if (!isNotFound(err)) throw err; });
        await dropRoom(room.id);
        invalidateRoomsCache();
        res.json({ ok: true });
    });

    return router;
}
