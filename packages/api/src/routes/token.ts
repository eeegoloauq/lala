import { Router, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { AccessToken } from 'livekit-server-sdk';
import type { TokenResponse } from '@lala/shared';
import { getRoomService } from '../lib/livekit';
import { callerIdentity, deriveIdentity } from '../lib/identity';
import { verifyRoomKey } from '../lib/passwords';
import { can, isModerator, permissionFor } from '../lib/rights';
import { getRoom, isBanned, isMuted } from '../lib/rooms';
import { sanitizeDisplayText } from '../lib/sanitize';

// Wrong room passwords only, per IP and room: enough for the client to try a full
// saved-password pool (20) and a few typos, about 120 guesses an hour after that.
const passwordFailures = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.room)}`,
    standardHeaders: true,
    legacyHeaders: false,
});

export function createTokenRouter(): Router {
    // Clients learn where LiveKit is from here, so one web image serves any deployment.
    const livekitUrl = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!livekitUrl || !apiKey || !apiSecret) throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set');

    const router = Router();

    router.post('/', passwordFailures, async (req: Request, res: Response) => {
        const { room: roomId, name, passwordKey } = (req.body ?? {}) as Record<string, unknown>;
        if (typeof roomId !== 'string' || roomId.length > 50
            || (name !== undefined && (typeof name !== 'string' || name.length > 50))
            || (passwordKey !== undefined && (typeof passwordKey !== 'string' || passwordKey.length > 200))) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }

        // Without a device ID the participant gets a one-off identity.
        const identity = callerIdentity(req) ?? deriveIdentity(undefined);
        const room = await getRoom(roomId);
        if (!room) {
            res.status(404).json({ error: 'room_not_found' });
            return;
        }
        if (!can(identity, room, 'join')) {
            res.status(403).json({ error: 'not_allowed' });
            return;
        }
        if (await isBanned(room.id, identity)) {
            res.status(403).json({ error: 'banned' });
            return;
        }
        if (room.password) {
            if (!passwordKey) {
                res.status(401).json({ error: 'password_required' });
                return;
            }
            if (!await verifyRoomKey(passwordKey, room.password.verifier)) {
                res.status(401).json({ error: 'wrong_password' });
                return;
            }
        }
        // LiveKit enforces the limit too, but its refusal reaches the client as a bare
        // connection error. Someone already inside is reconnecting and doesn't count.
        if (room.maxParticipants > 0) {
            const participants = await getRoomService().listParticipants(room.id).catch(() => []);
            if (participants.length >= room.maxParticipants && !participants.some((p) => p.identity === identity)) {
                res.status(403).json({ error: 'room_full' });
                return;
            }
        }

        // A configured room exists in LiveKit only while someone is in it.
        if (room.permanent) {
            await getRoomService().createRoom({ name: room.id, emptyTimeout: 300, maxParticipants: room.maxParticipants });
        }

        const permission = permissionFor(identity, room, await isMuted(room.id, identity));
        const token = new AccessToken(apiKey, apiSecret, {
            identity,
            name: (typeof name === 'string' && sanitizeDisplayText(name, 50)) || identity,
        });
        token.addGrant({
            room: room.id,
            roomJoin: true,
            canSubscribe: permission.canSubscribe,
            canPublish: permission.canPublish,
            canPublishSources: permission.canPublishSources,
            canPublishData: permission.canPublishData,
            canUpdateOwnMetadata: true,
        });

        const response: TokenResponse = {
            token: await token.toJwt(),
            identity,
            url: livekitUrl,
            canModerate: isModerator(identity, room),
        };
        res.json(response);
    });

    return router;
}
