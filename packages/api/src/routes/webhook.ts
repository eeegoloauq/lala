import { Router, type Request, type Response } from 'express';
import { WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import { broadcastSse } from '../lib/sse';
import { dropRoom, getRoom } from '../lib/rooms';
import { invalidateRoomsCache } from './rooms';
import { isBotIdentity } from '../lib/bots';
import { applyBotConfig } from '../lib/botSync';

// LiveKit events that change the room list. Mute and metadata changes are not webhook
// events; clients in the room get those over LiveKit itself.
const ROOM_EVENTS = new Set([
    'participant_joined',
    'participant_left',
    'room_started',
    'room_finished',
    'track_published',
    'track_unpublished',
]);

export function createWebhookRouter(): Router {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set');
    const receiver = new WebhookReceiver(apiKey, apiSecret);

    const router = Router();

    // Mounted before express.json(): the signature covers the raw body.
    router.post('/', async (req: Request, res: Response) => {
        let event: WebhookEvent;
        try {
            event = await receiver.receive((req.body as Buffer).toString(), req.get('Authorization') ?? '');
        } catch (err) {
            console.warn('[webhook] rejected:', err instanceof Error ? err.message : err);
            res.status(401).json({ error: 'invalid_signature' });
            return;
        }

        if (event.event === 'room_finished' && event.room?.name) {
            const room = await getRoom(event.room.name);
            if (room && !room.permanent) await dropRoom(room.id);
        }
        // A bot gets what the client can't set itself once it is in: avatar, status, commands.
        // A token issued before the config changed is turned away here.
        if (event.event === 'participant_joined' && event.room?.name && event.participant && isBotIdentity(event.participant.identity)) {
            await applyBotConfig(event.room.name, event.participant)
                .catch((err) => console.error(`[bots] applying the config to ${event.participant?.identity} failed:`, err));
        }
        if (ROOM_EVENTS.has(event.event)) {
            // Invalidated before broadcasting, so clients that refetch on the event get fresh data.
            invalidateRoomsCache();
            broadcastSse('rooms_updated', { trigger: event.event });
        }
        res.json({ ok: true });
    });

    return router;
}
