import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createTokenRouter } from './routes/token';
import { createRoomsRouter } from './routes/rooms';
import { createAdminRouter } from './routes/admin';
import { createWebhookRouter } from './routes/webhook';
import { createEventsRouter } from './routes/events';
import { createAccessRouter, requireAccess } from './routes/access';
import { connectRedis } from './lib/roomStore';

/**
 * Lala API Server
 *
 * Endpoints:
 * - POST /api/token           — Generate LiveKit JWT tokens
 * - GET/POST /api/rooms       — List and create rooms
 * - /api/rooms/:id/admin/*    — Admin actions (kick/ban/mute)
 * - POST /api/webhook         — LiveKit webhook receiver (raw body, must be before express.json)
 * - GET  /api/events          — SSE stream for real-time room updates
 * - GET/POST /api/access       — Optional instance password (LALA_ACCESS_PASSWORD)
 * - POST /api/access/invite     — Expiring invite that stands in for that password
 */
const app = express();
app.set('trust proxy', 1);
const port = parseInt(process.env.API_PORT || '3001', 10);

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map(o => o.trim());
app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'DELETE'],
}));

const limiter = (max: number, skip?: (req: express.Request) => boolean) => rateLimit({
    windowMs: 15 * 1000,
    max,
    skip,
    standardHeaders: true,
    legacyHeaders: false,
});

// Webhook MUST be registered before express.json() to preserve raw body for signature verification
app.use('/api/webhook', express.raw({ type: '*/*' }), createWebhookRouter());

// JSON parsing for all other routes
app.use(express.json({ limit: '16kb' }));

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'lala-api' });
});

// Everything registered after the gate needs the instance password when one is set;
// health, webhook and the access endpoint itself stay open.
app.use('/api/access', limiter(30), createAccessRouter());
app.use('/api', requireAccess);

// Routes — limits per 15s window (≈ same requests/min as before)
app.use('/api/token', limiter(25), createTokenRouter());   // ~100/min (password pool can send up to 20 in burst)
// Admin routes MUST be mounted before the broader '/api/rooms' mount: Express matches
// mount paths by prefix, so '/api/rooms/:id/admin/*' also matches '/api/rooms'. Mounting
// admin first means its requests are fully handled (and rate-limited) here and never
// fall through to the rooms(30) limiter below — avoiding double-counting a single
// admin action against both rate-limit windows.
app.use('/api/rooms/:id/admin', limiter(20), createAdminRouter()); // 80/min — admin actions are authed, need headroom for mute toggling
// Every client refetches the room list when anyone joins or leaves, so list reads get
// their own budget: otherwise a busy room behind one IP locks it out of creating and
// deleting rooms. The list is served from a 2s cache.
app.use('/api/rooms',
    limiter(60, req => req.method !== 'GET'),
    limiter(30, req => req.method === 'GET'),   // 120/min
    createRoomsRouter());
app.use('/api/events', limiter(5), createEventsRouter());

// 404 handler — don't leak Express default page
app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
});

// Global error handler — never leak stack traces
app.use((err: Error & { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.type === 'entity.parse.failed') {
        res.status(400).json({ error: 'invalid_json' });
        return;
    }
    if (err.type === 'entity.too.large') {
        res.status(413).json({ error: 'payload_too_large' });
        return;
    }
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'server_error' });
});

// Unhandled promise rejections shouldn't crash the process — log and keep serving.
process.on('unhandledRejection', (reason) => {
    console.error('[lala-api] Unhandled rejection:', reason);
});

// Uncaught exceptions leave the process in an undefined state — log and exit so
// Docker's restart policy can bring up a clean instance.
process.on('uncaughtException', (err) => {
    console.error('[lala-api] Uncaught exception:', err);
    process.exit(1);
});

// Start
(async () => {
    await connectRedis();
    app.listen(port, '0.0.0.0', () => {
        console.log(`[lala-api] listening on port ${port}`);
        console.log(`[lala-api] LiveKit: ${process.env.LIVEKIT_URL}`);
    });
})().catch(err => {
    console.error('[Lala] Fatal startup error:', err);
    process.exit(1);
});
