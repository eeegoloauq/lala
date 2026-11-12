import { Router } from 'express';
import { getAvatar } from '../lib/avatars';

/** Public identities: 36 hex characters for people, `bot-<key>` for bots. */
const IDENTITY = /^([0-9a-f]{36}|bot-[a-z0-9-]{1,40})$/;

/**
 * GET /api/avatars/:identity?v=<version>: the avatar image. With the current version the
 * URL is cached for good; anything else is revalidated, so an old link never shows a
 * stale picture for long. Behind the access gate like the rest of the API, hence `private`.
 */
export function createAvatarsRouter(): Router {
    const router = Router();
    router.get('/:identity', async (req, res) => {
        const { identity } = req.params;
        const avatar = IDENTITY.test(identity) ? await getAvatar(identity) : undefined;
        if (!avatar) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const etag = `"${avatar.version}"`;
        res.set({
            'Content-Type': `image/${avatar.type}`,
            'X-Content-Type-Options': 'nosniff',
            // An image is all it is: nothing in it may run or load, and other sites can't embed it.
            'Content-Security-Policy': "default-src 'none'",
            'Cross-Origin-Resource-Policy': 'same-origin',
            'Cache-Control': req.query.v === avatar.version ? 'private, max-age=31536000, immutable' : 'private, no-cache',
            ETag: etag,
        });
        if (req.header('If-None-Match') === etag) {
            res.status(304).end();
            return;
        }
        res.send(avatar.data);
    });
    return router;
}
