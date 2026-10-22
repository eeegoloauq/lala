/**
 * A room password turns into two independent keys: one the server checks, one that
 * encrypts media. The server never sees the password or the encryption key, so it
 * cannot decrypt a call; it could only guess the password at PBKDF2 cost per try.
 */

// Slows down guessing for anyone holding the server's copy; 200k iterations keep trying
// a full saved-password pool (20) to a few seconds on a phone.
const ITERATIONS = 200_000;

const encoder = new TextEncoder();
const toBase64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

export function newRoomSalt(): string {
    return toBase64(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

export interface RoomKeys {
    /** Sent to the server as proof of the password. */
    authKey: string;
    /** Media encryption key, stays on the client. */
    e2eeKey: ArrayBuffer;
}

export async function deriveRoomKeys(password: string, salt: string): Promise<RoomKeys> {
    const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const master = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: ITERATIONS }, passwordKey, 256);
    const masterKey = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
    const expand = (info: string) => crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: encoder.encode(info) }, masterKey, 256);
    const [auth, e2ee] = await Promise.all([expand('lala room auth'), expand('lala room e2ee')]);
    return { authKey: toBase64(auth), e2eeKey: e2ee };
}
