import { Router, type Request, type Response } from 'express';
import type { PresenceChoice, PresenceResponse, PresenceTicketResponse } from '@lala/shared';
import { callerIdentity } from '../lib/identity';
import { isBotIdentity } from '../lib/bots';
import { mayEnter } from '../lib/rights';
import { isShutOut, serverBannedIdentities } from '../lib/bans';
import { config } from '../lib/config';
import { avatarVersions } from '../lib/avatars';
import { sanitizeDisplayText } from '../lib/sanitize';
import { PRESENCE_CHOICES, beat, buildPresenceList, issueTicket, loadPresence } from '../lib/presence';

/**
 * What the list is built from, shared for a second: every client refetches on the same
 * event, and only the caller's own row differs between them.
 */
const CACHE_MS = 1000;
let cached: { at: number; data: Promise<Awaited<ReturnType<typeof loadListData>>> } | undefined;

async function loadListData() {
    const users = config().users;
    const [{ online, states }, banned] = await Promise.all([loadPresence(users.keys()), serverBannedIdentities()]);
    const avatars = await avatarVersions([...new Set([...online, ...users.keys()])]);
    return { users, online, states, banned, avatars };
}

function listData() {
    if (!cached || Date.now() - cached.at > CACHE_MS) {
        const data = loadListData();
        cached = { at: Date.now(), data };
        data.catch(() => { if (cached?.data === data) cached = undefined; });
    }
    return cached.data;
}

/** The caller, when they are a person allowed on the server; answers the request otherwise. */
async function allowedCaller(req: Request, res: Response): Promise<string | undefined> {
    const identity = callerIdentity(req);
    if (!identity || isBotIdentity(identity)) {
        res.status(400).json({ error: 'identity_required' });
        return undefined;
    }
    if (!mayEnter(identity) || await isShutOut(identity, req.ip)) {
        res.status(403).json({ error: 'forbidden' });
        return undefined;
    }
    return identity;
}

/**
 * GET /api/presence: everyone online and the config's members who aren't (PresenceResponse).
 * PUT /api/presence: the caller's status and name; also the heartbeat that keeps them online.
 * POST /api/presence/ticket: a ticket for the event stream, which can't send the device header.
 */
export function createPresenceRouter(): Router {
    const router = Router();

    router.post('/ticket', async (req, res) => {
        const identity = await allowedCaller(req, res);
        if (!identity) return;
        const response: PresenceTicketResponse = { ticket: issueTicket(identity) };
        res.json(response);
    });

    router.get('/', async (req, res) => {
        const identity = await allowedCaller(req, res);
        if (!identity) return;
        const { users, online, states, banned, avatars } = await listData();
        const people = buildPresenceList({ online, states, users, banned, caller: identity });
        const response: PresenceResponse = { people: people.map(p => ({ ...p, avatar: avatars.get(p.identity) })) };
        res.json(response);
    });

    router.put('/', async (req, res) => {
        const { status, idle, name } = (req.body ?? {}) as Record<string, unknown>;
        const clean = typeof name === 'string' ? sanitizeDisplayText(name, 50) : '';
        if (!PRESENCE_CHOICES.includes(status as PresenceChoice) || typeof idle !== 'boolean' || !clean) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        const identity = await allowedCaller(req, res);
        if (!identity) return;
        await beat(identity, { status: status as PresenceChoice, idle, name: clean });
        res.status(204).end();
    });

    return router;
}
