import { Router, Request, Response } from 'express';
import { getRoomService } from '../lib/livekit';
import { generateRoomId, hashPassword, parseRoomMeta } from '../lib/roomMeta';
import { cacheRoomMeta, evictRoomMeta } from '../lib/roomStore';
import { sanitizeDisplayText } from '../lib/sanitize';
import { randomBytes } from 'crypto';
import { getAuthedRoom } from '../lib/auth';

// In-memory cache for the aggregated room list — GET /api/rooms is unauthenticated
// and fans out a listParticipants() call per room, so without a cache it's an N+1
// amplification against LiveKit on every poll (including the docker healthcheck
// every 15s). TTL is short enough that SSE-driven UI refreshes still see fresh-enough
// data; the webhook handler also invalidates it explicitly on room-changing events.
const ROOMS_CACHE_TTL_MS = 2000;
let roomsCache: { data: unknown; expiresAt: number } | null = null;
let roomsCacheInflight: Promise<unknown> | null = null;

/** Drop the cached room list so the next GET /api/rooms fetches fresh data. */
export function invalidateRoomsCache(): void {
    roomsCache = null;
    roomsCacheInflight = null;
}

async function listRoomsAggregated(): Promise<unknown> {
    const now = Date.now();
    if (roomsCache && roomsCache.expiresAt > now) {
        return roomsCache.data;
    }
    // Single-flight: concurrent requests during a refresh share one in-flight promise
    // instead of each triggering their own fan-out of listRooms/listParticipants calls.
    if (roomsCacheInflight) {
        return roomsCacheInflight;
    }

    const roomService = getRoomService();
    roomsCacheInflight = (async () => {
        const rooms = await roomService.listRooms();

        const result = await Promise.all(
            rooms.map(async (room) => {
                const participants = await roomService.listParticipants(room.name);
                const meta = parseRoomMeta(room.metadata);
                // TrackSource: SCREEN_SHARE=3, MICROPHONE=2 in LiveKit protobuf enum
                const screenSharingParticipants = participants
                    .filter(p => p.tracks?.some(t => t.source === 3))
                    .map(p => p.identity);
                const mutedParticipants = participants
                    .filter(p => p.tracks?.some(t => t.source === 2 && t.muted))
                    .map(p => p.identity);
                const deafenedParticipants = participants
                    .filter(p => {
                        try { return !!JSON.parse(p.metadata || '{}').deafened; } catch { return false; }
                    })
                    .map(p => p.identity);
                const serverMutedParticipants = participants
                    .filter(p => p.permission && p.permission.canPublish === false)
                    .map(p => p.identity);
                return {
                    id: room.name,
                    displayName: meta?.displayName ?? room.name,
                    numParticipants: participants.length,
                    maxParticipants: meta?.maxParticipants ?? Number(room.maxParticipants),
                    hasPassword: !!meta?.passwordHash,
                    creationTime: Number(room.creationTime),
                    participants: participants.map((p) => ({ identity: p.identity, name: p.name || p.identity })),
                    adminIdentity: meta?.creatorIdentity,
                    screenSharingParticipants,
                    mutedParticipants,
                    deafenedParticipants,
                    serverMutedParticipants,
                };
            }),
        );

        roomsCache = { data: result, expiresAt: Date.now() + ROOMS_CACHE_TTL_MS };
        return result;
    })();

    try {
        return await roomsCacheInflight;
    } finally {
        roomsCacheInflight = null;
    }
}

