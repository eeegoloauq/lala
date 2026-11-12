import type { BotCommand, BotProfile } from '@lala/shared';
import type { BotConfig } from './config';
import { getRoomService, isNotFound } from './livekit';
import { redis } from './redis';
import { sanitizeDisplayText } from './sanitize';

/**
 * What a bot shows about itself besides its name and avatar: a status line and the chat
 * commands it answers to. The bot sets them through the API; the server checks them and
 * puts them on the participant, where the bot itself can't change them.
 */

const MAX_STATUS = 100;
const MAX_COMMANDS = 20;
const MAX_DESCRIPTION = 80;
const COMMAND = /^![a-z0-9][a-z0-9_-]{0,23}$/;

const profileKey = (identity: string) => `lala:bot-profile:${identity}`;
const PROFILE_PREFIX = 'lala:bot-profile:';

const EMPTY: BotProfile = { status: '', commands: [] };

/** Validates a profile update; null when anything in it is malformed. */
export function parseProfileUpdate(body: unknown): Partial<BotProfile> | null {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
    const { status, commands, ...rest } = body as Record<string, unknown>;
    if (Object.keys(rest).length > 0) return null;
    const update: Partial<BotProfile> = {};
    if (status !== undefined) {
        if (typeof status !== 'string' || status.length > MAX_STATUS * 2) return null;
        update.status = sanitizeDisplayText(status, MAX_STATUS);
    }
    if (commands !== undefined) {
        if (!Array.isArray(commands) || commands.length > MAX_COMMANDS) return null;
        const parsed: BotCommand[] = [];
        for (const item of commands as unknown[]) {
            if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
            const { name, description, ...extra } = item as Record<string, unknown>;
            if (Object.keys(extra).length > 0 || typeof name !== 'string' || !COMMAND.test(name)) return null;
            if (description !== undefined && (typeof description !== 'string' || description.length > MAX_DESCRIPTION * 2)) return null;
            if (parsed.some((c) => c.name === name)) return null;
            parsed.push({ name, description: typeof description === 'string' ? sanitizeDisplayText(description, MAX_DESCRIPTION) : '' });
        }
        update.commands = parsed;
    }
    return update;
}

export async function getProfile(identity: string): Promise<BotProfile> {
    const raw = await redis().get(profileKey(identity));
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
}

export async function updateProfile(identity: string, update: Partial<BotProfile>): Promise<BotProfile> {
    const profile = { ...await getProfile(identity), ...update };
    await redis().set(profileKey(identity), JSON.stringify(profile));
    return profile;
}

/** Profiles of bots that the config no longer lists. */
export async function dropProfilesExcept(identities: Set<string>): Promise<void> {
    const keys: string[] = [];
    for await (const batch of redis().scanStream({ match: `${PROFILE_PREFIX}*`, count: 100 })) keys.push(...batch as string[]);
    const stale = keys.filter((k) => !identities.has(k.slice(PROFILE_PREFIX.length)));
    if (stale.length > 0) await redis().del(...stale);
}

/** The attributes a bot participant carries; empty values clear them. */
export function botAttributes(bot: BotConfig, profile: BotProfile): Record<string, string> {
    return {
        // Clients take avatars from the room list now; this clears what older servers set.
        'lala.avatar': '',
        'lala.bot-status': profile.status,
        'lala.bot-commands': profile.commands.length > 0 ? JSON.stringify(profile.commands) : '',
    };
}

/** Puts the bot's attributes on it in every room it is in now. */
export async function publishProfile(bot: BotConfig, profile: BotProfile, roomIds: Iterable<string> = bot.rooms): Promise<void> {
    const attributes = botAttributes(bot, profile);
    await Promise.all([...roomIds].map((roomId) =>
        getRoomService().updateParticipant(roomId, bot.identity, { attributes }).catch((err) => {
            if (!isNotFound(err)) throw err;
        })));
}
