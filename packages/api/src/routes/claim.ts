import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { callerIdentity } from '../lib/identity';
import { isBotIdentity } from '../lib/bots';
import { claimAdmin } from '../lib/adminClaim';
import { broadcastSse } from '../lib/sse';
import { invalidateRoomsCache } from './rooms';

/** POST /api/claim { token }: the link `setup.sh` prints makes its opener the first admin. */
export function createClaimRouter(): Router {
    const router = Router();
    router.post('/', rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        skipSuccessfulRequests: true,
        standardHeaders: true,
        legacyHeaders: false,
    }), async (req, res) => {
        const identity = callerIdentity(req);
        const { token } = (req.body ?? {}) as Record<string, unknown>;
        if (!identity || isBotIdentity(identity) || typeof token !== 'string' || token.length > 200) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        if (!await claimAdmin(identity, token)) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        // Lists carry who may moderate.
        invalidateRoomsCache();
        broadcastSse('rooms_updated', { trigger: 'admin' });
        res.status(204).end();
    });
    return router;
}
