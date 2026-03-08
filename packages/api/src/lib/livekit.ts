import { RoomServiceClient } from 'livekit-server-sdk';

/**
 * Lazily-initialized singleton RoomServiceClient.
 *
 * Uses LIVEKIT_HOST for internal Docker networking (container-to-container),
 * falling back to LIVEKIT_URL for external access.
 *
 * RoomServiceClient is stateless (just holds URL + credentials) and safe to reuse.
 */
let instance: RoomServiceClient | null = null;

export function getRoomService(): RoomServiceClient {
    if (!instance) {
        const host = process.env.LIVEKIT_HOST || 'localhost:7880';
        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;

        if (!apiKey || !apiSecret) {
            throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set');
        }

        instance = new RoomServiceClient(`http://${host}`, apiKey, apiSecret);
    }

    return instance;
}
