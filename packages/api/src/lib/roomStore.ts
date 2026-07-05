import Redis from 'ioredis';
import type { RoomMeta } from './roomMeta';

const KEY_PREFIX = 'lala:room:';
const TTL_SECONDS = 86400; // 24 hours

let redis: Redis | null = null;

/**
 * Connect to Redis. Call once at startup from index.ts.
 * If Redis is unavailable, logs error but does not crash —
 * the API degrades gracefully (admin features won't survive restart).
 */
export async function connectRedis(): Promise<void> {
    const url = process.env.REDIS_URL || 'redis://:lala_redis_internal@lala-redis:6379';
    try {
        redis = new Redis(url, {
            maxRetriesPerRequest: 3,
            lazyConnect: true,
            retryStrategy(times) {
                if (times > 5) return null; // stop retrying after 5 attempts
                return Math.min(times * 200, 2000);
            },
        });

        redis.on('error', (err) => {
            console.error('[roomStore] Redis error:', err.message);
        });

        await redis.connect();
        console.log('[roomStore] Redis connected');

        // Graceful shutdown: disconnect Redis on process termination
        const shutdown = async () => {
            try {
                await redis?.quit();
                console.log('[roomStore] Redis disconnected');
            } catch { /* best effort */ }
            process.exit(0);
        };
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    } catch (err) {
        console.error('[roomStore] Redis connection failed, running without cache persistence:', (err as Error).message);
        redis = null;
    }
}

function key(roomId: string): string {
    return KEY_PREFIX + roomId;
}

/**
 * Store room metadata in Redis with 24h TTL (refreshed on every write).
 * Graceful fallback: logs error if Redis is down, does not throw.
 */
export async function cacheRoomMeta(roomId: string, meta: RoomMeta): Promise<void> {
    if (!redis) return;
    try {
        await redis.set(key(roomId), JSON.stringify(meta), 'EX', TTL_SECONDS);
    } catch (err) {
        console.error('[roomStore] Failed to cache meta for', roomId, (err as Error).message);
    }
}

/**
 * Retrieve cached room metadata from Redis.
 * Returns undefined if not found or Redis is unavailable.
 */
export async function getCachedMeta(roomId: string): Promise<RoomMeta | undefined> {
    if (!redis) return undefined;
    try {
        const raw = await redis.get(key(roomId));
        if (!raw) return undefined;
        return JSON.parse(raw) as RoomMeta;
    } catch (err) {
        console.error('[roomStore] Failed to get meta for', roomId, (err as Error).message);
        return undefined;
    }
}

/**
 * Refresh the 24h TTL of an existing cached room meta entry without rewriting its value.
 * Call this on every successful admin auth so long-lived rooms (occupied >24h) don't
 * silently lose their adminSecret and lock the creator out.
 * Graceful fallback: logs error if Redis is down, does not throw.
 */
export async function touchRoomMeta(roomId: string): Promise<void> {
    if (!redis) return;
    try {
        await redis.expire(key(roomId), TTL_SECONDS);
    } catch (err) {
        console.error('[roomStore] Failed to refresh TTL for', roomId, (err as Error).message);
    }
}

/**
 * Remove cached room metadata from Redis.
 * Graceful fallback: logs error if Redis is down, does not throw.
 */
export async function evictRoomMeta(roomId: string): Promise<void> {
    if (!redis) return;
    try {
        await redis.del(key(roomId));
    } catch (err) {
        console.error('[roomStore] Failed to evict meta for', roomId, (err as Error).message);
    }
}
