import { IS_DEMO } from './env';

/** The demo's pictures, registered by its in-page server; the demo has no server to serve avatars. */
let demoAvatars: ((identity: string) => string | undefined) | undefined;
export const setDemoAvatars = (lookup: typeof demoAvatars) => { demoAvatars = lookup; };
/**
 * Palette for deterministic per-identity avatar accent colors. Chosen to stay
 * legible as text/icon backgrounds on both dark and light theme surfaces.
 * Plain hex today (dropped straight into inline styles); a future globals.css
 * pass could expose these as --avatar-color-0..N vars for theme overrides.
 */
export const AVATAR_COLOR_PALETTE = [
    '#e05a6f', // rose
    '#2563eb', // blue
    '#0891b2', // cyan
    '#16a34a', // green
    '#d97706', // amber
    '#7c3aed', // violet
    '#0d9488', // teal
    '#db2777', // pink
    '#65a30d', // lime
    '#0284c7', // sky
] as const;

/**
 * Deterministic avatar color for a given identity/name. Uses FNV-1a for a
 * better-distributed hash than a naive sum, so short/similar identities don't
 * all collide on the same palette entry.
 */
export function avatarColorForIdentity(identity: string): string {
    let hash = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < identity.length; i++) {
        hash ^= identity.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193); // FNV prime
    }
    return AVATAR_COLOR_PALETTE[Math.abs(hash) % AVATAR_COLOR_PALETTE.length];
}

const AVATAR_SIZE = 128;
const AVATAR_QUALITY = 0.72;
const MY_AVATAR_KEY = 'lala_my_avatar';
/** Compress and center-crop an image file to a 128×128 JPEG data URL. */
export async function compressAvatar(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const canvas = document.createElement('canvas');
            canvas.width = AVATAR_SIZE;
            canvas.height = AVATAR_SIZE;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('No 2d context')); return; }
            const size = Math.min(img.naturalWidth, img.naturalHeight);
            const sx = (img.naturalWidth - size) / 2;
            const sy = (img.naturalHeight - size) / 2;
            ctx.drawImage(img, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
            resolve(canvas.toDataURL('image/jpeg', AVATAR_QUALITY));
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = url;
    });
}

export function getMyAvatar(): string | null {
    return localStorage.getItem(MY_AVATAR_KEY);
}

export function saveMyAvatar(dataUrl: string): void {
    localStorage.setItem(MY_AVATAR_KEY, dataUrl);
}

export function clearMyAvatar(): void {
    localStorage.removeItem(MY_AVATAR_KEY);
}

const VERSION = /^[0-9a-f]{16}$/;

/**
 * Where the server serves someone's avatar. The version is a hash of the image, so the
 * browser keeps each URL for good and a new picture is a new URL.
 */
export function avatarUrl(identity: string, version: string | undefined): string | undefined {
    if (IS_DEMO) return demoAvatars?.(identity);
    return version && VERSION.test(version) ? `/api/avatars/${encodeURIComponent(identity)}?v=${version}` : undefined;
}

/** Avatars used to be cached here as `lala_av_<identity>`; the browser's HTTP cache does that now. */
export function dropLegacyAvatarCache(): void {
    try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith('lala_av_')) keys.push(key);
        }
        for (const key of keys) localStorage.removeItem(key);
    } catch { /* storage unavailable: nothing to drop */ }
}
