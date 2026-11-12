import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createTokenRouter } from './routes/token';
import { createRoomsRouter } from './routes/rooms';
import { createAdminRouter } from './routes/admin';
import { createWebhookRouter } from './routes/webhook';
import { createEventsRouter } from './routes/events';
import { createAccessRouter, requireAccess } from './routes/access';
import { createMeRouter } from './routes/me';
import { createAvatarsRouter } from './routes/avatars';
import { createServerAdminRouter } from './routes/server-admin';
import { createBotRouter } from './routes/bot';
import { createRoomBotsRouter } from './routes/roomBots';
import { createPresenceRouter } from './routes/presence';
import { createChatsRouter } from './routes/chats';
import { createClaimRouter } from './routes/claim';
import { loadClaimedAdmins } from './lib/adminClaim';
import { loadRules, requireRules } from './lib/rules';
import { initFiles, sweepFiles } from './lib/chatFiles';
import { messageExists, sweepChats } from './lib/chats';
import { sweepPresence } from './lib/presence';
import { botAuth } from './lib/bots';
import { syncBots } from './lib/botSync';
import { ConfigError, loadConfig } from './lib/config';
import { connectRedis, redisReady } from './lib/redis';
import { dropStaleRooms, syncPermanentRooms } from './routes/rooms';

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
 * - GET /api/bot, POST /api/bot/profile — A bot's account, status line and commands
 * - GET /api/bot/events       — SSE for a bot: rooms it is added to and removed from
 * - /api/rooms/:id/bots       — People add bots to a room and remove them
 * - /api/presence             — Who is online, the caller's status, tickets for the event stream
 * - /api/chats, /api/rules/accept, /api/files — Text chats from the config, its rules, files sent in chats
 */
const app = express();
app.set('trust proxy', 1);
const port = parseInt(process.env.API_PORT || '3001', 10);

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map(o => o.trim());
app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
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

// JSON parsing for all other routes. A chat file upload is read as a stream by its route,
// whatever type the file claims (a .json file would otherwise be parsed here).
const CHAT_UPLOAD = /^\/api\/chats\/[^/]+\/files\/?$/;
const json = express.json({ limit: '16kb' });
app.use((req, res, next) => CHAT_UPLOAD.test(req.path) ? next() : json(req, res, next));

// Health check
// Room state lives in Redis, so the API is not healthy without it.
app.get('/api/health', (_req, res) => {
    res.status(redisReady() ? 200 : 503).json({ status: redisReady() ? 'ok' : 'redis_unavailable', service: 'lala-api' });
});

// A bot credential is checked first: it stands in for both the device ID and the
// instance password, and a wrong one is refused outright.
app.use('/api', botAuth);

// Everything registered after the gate needs the instance password when one is set;
// health, webhook and the access endpoint itself stay open.
app.use('/api/access', limiter(30), createAccessRouter());
app.use('/api', requireAccess);

// Rules the config requires come first: until someone agrees, rooms, tokens, presence and
// chats refuse them (GET /api/chats still shows the rules).
app.use(['/api/token', '/api/rooms', '/api/presence'], requireRules);

// Routes — limits per 15s window (≈ same requests/min as before)
app.use('/api/token', limiter(25), createTokenRouter());   // ~100/min (password pool can send up to 20 in burst)
// Admin routes MUST be mounted before the broader '/api/rooms' mount: Express matches
// mount paths by prefix, so '/api/rooms/:id/admin/*' also matches '/api/rooms'. Mounting
// admin first means its requests are fully handled (and rate-limited) here and never
// fall through to the rooms(30) limiter below — avoiding double-counting a single
// admin action against both rate-limit windows.
app.use('/api/rooms/:id/admin', limiter(20), createAdminRouter()); // 80/min — headroom for mute toggling
app.use('/api/rooms/:id/bots', limiter(20), createRoomBotsRouter());
// Every client refetches the room list when anyone joins or leaves, so list reads get
// their own budget: otherwise a busy room behind one IP locks it out of creating and
// deleting rooms. The list is served from a 2s cache.
app.use('/api/rooms',
    limiter(60, req => req.method !== 'GET'),
    limiter(30, req => req.method === 'GET'),   // 120/min
    createRoomsRouter());
app.use('/api/events', limiter(5), createEventsRouter());
// Every client refetches the list on each change (batched to one event a second) and sends
// its status every 30 seconds per tab; a ticket is needed only when the stream (re)opens.
app.use('/api/presence/ticket', limiter(10));
app.use('/api/presence', limiter(120), createPresenceRouter());
// Each change makes every client refetch the room list, so changes get a small budget.
app.use('/api/me/avatar', limiter(5, req => req.method === 'GET'));
app.use('/api/me', limiter(30), createMeRouter());
// A client loads each avatar once per version; the rest comes from its cache.
app.use('/api/avatars', limiter(150), createAvatarsRouter());
app.use('/api/admin', limiter(20), createServerAdminRouter());
app.use('/api/claim', limiter(10), createClaimRouter());
app.use('/api/bot', limiter(20), createBotRouter());
// Opening a chat loads a page of messages and its pictures; sending, reacting and
// uploading get their own smaller budgets.
app.use('/api/files', limiter(300));
app.use('/api/chats/:chat/files', limiter(20, req => req.method !== 'POST'));
app.use(['/api/chats', '/api/rules'], limiter(60, req => req.method === 'GET'), limiter(120, req => req.method !== 'GET'));
app.use('/api', createChatsRouter());

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
    loadConfig();
    await connectRedis();
    await syncPermanentRooms();
    await loadRules();
    await loadClaimedAdmins();
    await initFiles();
    await syncBots().catch((err) => console.error('[bots] syncing connected bots with the config failed:', err));
    const dropStale = () => dropStaleRooms().catch((err) => console.error('[rooms] dropping stale rooms failed:', err));
    await dropStale();
    setInterval(dropStale, 5 * 60 * 1000);
    const sweepChatHistory = () => sweepChats()
        .then(() => sweepFiles(messageExists))
        .catch((err) => console.error('[chats] sweeping history and files failed:', err));
    await sweepChatHistory();
    setInterval(sweepChatHistory, 5 * 60 * 1000);
    setInterval(() => sweepPresence().catch((err) => console.error('[presence] sweep failed:', err)), 15 * 1000);
    app.listen(port, '0.0.0.0', () => {
        console.log(`[lala-api] listening on port ${port}`);
        console.log(`[lala-api] LiveKit: ${process.env.LIVEKIT_URL}`);
    });
})().catch(err => {
    if (err instanceof ConfigError) console.error(`[Lala] The server config has a mistake, fix it and restart the API.\n${err.message}`);
    else console.error('[Lala] Fatal startup error:', err);
    process.exit(1);
});
