import { scrypt, randomBytes, timingSafeEqual, ScryptOptions } from 'crypto';

// Explicit scrypt cost params — these match Node's current defaults (N=16384, r=8, p=1),
// pinned here so a future Node upgrade that changes its defaults can't silently alter the
// cost of newly-hashed passwords or (worse) break verification of already-stored hashes.
const SCRYPT_PARAMS: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// util.promisify(scrypt) resolves to the 3-arg overload (no options), so we need our
// own wrapper to pass SCRYPT_PARAMS through to the underlying callback API.
function scryptAsync(password: string, salt: string, keylen: number, options: ScryptOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(password, salt, keylen, options, (err, derivedKey) => {
            if (err) reject(err);
            else resolve(derivedKey);
        });
    });
}

/** Stored in LiveKit room metadata as JSON */
export interface RoomMeta {
    displayName: string;
    passwordHash?: string;      // "salt:hash", undefined = no password
    maxParticipants: number;    // 0 = unlimited
    createdAt: number;
    creatorIdentity?: string;   // informational only
    adminSecret?: string;       // 32 hex chars — authorizes kick/ban/mute and creator password bypass
    bannedIdentities?: string[]; // permanently banned from this room
}

/** Generate a short opaque room ID (16 hex chars = 64 bits entropy) */
export function generateRoomId(): string {
    return randomBytes(8).toString('hex');
}

export function parseRoomMeta(metadata: string | undefined): RoomMeta | null {
    if (!metadata) return null;
    try {
        return JSON.parse(metadata) as RoomMeta;
    } catch {
        return null;
    }
}

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const hash = await scryptAsync(password, salt, 64, SCRYPT_PARAMS);
    return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const colon = stored.indexOf(':');
    if (colon === -1) return false;
    const salt = stored.slice(0, colon);
    const hash = stored.slice(colon + 1);
    const hashBuffer = Buffer.from(hash, 'hex');
    if (hashBuffer.length !== 64) return false;
    const derived = await scryptAsync(password, salt, 64, SCRYPT_PARAMS);
    return timingSafeEqual(hashBuffer, derived);
}
