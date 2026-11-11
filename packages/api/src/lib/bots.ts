import { createHash, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { BOT_PREFIX, config, type BotConfig } from './config';
import { verifySecret } from './secrets';

/**
 * Bot accounts sign in with `Authorization: Bearer <key>.<secret>`, where key is the
 * bot's entry under `bots:` in the config. A valid credential makes the request the
 * bot's, in place of a device ID and of the server password.
 */

const authenticated = new WeakMap<Request, BotConfig>();
const failed = new WeakSet<Request>();

// scrypt is slow on purpose; a credential that verified once is recognised by its
// SHA-256 afterwards. Safe because the secret is 256 random bits, not a password.
const verified = new Map<string, Buffer>();
const digest = (secret: string) => createHash('sha256').update(secret).digest();

/** The bot a request was authenticated as, if any. */
export const botCaller = (req: Request): BotConfig | undefined => authenticated.get(req);

export const isBotIdentity = (identity: string | undefined): boolean => identity?.startsWith(BOT_PREFIX) === true;

/** The configured bot behind an identity; undefined for people and for bots no longer in the config. */
export const botOf = (identity: string | undefined): BotConfig | undefined =>
    identity === undefined ? undefined : config().bots.get(identity);

function credentialOf(req: Request): string | undefined {
    const header = req.header('Authorization');
    return header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
}

/** Checks a `<key>.<secret>` credential against the config. */
export async function authenticateBot(credential: string): Promise<BotConfig | undefined> {
    const dot = credential.indexOf('.');
    if (dot <= 0 || credential.length > 200) return undefined;
    const bot = config().bots.get(BOT_PREFIX + credential.slice(0, dot));
    if (!bot) return undefined;
    const secret = credential.slice(dot + 1);
    const known = verified.get(bot.identity);
    if (known && timingSafeEqual(known, digest(secret))) return bot;
    if (!await verifySecret(secret, bot.secret)) return undefined;
    verified.set(bot.identity, digest(secret));
    return bot;
}

// Failed attempts only, per address: each costs an scrypt, and a secret can't be guessed anyway.
const failures = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skip: (req) => credentialOf(req) === undefined,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req) => !failed.has(req),
    keyGenerator: (req) => `bot:${ipKeyGenerator(req.ip ?? '')}`,
    standardHeaders: true,
    legacyHeaders: false,
});

async function check(req: Request, res: Response, next: NextFunction) {
    const credential = credentialOf(req);
    if (credential === undefined) return next();
    const bot = await authenticateBot(credential);
    if (!bot) {
        failed.add(req);
        res.status(401).json({ error: 'invalid_bot_credential' });
        return;
    }
    authenticated.set(req, bot);
    next();
}

/** Runs before the server password gate; a request with a bearer credential must carry a valid one. */
export const botAuth = [failures, check];
