import { DataPacket_Kind, RoomServiceClient, ServerError } from 'livekit-server-sdk';
import type { ModerationEvent, ModerationTopic } from '@lala/shared';

let instance: RoomServiceClient | null = null;

/** LIVEKIT_HOST is the internal address (container to container); clients use LIVEKIT_URL. */
export function getRoomService(): RoomServiceClient {
    if (!instance) {
        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;
        if (!apiKey || !apiSecret) throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set');
        instance = new RoomServiceClient(`http://${process.env.LIVEKIT_HOST || 'localhost:7880'}`, apiKey, apiSecret);
    }
    return instance;
}

export const isNotFound = (err: unknown) => err instanceof ServerError && err.status === 404;

const MODERATION_TOPIC: ModerationTopic = 'lala.moderation';

/** Clients trust moderation events only when the server sent them, never a participant. */
export async function announceModeration(roomId: string, event: ModerationEvent): Promise<void> {
    const data = new TextEncoder().encode(JSON.stringify(event));
    await getRoomService().sendData(roomId, data, DataPacket_Kind.RELIABLE, { topic: MODERATION_TOPIC });
}
