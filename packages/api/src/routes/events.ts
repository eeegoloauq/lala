import { Router, Request, Response } from 'express';
import { addSseClient, removeSseClient } from '../lib/sse';

const MAX_SSE_CONNECTIONS = 100;
// Caps how many concurrent SSE streams a single IP can hold open, independent of the
// global cap — otherwise one client (or a small botnet) can exhaust all 100 slots.
const MAX_SSE_CONNECTIONS_PER_IP = 4;
let activeSseConnections = 0;
const connectionsByIp = new Map<string, number>();

export function createEventsRouter(): Router {
    const router = Router();

    /**
     * GET /api/events
     * Server-Sent Events stream — browsers connect once and receive push notifications
     * when room state changes (participant join/leave, room created/deleted).
     */
    router.get('/', (req: Request, res: Response) => {
        if (activeSseConnections >= MAX_SSE_CONNECTIONS) {
            res.status(503).json({ error: 'too_many_connections' });
            return;
        }

        const ip = req.ip ?? 'unknown';
        const ipConnections = connectionsByIp.get(ip) ?? 0;
        if (ipConnections >= MAX_SSE_CONNECTIONS_PER_IP) {
            res.status(503).json({ error: 'too_many_connections' });
            return;
        }

        activeSseConnections++;
        connectionsByIp.set(ip, ipConnections + 1);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        // Disable nginx proxy buffering so events arrive immediately
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        // Confirm connection to client
        res.write('event: connected\ndata: {}\n\n');

        addSseClient(res);

        // Keep-alive ping every 30s to prevent proxy/load-balancer timeouts
        const ping = setInterval(() => {
            try { res.write(': ping\n\n'); } catch { /* client gone */ }
        }, 30_000);

        req.on('close', () => {
            activeSseConnections--;
            const remaining = (connectionsByIp.get(ip) ?? 1) - 1;
            if (remaining <= 0) {
                connectionsByIp.delete(ip);
            } else {
                connectionsByIp.set(ip, remaining);
            }
            clearInterval(ping);
            removeSseClient(res);
        });
    });

    return router;
}
