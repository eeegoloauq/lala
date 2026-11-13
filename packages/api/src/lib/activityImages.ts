import { redis } from './redis';
import { avatarVersion } from './avatars';
import { imageType, type ImageType } from './images';

/**
 * Covers and game icons for activities, uploaded by the person's own app so that viewers load
 * them from this server and never from Spotify, Steam or a player's private server. Stored by
 * content hash, so the same album from two people is one entry. An upload that no heartbeat
 * names goes after 10 minutes, which bounds what a flood of uploads can hold in Redis; one in
 * use lives an hour past the last heartbeat that named it.
 */

/** The desktop app sends a 128x128 JPEG or WebP of a few KB. */
export const MAX_ACTIVITY_IMAGE_BYTES = 48 * 1024;
const UNCLAIMED_TTL_S = 10 * 60;
const IN_USE_TTL_S = 60 * 60;
const key = (version: string) => `lala:activity-image:${version}`;

export async function putActivityImage(data: Buffer): Promise<string | undefined> {
    const type = imageType(data);
    if (!type || data.length > MAX_ACTIVITY_IMAGE_BYTES) return undefined;
    const version = avatarVersion(data);
    await redis().multi().hset(key(version), { type, data }).expire(key(version), UNCLAIMED_TTL_S, 'NX').exec(); // a known image keeps its time
    return version;
}

export async function getActivityImage(version: string): Promise<{ type: ImageType; data: Buffer } | undefined> {
    const stored = await redis().hgetallBuffer(key(version));
    const type = stored.type?.toString();
    if (!stored.data || (type !== 'jpeg' && type !== 'png' && type !== 'webp')) return undefined;
    return { type, data: stored.data };
}

/** Keeps an image that is still shown; false when it is gone and should be uploaded again. */
export async function touchActivityImage(version: string): Promise<boolean> {
    return (await redis().expire(key(version), IN_USE_TTL_S)) === 1;
}
