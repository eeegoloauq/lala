const AVATAR_SIZE = 128;
const AVATAR_QUALITY = 0.72;
const MY_AVATAR_KEY = 'lala_my_avatar';
const CACHED_PREFIX = 'lala_av_';
const CACHED_NAME_PREFIX = 'lala_avn_';

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
    return localStorage.getItem(CACHED_PREFIX + identity)
        || (displayName ? localStorage.getItem(CACHED_NAME_PREFIX + displayName) : null)
        || null;
}

export function setCachedAvatar(identity: string, dataUrl: string): void {
    localStorage.setItem(CACHED_PREFIX + identity, dataUrl);
}

/** Also cache by display name so avatars survive identity rotation (server-assigned UUID changes each session) */
export function setCachedAvatarByName(name: string, dataUrl: string): void {
    localStorage.setItem(CACHED_NAME_PREFIX + name, dataUrl);
}

export function clearCachedAvatar(identity: string): void {
    localStorage.removeItem(CACHED_PREFIX + identity);
}

export function clearCachedAvatarByName(name: string): void {
    localStorage.removeItem(CACHED_NAME_PREFIX + name);
}
