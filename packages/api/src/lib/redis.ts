import Redis from 'ioredis';

let client: Redis | undefined;

/** Room state lives only in Redis, so the API refuses to start without it. */
export async function connectRedis(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL must be set');
    client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 });
    client.on('error', (err) => console.error('[redis]', err.message));
    await client.connect();
}

export function redis(): Redis {
    if (!client) throw new Error('Redis is not connected');
    return client;
}

export function redisReady(): boolean {
    return client?.status === 'ready';
}
