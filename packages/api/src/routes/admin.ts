import { Router, type NextFunction, type Request, type Response } from 'express';
import type { BansResponse, ModerationEvent } from '@lala/shared';
import { announceModeration, getRoomService, isNotFound } from '../lib/livekit';
import { callerIdentity } from '../lib/identity';
import { attributesFor, isModerator, permissionFor } from '../lib/rights';
import { addBan, flagsOf, getRoom, listBans, removeBan, setMuted, setVoice, type RoomState } from '../lib/rooms';
import { invalidateRoomsCache } from './rooms';

type ModerationRequest = Request<{ id: string }>;
interface Context { room: RoomState; caller: string; target: string }

const ignoreNotFound = (err: unknown) => { if (!isNotFound(err)) throw err; };

/** Display name of someone in the room, or their identity when they aren't there. */
async function nameOf(roomId: string, identity: string): Promise<string> {
    const participant = await getRoomService().getParticipant(roomId, identity).catch(ignoreNotFound);
    return participant?.name || identity;
}

/** Brings a connected participant's permission and markers in line with what is stored. */
async function applyFlags(ctx: Context, extra: Record<string, string> = {}): Promise<void> {
    const flags = await flagsOf(ctx.room.id, ctx.target);
    await getRoomService().updateParticipant(ctx.room.id, ctx.target, {
        permission: permissionFor(ctx.target, ctx.room, flags),
        attributes: { ...attributesFor(flags), ...extra },
    }).catch(ignoreNotFound);
}

/** Logged so the operator can see who moderated whom. */
async function announce(ctx: Context, action: ModerationEvent['action'], targetName: string): Promise<void> {
    const byName = await nameOf(ctx.room.id, ctx.caller);
    console.log(`[moderation] ${ctx.room.id}: ${byName} (${ctx.caller}) ${action} ${targetName} (${ctx.target})`);
    await announceModeration(ctx.room.id, { action, target: ctx.target, targetName, byName }).catch(ignoreNotFound);
}

export function createAdminRouter(): Router {
    const router = Router({ mergeParams: true });

    // Every action needs a moderator of this room; the target, where there is one, an identity.
    router.use(async (req: ModerationRequest, res: Response, next: NextFunction) => {
        const room = await getRoom(req.params.id);
        if (!room) {
            res.status(404).json({ error: 'room_not_found' });
            return;
        }
        const caller = callerIdentity(req);
        if (!caller || !isModerator(caller, room)) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        const target = (req.body ?? {}).identity;
        if (req.method === 'POST' && (typeof target !== 'string' || !target || target.length > 100)) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        res.locals.ctx = { room, caller, target } satisfies Context;
        next();
    });

    router.get('/bans', async (_req, res: Response) => {
        const { room } = res.locals.ctx as Context;
        const response: BansResponse = { bans: await listBans(room.id) };
        res.json(response);
    });

    router.post('/kick', async (_req, res: Response) => {
        const ctx = res.locals.ctx as Context;
        const targetName = await nameOf(ctx.room.id, ctx.target);
        await getRoomService().removeParticipant(ctx.room.id, ctx.target).catch(ignoreNotFound);
        await announce(ctx, 'kicked', targetName);
        res.json({ ok: true });
    });

    router.post('/ban', async (_req, res: Response) => {
        const ctx = res.locals.ctx as Context;
        const targetName = await nameOf(ctx.room.id, ctx.target);
        await addBan(ctx.room.id, ctx.target, targetName);
        // Revoking tokens issued up to now keeps the banned client from reconnecting
        // with the one it already holds.
        const revokeTokenTs = BigInt(Math.floor(Date.now() / 1000) + 1);
        await getRoomService().removeParticipant(ctx.room.id, ctx.target, { revokeTokenTs }).catch(ignoreNotFound);
        await announce(ctx, 'banned', targetName);
        res.json({ ok: true });
    });

    router.post('/unban', async (_req, res: Response) => {
        const ctx = res.locals.ctx as Context;
        await removeBan(ctx.room.id, ctx.target);
        res.json({ ok: true });
    });

    router.post('/mute', async (req, res: Response) => {
        const ctx = res.locals.ctx as Context;
        const { muted } = req.body ?? {};
        if (typeof muted !== 'boolean') {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        // Stored first: the token for a reconnect is built from it.
        await setMuted(ctx.room.id, ctx.target, muted);
        await applyFlags(ctx);
        invalidateRoomsCache();
        await announce(ctx, muted ? 'muted' : 'unmuted', await nameOf(ctx.room.id, ctx.target));
        res.json({ ok: true });
    });

    // Gives or takes the floor in a room where the person may not speak by right.
    router.post('/voice', async (req, res: Response) => {
        const ctx = res.locals.ctx as Context;
        const { allowed } = req.body ?? {};
        if (typeof allowed !== 'boolean') {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        await setVoice(ctx.room.id, ctx.target, allowed);
        await applyFlags(ctx, { 'lala.hand': '' });
        await announce(ctx, allowed ? 'voiced' : 'unvoiced', await nameOf(ctx.room.id, ctx.target));
        res.json({ ok: true });
    });

    return router;
}