export function createRoomsRouter(): Router {
    const router = Router();

    /** List all active rooms (public info only) */
    router.get('/', async (_req: Request, res: Response): Promise<void> => {
        try {
            const result = await listRoomsAggregated();
            res.json({ rooms: result });
        } catch (error) {
            console.error('Failed to list rooms:', error);
            res.status(500).json({ error: 'server_error' });
        }
    });

    /** Get single room info (for direct link join) */
    router.get('/:id', async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            if (id.length > 50) {
                res.status(400).json({ error: 'invalid_input' });
                return;
            }
            const roomService = getRoomService();
            const rooms = await roomService.listRooms([id]);
            if (rooms.length === 0) {
                res.status(404).json({ error: 'room_not_found' });
                return;
            }
            const room = rooms[0];
            const meta = parseRoomMeta(room.metadata);
            res.json({
                id: room.name,
                displayName: meta?.displayName ?? room.name,
                numParticipants: room.numParticipants,
                maxParticipants: meta?.maxParticipants ?? Number(room.maxParticipants),
                hasPassword: !!meta?.passwordHash,
                creationTime: Number(room.creationTime),
            });
        } catch (error) {
            console.error('Failed to get room:', error);
            res.status(500).json({ error: 'server_error' });
        }
    });

    /** Create a new room */
    router.post('/', async (req: Request, res: Response): Promise<void> => {
        try {
            const { name, password, maxParticipants, identity } = req.body as {
                name?: string;
                password?: string;
                maxParticipants?: number;
                identity?: string;
            };

            if (!name || typeof name !== 'string' || !name.trim()) {
                res.status(400).json({ error: 'invalid_input' });
                return;
            }

            // Input validation
            if (password !== undefined && (typeof password !== 'string' || password.length > 200)) {
                res.status(400).json({ error: 'invalid_input' });
                return;
            }
            if (maxParticipants !== undefined && (typeof maxParticipants !== 'number' || !Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 100)) {
                res.status(400).json({ error: 'invalid_input' });
                return;
            }
            if (identity !== undefined && (typeof identity !== 'string' || identity.length > 128)) {
                res.status(400).json({ error: 'invalid_input' });
                return;
            }

            // Sanitize: strip null bytes, RTL/LTR override chars, and control characters
            const displayName = sanitizeDisplayText(name, 50);
            const limit = maxParticipants && maxParticipants > 0 ? Math.min(maxParticipants, 100) : 0;

            const adminSecret = randomBytes(16).toString('hex');

            const meta = {
                displayName,
                passwordHash: password ? await hashPassword(password) : undefined,
                maxParticipants: limit,
                createdAt: Date.now(),
                creatorIdentity: identity?.trim() || undefined,
            };

            const roomService = getRoomService();
            // Generate unique room ID with collision check
            let roomId = generateRoomId();
            for (let attempt = 0; attempt < 5; attempt++) {
                const existing = await roomService.listRooms([roomId]);
                if (existing.length === 0) break;
                if (attempt === 4) {
                    res.status(500).json({ error: 'server_error' });
                    return;
                }
                roomId = generateRoomId();
            }
            const room = await roomService.createRoom({
                name: roomId,
                emptyTimeout: 300,
                maxParticipants: limit,
                // adminSecret is NOT stored in LiveKit metadata — it would be broadcast to all participants
                metadata: JSON.stringify(meta),
            });

            // adminSecret stored only in Redis cache — never in LiveKit metadata
            await cacheRoomMeta(roomId, { ...meta, adminSecret });
            invalidateRoomsCache();

            // adminSecret is returned ONCE here — client must persist it in localStorage
            res.json({
                id: room.name,
                displayName: meta.displayName,
                numParticipants: 0,
                maxParticipants: limit,
                hasPassword: !!meta.passwordHash,
                creationTime: Number(room.creationTime),
                participants: [],
                adminSecret,
            });
        } catch (error) {
            console.error('Failed to create room:', error);
            res.status(500).json({ error: 'server_error' });
        }
    });

    /** Delete a room (requires adminSecret) */
    router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const { adminSecret } = req.body as { adminSecret?: string };
            const ctx = await getAuthedRoom(id, adminSecret, res);
            if (!ctx) return;
            await ctx.roomService.deleteRoom(id);
            await evictRoomMeta(id);
            invalidateRoomsCache();
            res.json({ ok: true });
        } catch (error) {
            console.error('Failed to delete room:', error);
            res.status(500).json({ error: 'server_error' });
        }
    });

    return router;
}
