import { scrypt, randomBytes, timingSafeEqual, type ScryptOptions } from 'crypto';

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
