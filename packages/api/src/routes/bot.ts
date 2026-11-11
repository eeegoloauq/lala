import { Router, type NextFunction, type Request, type Response } from 'express';
import type { BotInfo } from '@lala/shared';
import { botCaller } from '../lib/bots';
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
        await publishProfile(bot, profile);
        res.json(profile);
    });

    return router;
}
