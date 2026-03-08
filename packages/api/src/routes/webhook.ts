import { Router, Request, Response } from 'express';
import { WebhookReceiver } from 'livekit-server-sdk';
import { broadcastSse } from '../lib/sse';
import { evictRoomMeta } from '../lib/roomStore';

// LiveKit webhook events that change the room list visible to users.
// Note: track mute/unmute and metadata changes are NOT webhook events in LiveKit —
// real-time state is propagated via LiveKit data channel in RoomShell instead.
const ROOM_EVENTS = new Set([
    'participant_joined',
    'participant_left',
    'room_started',
    'room_finished',
    'track_published',
    'track_unpublished',
]);

export function createWebhookRouter(): Router {
    const router = Router();

    /**
     * POST /api/webhook
     * Receives signed events from LiveKit server.
     * Must be mounted BEFORE express.json() to receive the raw body for signature verification.
     */
    router.post('/', async (req: Request, res: Response): Promise<void> => {
        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;

        if (!apiKey || !apiSecret) {
            res.status(500).json({ error: 'server_misconfigured' });
            return;
        }

        try {
            const receiver = new WebhookReceiver(apiKey, apiSecret);
            const body = req.body instanceof Buffer ? req.body.toString() : String(req.body);
            const event = await receiver.receive(body, req.get('Authorization') ?? '');

            if (ROOM_EVENTS.has(event.event)) {
                broadcastSse('rooms_updated', { trigger: event.event });
            }

            // Clean up Redis when LiveKit destroys a room
            if (event.event === 'room_finished' && event.room?.name) {
                await evictRoomMeta(event.room.name);
            }

            res.json({ ok: true });
        } catch (err) {
            // Invalid signature or malformed payload
            console.warn('[webhook] rejected:', err instanceof Error ? err.message : err);
            res.status(401).json({ error: 'invalid_signature' });
        }
    });

    return router;
}
