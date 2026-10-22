import { Router } from 'express';
import type { Me } from '@lala/shared';
import { callerIdentity } from '../lib/identity';
import { canCreateRooms, mayEnter, roleOf } from '../lib/rights';
import { isShutOut } from '../lib/bans';

/** GET /api/me: the caller's public identity (to put in the config) and what they may do. */
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
        };
        res.json(me);
    });
    return router;
}
