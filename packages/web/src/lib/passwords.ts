import { safeJsonParse } from './utils';
import { secureGet, secureSet, secureRemove, secureKeys } from './secureStore';
import { stripTemplatePasswords } from './roomTemplates';

const PASS_POOL_KEY = 'lala_passwords';
const ROOM_PW_PREFIX = 'lala_room_pw_';
const ADMIN_PREFIX = 'lala_admin_';
const MAX_POOL = 20;

/** Read saved password pool. */
export function getPassPool(): string[] {
    return safeJsonParse<string[]>(secureGet(PASS_POOL_KEY), []);
}

/** Add a password to the front of the pool (deduped, max 20). */
export function saveToPool(pw: string): void {
    const pool = getPassPool().filter(p => p !== pw);
    secureSet(PASS_POOL_KEY, JSON.stringify([pw, ...pool].slice(0, MAX_POOL)));
}

/** Remove a single password by index. */
export function removeFromPool(idx: number): string[] {
    const next = getPassPool().filter((_, i) => i !== idx);
    secureSet(PASS_POOL_KEY, JSON.stringify(next));
    return next;
}

/** Clear entire password pool. */
export function clearPool(): void {
    secureRemove(PASS_POOL_KEY);
}

/** Save the working password for a specific room (for invite links). */
export function saveRoomPassword(roomId: string, pw: string): void {
    secureSet(ROOM_PW_PREFIX + roomId, pw);
}

/** Get the known password for a specific room. */
export function getRoomPassword(roomId: string): string | null {
    return secureGet(ROOM_PW_PREFIX + roomId);
}

/** Remove the saved password for a specific room. */
export function removeRoomPassword(roomId: string): void {
    secureRemove(ROOM_PW_PREFIX + roomId);
}

/** Save the admin secret for a room the user created. */
export function saveAdminSecret(roomId: string, secret: string): void {
    secureSet(ADMIN_PREFIX + roomId, secret);
}

/** Get the admin secret for a room, if this device created it. */
export function getAdminSecret(roomId: string): string | null {
    return secureGet(ADMIN_PREFIX + roomId);
}

/** Wipe every stored password: pool, per-room passwords, template passwords. */
export function clearAllPasswords(): void {
    clearPool();
    for (const key of secureKeys(ROOM_PW_PREFIX)) secureRemove(key);
    stripTemplatePasswords();
}
