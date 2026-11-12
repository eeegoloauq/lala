import express, { Router } from 'express';
import type { AvatarResponse, Me } from '@lala/shared';
import { callerIdentity } from '../lib/identity';
import { canCreateRooms, mayEnter, roleOf } from '../lib/rights';
import { isShutOut } from '../lib/bans';
import { config } from '../lib/config';
import { isBotIdentity } from '../lib/bots';
import { MAX_AVATAR_BYTES, deleteAvatar, putAvatar, touchAvatar } from '../lib/avatars';
import { broadcastSse } from '../lib/sse';
import { invalidateRoomsCache } from './rooms';

/** The lists carry avatar versions, so everyone refetches them after a change. */
function announceAvatarChange(): void {
    invalidateRoomsCache();
    broadcastSse('rooms_updated', { trigger: 'avatar' });
}

/**
 * GET /api/me: the caller's public identity (to put in the config) and what they may do.
 * POST /api/me/avatar (the image as the body) and DELETE /api/me/avatar: the caller's avatar.
 */
export function createMeRouter(): Router {
    const router = Router();
    router.get('/', async (req, res) => {
        const identity = callerIdentity(req);
        if (!identity) {
            res.status(400).json({ error: 'identity_required' });
            return;
        }
        const allowed = mayEnter(identity) && !await isShutOut(identity, req.ip);
        const me: Me = {
            identity,
            role: roleOf(identity) ?? 'guest',
            allowed,
            canCreateRooms: allowed && canCreateRooms(identity),
            serverName: config().name,
            theme: config().theme,
            avatar: await touchAvatar(identity),
            textChats: config().chats.length > 0 || config().rules !== undefined || undefined,
        };
        res.json(me);
    });

    router.post('/avatar', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_AVATAR_BYTES }), async (req, res) => {
        const identity = callerIdentity(req);
        if (!identity) {
            res.status(400).json({ error: 'identity_required' });
            return;
        }
        // A bot's avatar is set in the config; someone turned away can't put up a picture.
        if (isBotIdentity(identity) || !mayEnter(identity) || await isShutOut(identity, req.ip)) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        const version = Buffer.isBuffer(req.body) ? await putAvatar(identity, req.body) : undefined;
        if (!version) {
            res.status(400).json({ error: 'invalid_image' });
            return;
        }
        announceAvatarChange();
        const response: AvatarResponse = { avatar: version };
        res.json(response);
    });

    router.delete('/avatar', async (req, res) => {
        const identity = callerIdentity(req);
        if (!identity || isBotIdentity(identity)) {
            res.status(400).json({ error: 'identity_required' });
            return;
        }
        await deleteAvatar(identity);
        announceAvatarChange();
        res.status(204).end();
    });
    return router;
}
