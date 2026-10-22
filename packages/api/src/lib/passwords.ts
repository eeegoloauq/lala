import { createHash, hkdf, pbkdf2, scrypt, randomBytes, timingSafeEqual, type ScryptOptions } from 'crypto';
import { promisify } from 'util';

// Pinned so a Node upgrade that changes its defaults cannot break stored verifiers.
const SCRYPT_PARAMS: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

function scryptAsync(secret: string, salt: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(secret, salt, KEY_LENGTH, SCRYPT_PARAMS, (err, key) => (err ? reject(err) : resolve(key)));
    });
}

/**
 * The client sends a key derived from the room password, never the password or the
 * encryption key. Hashing it again means a copy of Redis is not a working credential.
 */
export async function hashRoomKey(key: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${(await scryptAsync(key, salt)).toString('hex')}`;
}

export async function verifyRoomKey(key: string, stored: string): Promise<boolean> {
    const [salt, hash] = stored.split(':');
    const expected = Buffer.from(hash ?? '', 'hex');
    if (!salt || expected.length !== KEY_LENGTH) return false;
    return timingSafeEqual(expected, await scryptAsync(key, salt));
}

// Must match packages/web/src/lib/roomKeys.ts. Clients derive the key themselves; the
// server does it only for rooms whose password sits in the config.
const ITERATIONS = 200_000;

export async function deriveRoomAuthKey(password: string, salt: string): Promise<string> {
    const master = await promisify(pbkdf2)(password, salt, ITERATIONS, 32, 'sha256');
    const auth = await promisify(hkdf)('sha256', master, Buffer.alloc(0), 'lala room auth', 32);
    return Buffer.from(auth).toString('base64');
}

/** A configured room keeps its salt across restarts, so saved passwords and E2EE keys stay valid. */
export const configRoomSalt = (roomId: string) =>
    createHash('sha256').update(`lala-config-salt:${roomId}`).digest('base64').slice(0, 24);
