import { Router, Request, Response } from 'express';
import { createHmac } from 'crypto';
import { AccessToken } from 'livekit-server-sdk';
import { getRoomService } from '../lib/livekit';
import { parseRoomMeta, verifyPassword } from '../lib/roomMeta';
import { verifyAdminSecret } from '../lib/auth';
import { getCachedMeta } from '../lib/roomStore';

export function createTokenRouter(): Router {
    const router = Router();

    router.post('/', async (req: Request, res: Response): Promise<void> => {
        try {
            const { room, name, deviceId, password, adminSecret } = req.body as {
                room?: string;
                name?: string;
                deviceId?: string;
                password?: string;
                adminSecret?: string;
            };

            if (!room || typeof room !== 'string' || room.length > 50) {
                res.status(400).json({ error: 'room_required' });
                return;
            }

            // Input validation
            if (deviceId !== undefined && (typeof deviceId !== 'string' || deviceId.length > 100)) {
                res.status(400).json({ error: 'invalid_input' });
                return;
            }
            if (password !== undefined && (typeof password !== 'string' || password.length > 200)) {
                res.status(400).json({ error: 'invalid_input' });
                return;
            }
            if (name !== undefined && (typeof name !== 'string' || name.length > 50)) {
                res.status(400).json({ error: 'invalid_input' });
                return;
            }

            const apiKey = process.env.LIVEKIT_API_KEY;
            const apiSecret = process.env.LIVEKIT_API_SECRET;

            if (!apiKey || !apiSecret) {
                res.status(500).json({ error: 'LiveKit credentials not configured' });
                return;
            }

            // Derive a stable identity from the client's device UUID using HMAC-SHA256.
            // Same device → same identity → LiveKit replaces old connection (no duplicate participants).
            // Other clients cannot forge someone else's identity without knowing apiSecret.
            const identity = deviceId && deviceId.length > 0
                ? createHmac('sha256', apiSecret).update(deviceId).digest('hex').slice(0, 36)
                : crypto.randomUUID();

            // Verify room exists and check password
            const roomService = getRoomService();
            const rooms = await roomService.listRooms([room]);

            if (rooms.length === 0) {
                res.status(404).json({ error: 'room_not_found' });
                return;
            }

            const lkRoom = rooms[0];
            const meta = parseRoomMeta(lkRoom.metadata);

            // Admin secret holders bypass password check (creator rejoining their own room)
            // adminSecret lives only in Redis cache, never in LiveKit metadata
            const cachedMeta = await getCachedMeta(room);
            const isAdmin = verifyAdminSecret(adminSecret, cachedMeta?.adminSecret);

            // Check if banned
            if (meta?.bannedIdentities?.includes(identity)) {
                res.status(403).json({ error: 'banned' });
                return;
            }

            if (meta?.passwordHash && !isAdmin) {
                if (!password) {
                    res.status(401).json({ error: 'password_required' });
                    return;
                }
                const ok = await verifyPassword(password, meta.passwordHash);
                if (!ok) {
                    res.status(401).json({ error: 'wrong_password' });
                    return;
                }
            }

            // Check capacity — skip for reconnect (identity already in room)
            const limit = meta?.maxParticipants ?? Number(lkRoom.maxParticipants);
            if (limit > 0 && lkRoom.numParticipants >= limit) {
                const participants = await roomService.listParticipants(room);
                const isReconnect = participants.some((p) => p.identity === identity);
                if (!isReconnect) {
                    res.status(403).json({ error: 'room_full' });
                    return;
                }
            }

            const token = new AccessToken(apiKey, apiSecret, {
                identity,
                name: name || identity,
                ttl: '24h',
            });

            token.addGrant({
                room,
                roomJoin: true,
                roomCreate: false,
                canPublish: true,
                canSubscribe: true,
                canPublishData: true,
                canUpdateOwnMetadata: true,
            });

            const jwt = await token.toJwt();
            res.json({ token: jwt, identity });
        } catch (error) {
            console.error('Token generation failed:', error);
            res.status(500).json({ error: 'Failed to generate token' });
        }
    });

    return router;
}
