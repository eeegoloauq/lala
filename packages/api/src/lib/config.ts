import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { parse } from 'yaml';
import type { ServerTheme, ThemeColor, ThemeId, ThemeSize } from '@lala/shared';
import { parseSecretHash, type SecretHash } from './secrets';
import { imageType } from './images';

/**
 * The optional server config (LALA_CONFIG, see config/lala.example.yaml): who is an admin
 * or a member, who may use what, and rooms that always exist. Without the file everyone
 * is a guest who may do everything, which is how an open server behaves.
 */

export type Role = 'admin' | 'member';
/** Who may use a right: room creators count as admins in their own room. */
export type Level = 'everyone' | 'members' | 'admins';
export type Right = 'join' | 'speak' | 'video' | 'screen' | 'chat';
export type Rights = Record<Right, Level>;

export interface ConfigRoom {
    id: string;
    name: string;
    rights: Rights;
    maxParticipants: number;
    password?: string;
}

export type BotRight = 'speak' | 'chat' | 'listen';

/** A bot account: a program that joins calls with a secret instead of a device ID. */
export interface BotConfig {
    /** The key under `bots:`; the bot's identity is `bot-<key>`. */
    key: string;
    identity: string;
    name: string;
    /** Image data URL read from a file next to the config. */
    avatar?: string;
    secret: SecretHash;
    /** IDs of the configured rooms the bot may join. */
    rooms: Set<string>;
    rights: Record<BotRight, boolean>;
    /** Who may add the bot to any room without a password; unset, only its own rooms. */
    invite?: Level;
    /**
     * Base64 X25519 public key. Not used yet: it is for password rooms, where the inviter's
     * client will encrypt the room key to it. Taken now so adding that needs no config change.
     */
    publicKey?: string;
}

/** A text chat from `chats:`. */
export interface ConfigChat {
    /** Part of every message's key in Redis: renaming a chat keeps its history while this stays. */
    id: string;
    name: string;
    topic?: string;
    /** The lowest rank that may post; everyone allowed on the server reads. */
    post: Level;
}

export interface ConfigRules {
    /** Markdown, shown like a chat that nobody writes in. */
    text: string;
    /** A hash of the text: an edit asks everyone to agree again. */
    version: string;
    /** Whether people must agree before they may do anything else. */
    required: boolean;
}

export interface Config {
    /** Shown at the top of the room list. */
    name: string;
    /** The clients' default theme. */
    theme?: ServerTheme;
    /** Keyed by public identity, the ID each person copies from their settings. */
    users: Map<string, { name: string; role: Role }>;
    guests: boolean;
    createRooms: Level | 'nobody';
    defaults: Rights;
    rooms: ConfigRoom[];
    /** Keyed by identity (`bot-<key>`). */
    bots: Map<string, BotConfig>;
    chats: ConfigChat[];
    rules?: ConfigRules;
    /** How long and how much text chat history Redis keeps; pinned messages stay. */
    chatHistory: { days?: number; messages: number };
    /** Bytes: all chat files together (the oldest go first), and one file when the config sets it. */
    chatFiles: { space: number; maxFile?: number };
}

const RIGHTS: Right[] = ['join', 'speak', 'video', 'screen', 'chat'];
const LEVELS: Level[] = ['everyone', 'members', 'admins'];
const ROLES: Role[] = ['admin', 'member'];
const IDENTITY = /^[0-9a-f]{36}$/;
const BOT_RIGHTS: BotRight[] = ['speak', 'chat', 'listen'];
const THEME_IDS: ThemeId[] = ['discord', 'winxp', 'dark', 'amoled', 'light'];
const THEME_COLORS: ThemeColor[] = ['accent', 'background', 'surface', 'sidebar', 'text', 'textSecondary', 'textMuted', 'border'];
const THEME_SIZES: ThemeSize[] = ['radius', 'radiusLarge', 'avatarRadius'];
const COLOR = /^#[0-9a-fA-F]{6}$/;
// Whole or half pixels up to 32; an avatar may also be rounded in percent (50% is a circle).
const SIZE = /^(?:[12]?[0-9]|3[0-2])(?:\.5)?px$/;
const PERCENT = /^(?:[0-4]?[0-9]|50)%$/;
const CHAT_ID = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const BYTES = /^(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)$/i;
const UNIT: Record<string, number> = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
const BOT_KEY = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
/** Same cap as the clients put on avatars. */
const MAX_AVATAR_LENGTH = 32 * 1024;
export const BOT_PREFIX = 'bot-';

