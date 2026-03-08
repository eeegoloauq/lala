import { Router, Request, Response } from 'express';
import { getAuthedRoom } from '../lib/auth';
import type { RoomMeta } from '../lib/roomMeta';
import { cacheRoomMeta } from '../lib/roomStore';

/** Strip adminSecret before writing metadata back to LiveKit (it must never be in LK metadata) */
function stripSecret(meta: RoomMeta): Omit<RoomMeta, 'adminSecret'> {
    const { adminSecret: _, ...publicMeta } = meta;
    return publicMeta;
}

/** Validate adminSecret + identity from request body. Sends 400 and returns false on invalid input. */
function validateAdminInput(
    res: Response,
    adminSecret: string | undefined,
    identity: string | undefined,
): identity is string {
    if (adminSecret !== undefined && (typeof adminSecret !== 'string' || adminSecret.length > 100)) {
        res.status(400).json({ error: 'invalid_input' });
        return false;
    }
    if (!identity || typeof identity !== 'string' || identity.length > 100) {
        res.status(400).json({ error: 'invalid_input' });
        return false;
    }
    return true;
}

export function createAdminRouter(): Router {
    const router = Router({ mergeParams: true });

    /** Kick a participant (immediate disconnect, can rejoin) */
    router.post('/kick', async (req: Request, res: Response): Promise<void> => {
        try {
            const { identity, adminSecret } = req.body as { identity?: string; adminSecret?: string };
            if (!validateAdminInput(res, adminSecret, identity)) return;

            const ctx = await getAuthedRoom(req.params.id, adminSecret, res);
            if (!ctx) return;

            await ctx.roomService.removeParticipant(req.params.id, identity);
            res.json({ ok: true });
        } catch (err) {
            console.error('kick error:', err);
            res.status(500).json({ error: 'server_error' });
        }
    });

    /** Ban: add to bannedIdentities list + kick if in room */
    router.post('/ban', async (req: Request, res: Response): Promise<void> => {
        try {
            const { identity, adminSecret } = req.body as { identity?: string; adminSecret?: string };
            if (!validateAdminInput(res, adminSecret, identity)) return;

            const ctx = await getAuthedRoom(req.params.id, adminSecret, res);
            if (!ctx) return;

            const banned = [...(ctx.meta.bannedIdentities ?? [])];
            if (!banned.includes(identity)) banned.push(identity);

            const newMeta = { ...stripSecret(ctx.meta), bannedIdentities: banned };
            await ctx.roomService.updateRoomMetadata(req.params.id, JSON.stringify(newMeta));
            await cacheRoomMeta(req.params.id, { ...ctx.meta, bannedIdentities: banned });

            // Kick from room if currently connected (ignore error if not present)
            try { await ctx.roomService.removeParticipant(req.params.id, identity); } catch { /* ok */ }

            res.json({ ok: true });
        } catch (err) {
            console.error('ban error:', err);
            res.status(500).json({ error: 'server_error' });
        }
    });

    /** Unban: remove from bannedIdentities */
    router.post('/unban', async (req: Request, res: Response): Promise<void> => {
        try {
            const { identity, adminSecret } = req.body as { identity?: string; adminSecret?: string };
            if (!validateAdminInput(res, adminSecret, identity)) return;

            const ctx = await getAuthedRoom(req.params.id, adminSecret, res);
            if (!ctx) return;

            const banned = (ctx.meta.bannedIdentities ?? []).filter((i) => i !== identity);
            const newMeta = { ...stripSecret(ctx.meta), bannedIdentities: banned };
            await ctx.roomService.updateRoomMetadata(req.params.id, JSON.stringify(newMeta));
            await cacheRoomMeta(req.params.id, { ...ctx.meta, bannedIdentities: banned });

            res.json({ ok: true });
        } catch (err) {
            console.error('unban error:', err);
            res.status(500).json({ error: 'server_error' });
        }
    });

    /** Force-mute or force-unmute a participant via server-side permission */
    router.post('/mute', async (req: Request, res: Response): Promise<void> => {
        try {
            const { identity, muted, adminSecret } = req.body as { identity?: string; muted?: boolean; adminSecret?: string };
            if (!validateAdminInput(res, adminSecret, identity)) return;

            const ctx = await getAuthedRoom(req.params.id, adminSecret, res);
            if (!ctx) return;

            const participant = await ctx.roomService.getParticipant(req.params.id, identity);

            await ctx.roomService.updateParticipant(req.params.id, identity, undefined, {
                ...participant.permission,
                canPublish: !muted,
            });

            res.json({ ok: true });
        } catch (err) {
            console.error('mute error:', err);
            res.status(500).json({ error: 'server_error' });
        }
    });

    return router;
}
