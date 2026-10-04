import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { createHmac, timingSafeEqual } from 'crypto';
import type { AccessStatus } from '@lala/shared';

/**
 * Optional instance-wide password (LALA_ACCESS_PASSWORD). LiveKit only admits
 * clients with a token from this API, so gating the API gates rooms and media.
 *
 * The session is a stateless cookie: `<expiry>.<hmac(expiry)>`. The HMAC key mixes
 * the LiveKit API secret with the password, so changing the password signs everyone
 * out, and a stolen cookie can't be used to brute-force the password offline.
 */
const COOKIE = 'lala_access';
const MAX_AGE_S = 30 * 24 * 60 * 60;
const RENEW_AFTER_S = 24 * 60 * 60;
const MIN_PASSWORD_LENGTH = 12;

const password = process.env.LALA_ACCESS_PASSWORD ?? '';
const required = password !== '';

if (required && password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`LALA_ACCESS_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
}

// The secret is what keeps a leaked cookie from being an offline guessing oracle for
// the password: the HMACs below are fast on purpose and safe only because of it.
if (required && !process.env.LIVEKIT_API_SECRET) {
    throw new Error('LALA_ACCESS_PASSWORD requires LIVEKIT_API_SECRET');
}

const signingKey = createHmac('sha256', process.env.LIVEKIT_API_SECRET ?? '')
    .update(`lala-access\0${password}`)
    .digest();

const sign = (expiry: number) => createHmac('sha256', signingKey).update(String(expiry)).digest('base64url');

function safeEqual(a: Buffer, b: Buffer): boolean {
    return a.length === b.length && timingSafeEqual(a, b);
}

/** Expiry (unix seconds) of a valid session cookie, or null. */
function validCookieExpiry(req: Request): number | null {
    const value = req.headers.cookie?.match(/(?:^|;\s*)lala_access=([^;]+)/)?.[1];
    const [expiry, sig] = value?.split('.') ?? [];
    if (!expiry || !sig || !(Number(expiry) > Date.now() / 1000)) return null;
    return safeEqual(Buffer.from(sig), Buffer.from(sign(Number(expiry)))) ? Number(expiry) : null;
}

function setCookie(res: Response) {
    const expiry = Math.floor(Date.now() / 1000) + MAX_AGE_S;
    // Secure is unconditional: Lala needs a secure context for the microphone anyway,
    // and browsers accept Secure cookies on http://localhost.
    res.setHeader('Set-Cookie',
        `${COOKIE}=${expiry}.${sign(expiry)}; Path=/api; Max-Age=${MAX_AGE_S}; HttpOnly; Secure; SameSite=Strict`);
}

/** Checks the session and slides its expiry at most once a day, so active users stay signed in. */
function checkSession(req: Request, res: Response): boolean {
    const expiry = validCookieExpiry(req);
    if (expiry === null) return false;
    if (expiry - Date.now() / 1000 < MAX_AGE_S - RENEW_AFTER_S) setCookie(res);
    return true;
}

export function requireAccess(req: Request, res: Response, next: NextFunction) {
    if (!required || checkSession(req, res)) return next();
    res.status(401).json({ error: 'access_required' });
}

export function createAccessRouter(): Router {
    const router = Router();

    // GET /api/access — whether this client still needs to enter the instance password.
    router.get('/', (req, res) => {
        const granted = !required || checkSession(req, res);
        const status: AccessStatus = { required, granted };
        res.json(status);
    });

    // Failed attempts only: ~40 guesses per IP per hour on top of the length minimum.
    router.post('/', rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        skipSuccessfulRequests: true,
        standardHeaders: true,
        legacyHeaders: false,
    }), (req, res) => {
        const provided = req.body?.password;
        if (typeof provided !== 'string') {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        // Compare HMACs so the comparison is constant-time regardless of length.
        const digest = (s: string) => createHmac('sha256', signingKey).update(s).digest();
        if (!required || !safeEqual(digest(provided), digest(password))) {
            res.status(401).json({ error: 'wrong_password' });
            return;
        }
        setCookie(res);
        res.json({ ok: true });
    });

    return router;
}
