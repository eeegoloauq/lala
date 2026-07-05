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
const CACHED_PREFIX = 'lala_av_';
const CACHED_NAME_PREFIX = 'lala_avn_';
// Cache is bounded: avatars are up to ~50 KB each and used to accumulate for
// every participant ever seen, eventually exhausting the localStorage quota.
const MAX_CACHED_AVATARS = 60;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, same as volume cache

interface CachedEntry { d: string; t: number }

function isCacheKey(key: string): boolean {
    return key.startsWith(CACHED_PREFIX) || key.startsWith(CACHED_NAME_PREFIX);
}

/** Read a cache entry; supports the legacy raw-dataURL format (treated as stale). */
function readEntry(key: string): CachedEntry | null {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    if (raw.startsWith('data:')) return { d: raw, t: 0 };
    try {
        const parsed = JSON.parse(raw) as CachedEntry;
        return typeof parsed?.d === 'string' ? parsed : null;
    } catch { return null; }
}

function cacheKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (isCacheKey(key)) keys.push(key);
    }
    return keys;
}

/** Drop expired entries, then oldest-first down to the cap. */
function evictCache(): void {
    const cutoff = Date.now() - CACHE_TTL_MS;
    const entries = cacheKeys().map(key => ({ key, t: readEntry(key)?.t ?? 0 }));
    const alive: typeof entries = [];
    for (const e of entries) {
        if (e.t <= cutoff) localStorage.removeItem(e.key);
        else alive.push(e);
    }
    if (alive.length > MAX_CACHED_AVATARS) {
        alive.sort((a, b) => a.t - b.t);
        for (const e of alive.slice(0, alive.length - MAX_CACHED_AVATARS)) {
            localStorage.removeItem(e.key);
        }
    }
}

let sweptThisSession = false;

function writeEntry(key: string, dataUrl: string): void {
    const value = JSON.stringify({ d: dataUrl, t: Date.now() });
    try {
        localStorage.setItem(key, value);
    } catch {
        // Quota exceeded — evict and retry once
        try {
            evictCache();
            localStorage.setItem(key, value);
        } catch { /* still full — skip caching */ }
    }
    // Full eviction parses every entry, so only run it when needed:
    // once per session (TTL sweep) or when the key count exceeds the cap.
    if (!sweptThisSession || cacheKeys().length > MAX_CACHED_AVATARS) {
        sweptThisSession = true;
        evictCache();
    }
}

/** Compress and center-crop an image file to a 48×48 JPEG data URL. */
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

/** Look up cached avatar by identity UUID, with optional display name fallback for cross-session hits */
export function getCachedAvatar(identity: string, displayName?: string): string | null {
    return readEntry(CACHED_PREFIX + identity)?.d
        ?? (displayName ? readEntry(CACHED_NAME_PREFIX + displayName)?.d : null)
        ?? null;
}

export function setCachedAvatar(identity: string, dataUrl: string): void {
    writeEntry(CACHED_PREFIX + identity, dataUrl);
}

/** Also cache by display name so avatars survive identity rotation (server-assigned UUID changes each session) */
export function setCachedAvatarByName(name: string, dataUrl: string): void {
    writeEntry(CACHED_NAME_PREFIX + name, dataUrl);
}

export function clearCachedAvatar(identity: string): void {
    localStorage.removeItem(CACHED_PREFIX + identity);
}

export function clearCachedAvatarByName(name: string): void {
    localStorage.removeItem(CACHED_NAME_PREFIX + name);
}
