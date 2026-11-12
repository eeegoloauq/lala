import { Router, type NextFunction, type Request, type Response } from 'express';
import type { BotInfo, BotInvitedEvent } from '@lala/shared';
import { botCaller } from '../lib/bots';
import { addBotStream, removeBotStream, writeEvent } from '../lib/botEvents';
import { getAddedBot, roomsAddedTo } from '../lib/botInvites';
import { getProfile, parseProfileUpdate, publishProfile, updateProfile } from '../lib/botProfile';
import { config, type BotConfig } from '../lib/config';

/** /api/bot: a bot reads its own account and sets its status line and commands. */
export function createBotRouter(): Router {
    const router = Router();

    router.use((req: Request, res: Response, next: NextFunction) => {
        const bot = botCaller(req);
        if (!bot) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        res.locals.bot = bot;
        next();
    });

    router.get('/', async (_req, res: Response) => {
        const bot: BotConfig = res.locals.bot;
        const info: BotInfo = {
            identity: bot.identity,
            name: bot.name,
            rooms: config().rooms.filter((r) => bot.rooms.has(r.id)).map((r) => ({ id: r.id, name: r.name })),
            rights: bot.rights,
            ...await getProfile(bot.identity),
        };
        res.json(info);
    });

    // Fields left out keep their value; an empty status or list clears it.
    router.post('/profile', async (req: Request, res: Response) => {
        const bot: BotConfig = res.locals.bot;
        const update = parseProfileUpdate(req.body);
        if (!update) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        const profile = await updateProfile(bot.identity, update);
        const added = await roomsAddedTo(bot.identity);
        await publishProfile(bot, profile, new Set([...bot.rooms, ...added.map((r) => r.id)]));
        res.json(profile);
    });

    // Server-sent events: `invited` and `removed` (BotInvitedEvent, BotRemovedEvent). A bot
    // keeps this open to be added to rooms; it is "online" for the room's people while it does.
    router.get('/events', async (req: Request, res: Response) => {
        const bot: BotConfig = res.locals.bot;
        if (!addBotStream(bot.identity, res)) {
            res.status(503).json({ error: 'too_many_connections' });
            return;
        }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        const ping = setInterval(() => res.write(': ping\n\n'), 30_000);
        req.on('close', () => {
            clearInterval(ping);
            removeBotStream(bot.identity, res);
        });
        writeEvent(res, 'connected', {});
        // Rooms it was added to while it was away, or before the API restarted.
        for (const room of await roomsAddedTo(bot.identity)) {
            const added = await getAddedBot(room.id, bot.identity);
            if (!added) continue;
            const event: BotInvitedEvent = { room: { id: room.id, name: room.name }, byName: added.addedByName };
            writeEvent(res, 'invited', event);
        }
    });

    return router;
}
