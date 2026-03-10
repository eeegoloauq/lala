import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

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
    const hash = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const colon = stored.indexOf(':');
    if (colon === -1) return false;
    const salt = stored.slice(0, colon);
    const hash = stored.slice(colon + 1);
    const hashBuffer = Buffer.from(hash, 'hex');
    if (hashBuffer.length !== 64) return false;
    const derived = (await scryptAsync(password, salt, 64)) as Buffer;
    return timingSafeEqual(hashBuffer, derived);
}
