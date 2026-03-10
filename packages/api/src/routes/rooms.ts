import { Router, Request, Response } from 'express';
import { getRoomService } from '../lib/livekit';
import { generateRoomId, hashPassword, parseRoomMeta } from '../lib/roomMeta';
import { cacheRoomMeta, evictRoomMeta } from '../lib/roomStore';
import { randomBytes } from 'crypto';
import { getAuthedRoom } from '../lib/auth';

export function createRoomsRouter(): Router {
    const router = Router();

    /** List all active rooms (public info only) */
    router.get('/', async (_req: Request, res: Response): Promise<void> => {
        try {
            const roomService = getRoomService();
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

            res.json({ rooms: result });
        } catch (error) {
            console.error('Failed to list rooms:', error);
            res.status(500).json({ error: 'Failed to list rooms' });
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
            res.status(500).json({ error: 'Failed to get room' });
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
                res.status(400).json({ error: 'name is required' });
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

            // Sanitize: strip null bytes, RTL/LTR override chars, and control characters
            const displayName = name.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').slice(0, 50);
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
                    res.status(500).json({ error: 'Failed to generate unique room ID' });
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
            res.status(500).json({ error: 'Failed to create room' });
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
            res.json({ ok: true });
        } catch (error) {
            console.error('Failed to delete room:', error);
            res.status(500).json({ error: 'Failed to delete room' });
        }
    });

    return router;
}
