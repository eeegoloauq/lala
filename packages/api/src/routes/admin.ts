import { Router, type NextFunction, type Request, type Response } from 'express';
import type { BansResponse, ModerationEvent } from '@lala/shared';
import { announceModeration, getRoomService, isNotFound } from '../lib/livekit';
import { callerIdentity } from '../lib/identity';
import { attributesFor, can, isModerator, permissionFor } from '../lib/rights';
import { addBan, flagsOf, getRoom, isBanned, listBans, removeBan, setMuted, setVoice, type RoomState } from '../lib/rooms';
import { invalidateRoomsCache } from './rooms';
import { broadcastSse } from '../lib/sse';
import { isBotIdentity } from '../lib/bots';
import { removeBot } from '../lib/botInvites';
import { isShutOut, lastIpOf } from '../lib/bans';

/** Kicking or banning a bot someone added also ends the invitation, so it isn't asked back. */
async function endInvitation(ctx: Context): Promise<void> {
    if (isBotIdentity(ctx.target) && await removeBot(ctx.room.id, ctx.target)) invalidateRoomsCache();
}

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
async function announce(ctx: Context, action: ModerationEvent['action'], targetName: string, extra: Partial<ModerationEvent> = {}): Promise<void> {
    const byName = await nameOf(ctx.room.id, ctx.caller);
    const where = extra.to ? ` to ${extra.to.id}` : '';
    console.log(`[moderation] ${ctx.room.id}: ${byName} (${ctx.caller}) ${action} ${targetName} (${ctx.target})${where}`);
    await announceModeration(ctx.room.id, { action, target: ctx.target, targetName, byName, ...extra }).catch(ignoreNotFound);
}

/**
 * Why the person can't be moved into the room, or null when they can: the checks the
 * token route makes, so a move doesn't send someone to a room that turns them away.
 * A password room is never a destination: the server can't give anyone its key.
 */
async function refuseMove(target: string, to: RoomState): Promise<{ status: number; error: string } | null> {
    if (to.password) return { status: 400, error: 'password_room' };
    if (!can(target, to, 'join')) return { status: 403, error: 'not_allowed' };
    const ip = isModerator(target, to) ? undefined : await lastIpOf(target) ?? undefined;
    if (await isShutOut(target, ip) || await isBanned(to.id, target, ip)) return { status: 403, error: 'banned' };
    if (to.maxParticipants > 0) {
        const participants = await getRoomService().listParticipants(to.id).catch(() => []);
        if (participants.length >= to.maxParticipants) return { status: 403, error: 'room_full' };
    }
    return null;
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
        await endInvitation(ctx);
        await getRoomService().removeParticipant(ctx.room.id, ctx.target).catch(ignoreNotFound);
        await announce(ctx, 'kicked', targetName);
        res.json({ ok: true });
    });

    router.post('/ban', async (_req, res: Response) => {
        const ctx = res.locals.ctx as Context;
        const targetName = await nameOf(ctx.room.id, ctx.target);
        // A bot's address is its host's, which others may share.
        await addBan(ctx.room.id, ctx.target, targetName, isBotIdentity(ctx.target) ? null : await lastIpOf(ctx.target));
        await endInvitation(ctx);
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
        // The room list carries server mutes, and nothing else tells clients it changed:
        // LiveKit sends no webhook for a permission change.
        invalidateRoomsCache();
        broadcastSse('rooms_updated', { trigger: 'mute' });
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
        // The room list carries who has the floor; as with mutes, no webhook says it changed.
        invalidateRoomsCache();
        broadcastSse('rooms_updated', { trigger: 'voice' });
        await announce(ctx, allowed ? 'voiced' : 'unvoiced', await nameOf(ctx.room.id, ctx.target));
        res.json({ ok: true });
    });

    // Moves someone into another room the caller also moderates. The server only checks
    // and announces; the person's own client switches, through the token route like any
    // join, so nothing here grants more than joining would.
    router.post('/move', async (req, res: Response) => {
        const ctx = res.locals.ctx as Context;
        const { to: toId } = req.body ?? {};
        if (typeof toId !== 'string' || !toId || toId.length > 50 || toId === ctx.room.id
            || ctx.target === ctx.caller || isBotIdentity(ctx.target)) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        const to = await getRoom(toId);
        if (!to) {
            res.status(404).json({ error: 'room_not_found' });
            return;
        }
        if (!isModerator(ctx.caller, to)) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        const participant = await getRoomService().getParticipant(ctx.room.id, ctx.target).catch(ignoreNotFound);
        if (!participant) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const refused = await refuseMove(ctx.target, to);
        if (refused) {
            res.status(refused.status).json({ error: refused.error });
            return;
        }
        await announce(ctx, 'moved', participant.name || ctx.target, { to: { id: to.id, name: to.name } });
        res.json({ ok: true });
    });

    return router;
}
