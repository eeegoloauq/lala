import { Router, Request, Response } from 'express';
import { addSseClient, removeSseClient } from '../lib/sse';
import { streamClosed, streamOpened, verifyTicket } from '../lib/presence';

/** A positive whole number from the environment, or the default. */
function limitFromEnv(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

// Every open app holds a stream, so the global cap is how many people can be online at
// once. The per-IP cap stops one client from taking every slot, with room for a household
// or an office behind one address, each with a few tabs and devices.
const MAX_SSE_CONNECTIONS = limitFromEnv('LALA_MAX_EVENT_STREAMS', 1000);
const MAX_SSE_CONNECTIONS_PER_IP = limitFromEnv('LALA_MAX_EVENT_STREAMS_PER_IP', 20);
let activeSseConnections = 0;
const connectionsByIp = new Map<string, number>();

export function createEventsRouter(): Router {
    const router = Router();

    /**
     * GET /api/events[?ticket=<from POST /api/presence/ticket>]
     * Server-Sent Events: `rooms_updated` when room state changes, `presence_updated` when
     * someone comes, goes or changes status. With a ticket the stream also keeps its
     * identity online until it closes. A bad or expired ticket is refused (401), so the
     * client fetches a new one instead of staying connected as nobody.
     */
    router.get('/', (req: Request, res: Response) => {
        const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : undefined;
        const identity = ticket ? verifyTicket(ticket) : null;
        if (ticket && !identity) {
            res.status(401).json({ error: 'invalid_ticket' });
            return;
        }

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
        if (identity) streamOpened(identity).catch((err) => console.error('[presence] marking a stream online failed:', err));

        // Keep-alive ping every 30s to prevent proxy/load-balancer timeouts
        const ping = setInterval(() => res.write(': ping\n\n'), 30_000);

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
            if (identity) streamClosed(identity);
        });
    });

    return router;
}
