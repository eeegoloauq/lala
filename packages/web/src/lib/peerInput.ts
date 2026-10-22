/**
 * Everything another participant sends ends up on screen or in memory here, so it is
 * checked in one place: shape, type and size, before anything uses it.
 */

/** Avatars are 128x128 JPEGs (see avatarUtils.compressAvatar); this leaves a wide margin. */
export const MAX_AVATAR_LENGTH = 32 * 1024;
const AVATAR = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** A peer's avatar attribute: an image data URL, or null for none or anything else. */
export function parseAvatar(value: string | undefined): string | null {
    return value && value.length <= MAX_AVATAR_LENGTH && AVATAR.test(value) ? value : null;
}
