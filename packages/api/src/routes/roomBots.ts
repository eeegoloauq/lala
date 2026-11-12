import { Router, type NextFunction, type Request, type Response } from 'express';
import type { BotInvitedEvent, RoomBot, RoomBotsResponse } from '@lala/shared';
import { announceModeration, getRoomService, isNotFound } from '../lib/livekit';
import { botCaller, botOf } from '../lib/bots';
import { isBotOnline, sendBotEvent } from '../lib/botEvents';
import { addBot, getAddedBot, listAddedBots, removeBot } from '../lib/botInvites';
import { BOT_PREFIX, config, type BotConfig } from '../lib/config';
import { callerIdentity } from '../lib/identity';
import { isModerator, mayAddBot } from '../lib/rights';
import { getRoom, isBanned, type RoomState } from '../lib/rooms';
import { broadcastSse } from '../lib/sse';
import { invalidateRoomsCache } from './rooms';

type RoomRequest = Request<{ id: string }>;

const ignoreNotFound = (err: unknown) => { if (!isNotFound(err)) throw err; };

/** Takes the bot out of the call; its tokens so far stop working, so it can't come back on its own. */
async function removeFromCall(roomId: string, identity: string): Promise<void> {
    const revokeTokenTs = BigInt(Math.floor(Date.now() / 1000) + 1);
    await getRoomService().removeParticipant(roomId, identity, { revokeTokenTs }).catch(ignoreNotFound);
}

/** Who is in the room changed: the room list shows added bots and who added them. */
function roomChanged(): void {
    invalidateRoomsCache();
    broadcastSse('rooms_updated', { trigger: 'bots' });
}

/**
 * /api/rooms/:id/bots: people add bots that the config lets them add to a room, and remove
 * them again; a bot ends its own invitation with DELETE /me.
 */
export function createRoomBotsRouter(): Router {
    const router = Router({ mergeParams: true });

    router.use(async (req: RoomRequest, res: Response, next: NextFunction) => {
        const room = await getRoom(req.params.id);
        if (!room) {
            res.status(404).json({ error: 'room_not_found' });
            return;
        }
        res.locals.room = room;
        next();
    });

    // A bot leaving for good: the room sees "Y left" and the bot is not asked back.
    router.delete('/me', async (req: RoomRequest, res: Response) => {
        const room: RoomState = res.locals.room;
        const bot = botCaller(req);
        if (!bot) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        if (!await getAddedBot(room.id, bot.identity)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        // Announced before it goes, so clients don't also say it left on its own.
        await announceModeration(room.id, { action: 'left', target: bot.identity, targetName: bot.name, byName: bot.name }).catch(ignoreNotFound);
        await removeBot(room.id, bot.identity);
        await removeFromCall(room.id, bot.identity);
        console.log(`[bots] ${bot.identity} left ${room.id}`);
        roomChanged();
        res.json({ ok: true });
    });

    // The rest is for people in the room.
    router.use(async (req: RoomRequest, res: Response, next: NextFunction) => {
        const room: RoomState = res.locals.room;
        const caller = callerIdentity(req);
        if (!caller || botCaller(req)) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        res.locals.caller = caller;
        next();
    });

    // Only bots people may add are found by key.
    router.param('key', (_req, res: Response, next: NextFunction, key: string) => {
        const bot = botOf(BOT_PREFIX + key);
        if (!bot?.invite) {
            res.status(404).json({ error: 'bot_not_found' });
            return;
        }
        res.locals.bot = bot;
        next();
    });

    router.get('/', async (_req, res: Response) => {
        const room: RoomState = res.locals.room;
        const caller: string = res.locals.caller;
        const added = new Set((await listAddedBots(room.id)).map((b) => b.identity));
        const bots: RoomBot[] = [...config().bots.values()]
            .filter((bot) => mayAddBot(caller, room, bot))
            .map((bot) => ({
                key: bot.key,
                identity: bot.identity,
                name: bot.name,
                avatar: bot.avatar,
                listens: bot.rights.listen,
                online: isBotOnline(bot.identity),
                added: added.has(bot.identity),
            }));
        const response: RoomBotsResponse = { bots };
        res.json(response);
    });

    // Adding a bot that is already added asks it to join again, for a bot that didn't come.
    router.post('/:key', async (_req, res: Response) => {
        const room: RoomState = res.locals.room;
        const caller: string = res.locals.caller;
        const bot: BotConfig = res.locals.bot;
        if (!mayAddBot(caller, room, bot)) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        // The bot would need the media key, which the server never has.
        if (room.password) {
            res.status(409).json({ error: 'password_room' });
            return;
        }
        if (await isBanned(room.id, bot.identity)) {
            res.status(403).json({ error: 'banned' });
            return;
        }
        // Only someone in the call adds to it; their name is what the room sees.
        const inviter = await getRoomService().getParticipant(room.id, caller).catch(ignoreNotFound);
        if (!inviter) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        if (!isBotOnline(bot.identity)) {
            res.status(409).json({ error: 'bot_offline' });
            return;
        }
        const byName = inviter.name || caller;
        const created = await addBot(room.id, bot.identity, caller, byName);
        if (created) {
            console.log(`[bots] ${byName} (${caller}) added ${bot.identity} to ${room.id}`);
            await announceModeration(room.id, { action: 'added', target: bot.identity, targetName: bot.name, byName, listens: bot.rights.listen }).catch(ignoreNotFound);
            roomChanged();
        }
        const event: BotInvitedEvent = { room: { id: room.id, name: room.name }, byName: (await getAddedBot(room.id, bot.identity))?.addedByName ?? byName };
        sendBotEvent(bot.identity, 'invited', event);
        res.status(created ? 201 : 200).json({ ok: true });
    });

    // The person who added the bot, or a moderator, removes it: a kick that ends the invitation.
    router.delete('/:key', async (_req, res: Response) => {
        const room: RoomState = res.locals.room;
        const caller: string = res.locals.caller;
        const bot: BotConfig = res.locals.bot;
        const added = await getAddedBot(room.id, bot.identity);
        if (!added) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        if (added.addedBy !== caller && !isModerator(caller, room)) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        const byName = (await getRoomService().getParticipant(room.id, caller).catch(ignoreNotFound))?.name || caller;
        console.log(`[bots] ${byName} (${caller}) removed ${bot.identity} from ${room.id}`);
        await announceModeration(room.id, { action: 'removed', target: bot.identity, targetName: bot.name, byName }).catch(ignoreNotFound);
        await removeBot(room.id, bot.identity);
        await removeFromCall(room.id, bot.identity);
        roomChanged();
        res.json({ ok: true });
    });

    return router;
}
