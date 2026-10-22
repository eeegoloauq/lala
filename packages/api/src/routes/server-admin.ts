import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ServerBansResponse } from '@lala/shared';
import { banFromServer, listServerBans, unbanFromServer } from '../lib/bans';
import { announceModeration, getRoomService, isNotFound } from '../lib/livekit';
import { callerIdentity } from '../lib/identity';
import { roleOf } from '../lib/rights';
import { listRoomStates } from '../lib/rooms';

/** /api/admin: server-wide moderation for admins named in the config. */
export function createServerAdminRouter(): Router {
    const router = Router();

    router.use((req: Request, res: Response, next: NextFunction) => {
        const caller = callerIdentity(req);
        if (roleOf(caller) !== 'admin') {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        const target = (req.body ?? {}).identity;
        if (req.method === 'POST' && (typeof target !== 'string' || !target || target.length > 100)) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        res.locals.caller = caller;
        next();
    });

    router.get('/bans', async (_req, res: Response) => {
        const response: ServerBansResponse = { bans: await listServerBans() };
        res.json(response);
    });

    // Removes the person from every room they are in, revoking the tokens they hold.
    router.post('/ban', async (req: Request, res: Response) => {
        const target: string = req.body.identity;
        const caller: string = res.locals.caller;
        if (roleOf(target) === 'admin') {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        const service = getRoomService();
        const present: Array<{ roomId: string; name: string; byName: string }> = [];
        for (const room of await listRoomStates()) {
            const participants = await service.listParticipants(room.id).catch((err) => {
                if (isNotFound(err)) return [];
                throw err;
            });
            const found = participants.find((p) => p.identity === target);
            if (found) present.push({ roomId: room.id, name: found.name, byName: participants.find((p) => p.identity === caller)?.name ?? 'Admin' });
        }
        const name = present[0]?.name || target;
        await banFromServer(target, name);
        const revokeTokenTs = BigInt(Math.floor(Date.now() / 1000) + 1);
        for (const { roomId, byName } of present) {
            await service.removeParticipant(roomId, target, { revokeTokenTs }).catch((err) => { if (!isNotFound(err)) throw err; });
            await announceModeration(roomId, { action: 'banned', target, targetName: name, byName }).catch(() => {});
        }
        console.log(`[moderation] server: ${caller} banned ${name} (${target})`);
        res.json({ ok: true });
    });

    router.post('/unban', async (req: Request, res: Response) => {
        await unbanFromServer(req.body.identity);
        console.log(`[moderation] server: ${res.locals.caller} unbanned ${req.body.identity}`);
        res.json({ ok: true });
    });

    return router;
}
