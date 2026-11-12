import { createHash } from 'node:crypto';
import { redis } from './redis';
import { botOf, isBotIdentity } from './bots';
import { imageType, type ImageType } from './images';

/**
 * People's avatars, in Redis by public identity. Clients load them from
 * GET /api/avatars/<identity>?v=<version>; the version is a hash of the image, so a URL
 * never changes its content and browsers cache it for good. Lists carry only the version.
 * A bot's avatar comes from the config and is served the same way.
 */

export interface Avatar {
    type: ImageType;
    data: Buffer;
    version: string;
}

/** Same cap as a bot avatar in the config; the clients send a 128x128 JPEG of a few KB. */
export const MAX_AVATAR_BYTES = 24 * 1024;

/** Unused avatars go after this; the client uploads its copy again when it finds none. */
const AVATAR_TTL_S = 90 * 24 * 60 * 60;

const key = (identity: string) => `lala:avatar:${identity}`;

export const avatarVersion = (data: Buffer) => createHash('sha256').update(data).digest('hex').slice(0, 16);

/** A bot's avatar from its config entry (an image data URL). */
function botAvatar(identity: string): Avatar | undefined {
    const url = botOf(identity)?.avatar;
    const match = url && /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(url);
    if (!match) return undefined;
    const data = Buffer.from(match[2], 'base64');
    return { type: match[1] as ImageType, data, version: avatarVersion(data) };
}

/** The version of a bot's avatar, for the lists that show bots before they join. */
export const botAvatarVersion = (identity: string) => botAvatar(identity)?.version;

export async function getAvatar(identity: string): Promise<Avatar | undefined> {
    if (isBotIdentity(identity)) return botAvatar(identity);
    const stored = await redis().hgetallBuffer(key(identity));
    const type = stored.type?.toString();
    if (!stored.data || (type !== 'jpeg' && type !== 'png' && type !== 'webp')) return undefined;
    return { type, data: stored.data, version: stored.version.toString() };
}

/** Stores the image after checking it is one; returns its version, or undefined if it isn't. */
export async function putAvatar(identity: string, data: Buffer): Promise<string | undefined> {
    const type = imageType(data);
    if (!type || data.length > MAX_AVATAR_BYTES) return undefined;
    const version = avatarVersion(data);
    await redis().multi()
        .del(key(identity))
        .hset(key(identity), { type, data, version })
        .expire(key(identity), AVATAR_TTL_S)
        .exec();
    return version;
}

export async function deleteAvatar(identity: string): Promise<void> {
    await redis().del(key(identity));
}

/** Keeps the avatar of someone who is still around; returns its version. */
export async function touchAvatar(identity: string): Promise<string | undefined> {
    if (isBotIdentity(identity)) return botAvatar(identity)?.version;
    const [[, version]] = (await redis().multi()
        .hget(key(identity), 'version')
        .expire(key(identity), AVATAR_TTL_S)
        .exec()) as [[Error | null, string | null]];
    return version ?? undefined;
}

/** Versions by identity, for the people in a list; those without an avatar are left out. */
export async function avatarVersions(identities: string[]): Promise<Map<string, string>> {
    const versions = new Map<string, string>();
    const people = identities.filter((id) => !isBotIdentity(id));
    for (const id of identities) {
        const version = isBotIdentity(id) ? botAvatar(id)?.version : undefined;
        if (version) versions.set(id, version);
    }
    if (people.length === 0) return versions;
    const pipeline = redis().pipeline();
    for (const id of people) pipeline.hget(key(id), 'version');
    const results = (await pipeline.exec()) ?? [];
    people.forEach((id, i) => {
        const version = results[i]?.[1];
        if (typeof version === 'string') versions.set(id, version);
    });
    return versions;
}
