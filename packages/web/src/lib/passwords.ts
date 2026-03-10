import { safeJsonParse } from './utils';

const PASS_POOL_KEY = 'lala_passwords';
const MAX_POOL = 20;

/** Read saved password pool from localStorage. */
export function getPassPool(): string[] {
    return safeJsonParse<string[]>(localStorage.getItem(PASS_POOL_KEY), []);
}

/** Add a password to the front of the pool (deduped, max 20). */
export function saveToPool(pw: string): void {
    const pool = getPassPool().filter(p => p !== pw);
    localStorage.setItem(PASS_POOL_KEY, JSON.stringify([pw, ...pool].slice(0, MAX_POOL)));
}

/** Remove a single password by index. */
export function removeFromPool(idx: number): string[] {
    const next = getPassPool().filter((_, i) => i !== idx);
    localStorage.setItem(PASS_POOL_KEY, JSON.stringify(next));
    return next;
}

/** Clear entire password pool. */
export function clearPool(): void {
    localStorage.removeItem(PASS_POOL_KEY);
}

/** Save the working password for a specific room (for invite links). */
export function saveRoomPassword(roomId: string, pw: string): void {
    localStorage.setItem(`lala_room_pw_${roomId}`, pw);
}

/** Get the known password for a specific room. */
export function getRoomPassword(roomId: string): string | null {
    return localStorage.getItem(`lala_room_pw_${roomId}`);
}

/** Remove the saved password for a specific room. */
export function removeRoomPassword(roomId: string): void {
    localStorage.removeItem(`lala_room_pw_${roomId}`);
}