const OPEN: Config = {
    name: 'Lala',
    users: new Map(),
    guests: true,
    createRooms: 'everyone',
    defaults: { join: 'everyone', speak: 'everyone', video: 'everyone', screen: 'everyone', chat: 'everyone' },
    rooms: [],
    bots: new Map(),
    chats: [],
    chatHistory: { messages: 10_000 },
    chatFiles: { space: 1024 ** 3 },
};

/** A chat's ID when the config gives none: its name in lowercase, other characters as dashes. */
export const chatIdFromName = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');

export const rulesVersion = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** Stable across restarts and config edits, so links to a configured room keep working. */
export const configRoomId = (name: string) =>
    createHash('sha256').update(`lala-config-room:${name.trim().toLowerCase()}`).digest('hex').slice(0, 16);

type Raw = Record<string, unknown>;

/**
 * Parses the config. `readFile` reads a file named in it (a bot avatar) from the config's
 * directory; tests pass their own.
 */
export function parseConfig(raw: unknown, readFile: (name: string) => Buffer = () => { throw new Error('no config directory'); }): Config {
    const fail = (path: string, problem: string): never => { throw new Error(`${path}: ${problem}`); };
    const object = (value: unknown, path: string): Raw =>
        value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Raw : fail(path, 'expected a mapping');
    const known = (value: Raw, path: string, keys: string[]) => {
        for (const key of Object.keys(value)) if (!keys.includes(key)) fail(path, `unknown key "${key}" (expected one of ${keys.join(', ')})`);
    };
    const oneOf = <T extends string>(value: unknown, path: string, allowed: readonly T[]): T =>
        allowed.includes(value as T) ? value as T : fail(path, `expected one of ${allowed.join(', ')}`);
    const rightsOf = (value: Raw, path: string, base: Rights): Rights =>
        Object.fromEntries(RIGHTS.map((r) => [r, value[r] === undefined ? base[r] : oneOf(value[r], `${path}.${r}`, LEVELS)])) as Rights;

    const top = object(raw ?? {}, 'config');
    known(top, 'config', ['name', 'theme', 'users', 'guests', 'defaults', 'rooms', 'bots', 'chats', 'rules', 'chatHistory', 'chatFiles']);
    const serverName = top.name === undefined ? OPEN.name : typeof top.name === 'string' ? top.name.trim() : '';
    if (!serverName || serverName.length > 50) fail('name', 'expected a name of 1 to 50 characters');

    let theme: ServerTheme | undefined;
    if (top.theme !== undefined) {
        const raw = object(top.theme, 'theme');
        known(raw, 'theme', ['base', 'colors', 'sizes']);
        const base = raw.base === undefined ? 'discord' : oneOf(raw.base, 'theme.base', THEME_IDS);
        const colorsRaw = object(raw.colors ?? {}, 'theme.colors');
        known(colorsRaw, 'theme.colors', THEME_COLORS);
        const colors: ServerTheme['colors'] = {};
        for (const [key, value] of Object.entries(colorsRaw)) {
            if (typeof value !== 'string' || !COLOR.test(value)) fail(`theme.colors.${key}`, 'expected a color like "#e05a6f" (in quotes)');
            colors[key as ThemeColor] = (value as string).toLowerCase();
        }
        const sizesRaw = object(raw.sizes ?? {}, 'theme.sizes');
        known(sizesRaw, 'theme.sizes', THEME_SIZES);
        const sizes: ServerTheme['sizes'] = {};
        for (const [key, value] of Object.entries(sizesRaw)) {
            const valid = typeof value === 'string' && (SIZE.test(value) || (key === 'avatarRadius' && PERCENT.test(value)));
            if (!valid) fail(`theme.sizes.${key}`, key === 'avatarRadius' ? 'expected 0px to 32px, or 0% to 50%' : 'expected 0px to 32px');
            sizes[key as ThemeSize] = value as string;
        }
        theme = { base, colors, sizes };
    }

    const users = new Map<string, { name: string; role: Role }>();
    for (const [name, value] of Object.entries(object(top.users ?? {}, 'users'))) {
        const path = `users.${name}`;
        const user = object(value, path);
        known(user, path, ['role', 'ids']);
        const role = oneOf(user.role, `${path}.role`, ROLES);
        if (!Array.isArray(user.ids) || user.ids.length === 0) fail(`${path}.ids`, 'expected a list of IDs from Settings');
        for (const id of user.ids as unknown[]) {
            if (typeof id !== 'string' || !IDENTITY.test(id)) fail(`${path}.ids`, `"${String(id)}" is not an ID from Settings`);
            if (users.has(id as string)) fail(`${path}.ids`, `${String(id)} is listed twice`);
            users.set(id as string, { name, role });
        }
    }

    if (top.guests !== undefined && typeof top.guests !== 'boolean') fail('guests', 'expected true or false');
    const defaultsRaw = object(top.defaults ?? {}, 'defaults');
    known(defaultsRaw, 'defaults', ['createRooms', ...RIGHTS]);
    const createRooms = defaultsRaw.createRooms === undefined
        ? OPEN.createRooms
        : oneOf(defaultsRaw.createRooms, 'defaults.createRooms', [...LEVELS, 'nobody'] as const);
    const defaults = rightsOf(defaultsRaw, 'defaults', OPEN.defaults);

    if (top.rooms != null && !Array.isArray(top.rooms)) fail('rooms', 'expected a list');
    const rooms: ConfigRoom[] = [];
    for (const [i, value] of ((top.rooms ?? []) as unknown[]).entries()) {
        const path = `rooms[${i}]`;
        const room = object(value, path);
        known(room, path, ['name', 'password', 'maxParticipants', ...RIGHTS]);
        const name = typeof room.name === 'string' ? room.name.trim() : '';
        if (!name || name.length > 50) fail(`${path}.name`, 'expected a name of 1 to 50 characters');
        const id = configRoomId(name);
        if (rooms.some((r) => r.id === id)) fail(`${path}.name`, `"${name}" is listed twice`);
        const max = room.maxParticipants ?? 0;
        if (!Number.isInteger(max) || (max as number) < 0 || (max as number) > 100) fail(`${path}.maxParticipants`, 'expected 0 to 100');
        if (typeof room.password === 'number') fail(`${path}.password`, `expected text; put it in quotes: password: "${room.password}"`);
        if (room.password !== undefined && (typeof room.password !== 'string' || !room.password)) fail(`${path}.password`, 'expected text');
        rooms.push({ id, name, rights: rightsOf(room, path, defaults), maxParticipants: max as number, password: room.password as string | undefined });
    }

    const bots = new Map<string, BotConfig>();
    for (const [key, value] of Object.entries(object(top.bots ?? {}, 'bots'))) {
        const path = `bots.${key}`;
        if (!BOT_KEY.test(key)) fail(path, 'expected a name of lowercase letters, digits and dashes, at most 32 characters');
        // DELETE /api/rooms/:id/bots/me is a bot leaving a room.
        if (key === 'me') fail(path, '"me" is reserved; pick another name');
        const bot = object(value, path);
        known(bot, path, ['name', 'avatar', 'secret', 'rooms', 'rights', 'invite', 'publicKey']);

        const name = bot.name === undefined ? key : typeof bot.name === 'string' ? bot.name.trim() : '';
        if (!name || name.length > 50) fail(`${path}.name`, 'expected a name of 1 to 50 characters');

        if (typeof bot.secret !== 'string') fail(`${path}.secret`, 'expected the hash that `node dist/bot-secret.js` prints');
        const secret = parseSecretHash(bot.secret as string)
            ?? fail(`${path}.secret`, 'not a hash from `node dist/bot-secret.js`; never put the secret itself here');

        let avatar: string | undefined;
        if (bot.avatar !== undefined) {
            const file = bot.avatar;
            if (typeof file !== 'string' || !file || basename(file) !== file || file.startsWith('.')) {
                fail(`${path}.avatar`, 'expected the name of an image file in the config directory');
            }
            let data: Buffer;
            try {
                data = readFile(file as string);
            } catch (err) {
                return fail(`${path}.avatar`, `can't read ${String(file)}: ${(err as Error).message}`);
            }
            const type = imageType(data);
            if (!type) fail(`${path}.avatar`, 'expected a JPEG, PNG or WebP image');
            avatar = `data:image/${type};base64,${data.toString('base64')}`;
            if (avatar.length > MAX_AVATAR_LENGTH) fail(`${path}.avatar`, 'expected an image under 24 KB, such as a 128x128 JPEG');
        }

        const invite = bot.invite === undefined ? undefined : oneOf(bot.invite, `${path}.invite`, LEVELS);
        // A bot people can add needs no rooms of its own.
        const roomList = bot.rooms ?? (invite ? [] : undefined);
        if (!Array.isArray(roomList) || (roomList.length === 0 && !invite)) {
            fail(`${path}.rooms`, 'expected a list of room names from rooms, or invite to let people add it');
        }
        const roomIds = new Set<string>();
        for (const roomName of roomList as unknown[]) {
            const room = typeof roomName === 'string' ? rooms.find((r) => r.id === configRoomId(roomName)) : undefined;
            if (!room) fail(`${path}.rooms`, `"${String(roomName)}" is not a room listed under rooms`);
            roomIds.add(room!.id);
        }

        if (bot.rights !== undefined && !Array.isArray(bot.rights)) fail(`${path}.rights`, `expected a list of ${BOT_RIGHTS.join(', ')}`);
        const listed = ((bot.rights ?? []) as unknown[]).map((r) => oneOf(r, `${path}.rights`, BOT_RIGHTS));
        const rights = Object.fromEntries(BOT_RIGHTS.map((r) => [r, listed.includes(r)])) as Record<BotRight, boolean>;

        let publicKey: string | undefined;
        if (bot.publicKey !== undefined) {
            const valid = typeof bot.publicKey === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(bot.publicKey);
            if (!valid) fail(`${path}.publicKey`, 'expected a base64 X25519 public key (32 bytes)');
            publicKey = bot.publicKey as string;
        }

        const identity = BOT_PREFIX + key;
        bots.set(identity, { key, identity, name, avatar, secret, rooms: roomIds, rights, invite, publicKey });
    }

    if (top.chats != null && !Array.isArray(top.chats)) fail('chats', 'expected a list');
    const chats: ConfigChat[] = [];
    for (const [i, value] of ((top.chats ?? []) as unknown[]).entries()) {
        const path = `chats[${i}]`;
        const chat = object(value, path);
        known(chat, path, ['id', 'name', 'topic', 'post']);
        const name = typeof chat.name === 'string' ? chat.name.trim() : '';
        if (!name || name.length > 50) fail(`${path}.name`, 'expected a name of 1 to 50 characters');
        const id = chat.id === undefined ? chatIdFromName(name) : chat.id;
        if (typeof id !== 'string' || !CHAT_ID.test(id)) {
            fail(`${path}.id`, chat.id === undefined
                ? 'the name has no letters or digits to make an ID from; add id: (lowercase letters, digits and dashes)'
                : 'expected lowercase letters, digits and dashes, at most 32 characters');
        }
        if (chats.some((c) => c.id === id)) fail(`${path}.id`, `"${String(id)}" is used twice; give one of them its own id:`);
        if (chat.topic !== undefined && (typeof chat.topic !== 'string' || chat.topic.trim().length > 200)) fail(`${path}.topic`, 'expected text of at most 200 characters');
        const topic = typeof chat.topic === 'string' && chat.topic.trim() ? chat.topic.trim() : undefined;
        const post = chat.post === undefined ? 'everyone' : oneOf(chat.post, `${path}.post`, LEVELS);
        chats.push({ id: id as string, name, topic, post });
    }

    let rules: ConfigRules | undefined;
    if (top.rules !== undefined) {
        const raw = object(top.rules, 'rules');
        known(raw, 'rules', ['text', 'required']);
        const text = typeof raw.text === 'string' ? raw.text.trim() : '';
        if (!text || text.length > 20_000) fail('rules.text', 'expected text of 1 to 20,000 characters');
        if (raw.required !== undefined && typeof raw.required !== 'boolean') fail('rules.required', 'expected true or false');
        rules = { text, version: rulesVersion(text), required: raw.required === true };
    }

    const historyRaw = object(top.chatHistory ?? {}, 'chatHistory');
    known(historyRaw, 'chatHistory', ['days', 'messages']);
    const whole = (value: unknown, path: string, min: number, max: number): number =>
        Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : fail(path, `expected a whole number from ${min} to ${max}`);
    // Without days nothing ages out; messages: 0 is no limit on the count either.
    const chatHistory = {
        days: historyRaw.days === undefined ? undefined : whole(historyRaw.days, 'chatHistory.days', 1, 36500),
        messages: historyRaw.messages === undefined ? OPEN.chatHistory.messages : whole(historyRaw.messages, 'chatHistory.messages', 0, 10_000_000),
    };

    const filesRaw = object(top.chatFiles ?? {}, 'chatFiles');
    known(filesRaw, 'chatFiles', ['space', 'maxFile']);
    const bytes = (value: unknown, path: string, fallback: number): number => {
        if (value === undefined) return fallback;
        const match = typeof value === 'string' ? BYTES.exec(value.trim()) : null;
        const result = match ? Math.floor(Number(match[1]) * UNIT[match[2].toUpperCase()]) : 0;
        return result >= 1024 * 1024 ? result : fail(path, 'expected a size such as 500MB or 2GB, at least 1MB');
    };
    const space = bytes(filesRaw.space, 'chatFiles.space', OPEN.chatFiles.space);
    const maxFile = filesRaw.maxFile === undefined ? undefined : bytes(filesRaw.maxFile, 'chatFiles.maxFile', space);

    return {
        name: serverName, theme, users, guests: (top.guests as boolean | undefined) ?? true, createRooms, defaults, rooms, bots,
        chats, rules, chatHistory, chatFiles: { space, maxFile },
    };
}

let loaded: Config = OPEN;

/** A mistake in the config file: the message names the file and the place, a stack adds nothing. */
export class ConfigError extends Error {}

/** Reads LALA_CONFIG once at startup; a file that is there but wrong stops the API. */
export function loadConfig(): void {
    const path = process.env.LALA_CONFIG;
    if (!path) return;
    let text: string;
    try {
        text = readFileSync(path, 'utf8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            console.log(`[config] ${path} not found, running as an open server`);
            return;
        }
        throw err;
    }
    try {
        // Only a plain file name reaches here (parseConfig checks), so it stays in the directory.
        loaded = parseConfig(parse(text), (name) => readFileSync(join(dirname(path), name)));
    } catch (err) {
        throw new ConfigError(`${path}: ${(err as Error).message}`);
    }
    console.log(`[config] ${loaded.users.size} IDs, ${loaded.rooms.length} rooms, ${loaded.chats.length} chats${loaded.rules ? ', rules' : ''}, ${loaded.bots.size} bots, guests ${loaded.guests ? 'allowed' : 'not allowed'}`);
}

export const config = (): Config => loaded;

/** Replaces the loaded config; for tests. */
export function setConfig(next: Config): void {
    loaded = next;
}
