import { timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { getRoomService } from './livekit';
import { parseRoomMeta } from './roomMeta';
import type { RoomMeta } from './roomMeta';
import { getCachedMeta, touchRoomMeta } from './roomStore';

/** Constant-time comparison that handles buffers of different length safely */
export function verifyAdminSecret(provided: string | undefined, stored: string | undefined): boolean {
    if (!provided || !stored) return false;
    try {
        // Pad to same length to avoid length leak (timingSafeEqual requires equal length)
        const a = Buffer.from(provided.padEnd(64, '\0'));
        const b = Buffer.from(stored.padEnd(64, '\0'));
        return timingSafeEqual(a, b) && provided.length === stored.length;
    } catch {
        return false;
    }
}

/** Fetch room + verify adminSecret. Returns context or sends error response and returns null. */
export async function getAuthedRoom(
    roomId: string,
    adminSecret: string | undefined,
    res: Response,
): Promise<{ roomService: ReturnType<typeof getRoomService>; meta: RoomMeta } | null> {
    const roomService = getRoomService();
    const rooms = await roomService.listRooms([roomId]);

    if (rooms.length === 0) {
        res.status(404).json({ error: 'room_not_found' });
        return null;
    }

    // Fetch the Redis cache once — it's the only place adminSecret is stored (never in
    // LiveKit metadata), and also the fallback source of truth if LiveKit metadata was lost.
    const cached = await getCachedMeta(roomId);
    const storedSecret = cached?.adminSecret;

    if (!storedSecret || !verifyAdminSecret(adminSecret, storedSecret)) {
        res.status(403).json({ error: 'forbidden' });
        return null;
    }

    let meta = parseRoomMeta(rooms[0].metadata);

    // If room lost metadata (e.g. LiveKit restarted and recreated the room),
    // restore from Redis cache and re-attach to the room (without adminSecret).
    // This write happens only AFTER auth succeeds above — an unauthenticated caller
    // must never be able to trigger a LiveKit metadata write.
    if (!meta && cached) {
        const { adminSecret: _secret, ...publicMeta } = cached;
        await roomService.updateRoomMetadata(roomId, JSON.stringify(publicMeta));
        meta = cached;
    }

    // Merge cached adminSecret into meta for downstream use
    if (meta) meta.adminSecret = storedSecret;

    // Successful admin auth proves the room is still in active use — refresh the Redis
    // TTL so long-lived rooms (occupied >24h) don't lose their adminSecret and lock the
    // creator out.
    await touchRoomMeta(roomId);

    return { roomService, meta: meta ?? cached! };
}
