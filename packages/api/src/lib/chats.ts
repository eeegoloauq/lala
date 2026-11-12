import type { ChatAttachment, ChatMessage, ChatReactions, ChatReplyPreview } from '@lala/shared';
import { config } from './config';
import { redis } from './redis';
import { attachmentOf, fileMetas } from './chatFiles';

/**
 * Text chat history: a Redis stream per chat, whose entry IDs (`<ms>-<seq>`) are the
 * message IDs and the paging cursor. The stream is trimmed by count on every message and
 * by age in the sweep. Reactions are kept beside it by message ID; pinned messages are
 * copied out of it, so they outlive its trimming. Each person's latest mentions are a
 * list, so a client can show them without loading every chat.
 */

const streamKey = (chat: string) => `lala:chat:${chat}`;
const reactionsKey = (chat: string) => `lala:chat-reactions:${chat}`; // message id -> JSON [[emoji, [identity…]]…]
const pinsKey = (chat: string) => `lala:chat-pins:${chat}`;           // message id -> JSON { at, message }
const mentionsKey = (identity: string) => `lala:chat-mentions:${identity}`; // list of "<chat> <id>", newest last

export const MAX_TEXT = 4000;
export const MAX_ATTACHMENTS = 10;
export const MAX_REACTIONS = 20;
export const MAX_PINS = 50;
export const MAX_MENTIONS = 50;
export const PREVIEW_LENGTH = 200;

export const MESSAGE_ID = /^\d{1,16}-\d{1,10}$/;
/** One emoji, possibly with modifiers and joiners: what a reaction may be. */
export const EMOJI = /^(?:[#*0-9]\ufe0f?\u20e3|\p{Extended_Pictographic}|\p{Regional_Indicator})(?:[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}]|\u200d|\ufe0f|\u20e3)*$/u;
const MENTION = /<@([0-9a-f]{36}|bot-[a-z0-9-]{1,40})>/g;

/** A message as stored: everything but what the stream ID and the other keys say. */
export interface StoredMessage {
    identity: string;
    name: string;
    text: string;
    attachments?: Array<Omit<ChatAttachment, 'url'>>;
    reply?: ChatReplyPreview;
}

interface Pin { at: number; message: StoredMessage }

const timeOf = (id: string) => Number(id.split('-')[0]);

export const mentionedIn = (text: string) => [...new Set([...text.matchAll(MENTION)].map((m) => m[1]))];

/** The first characters of a message, as a reply shows it; cut by code points. */
export const previewOf = (id: string, m: StoredMessage): ChatReplyPreview =>
    ({ id, identity: m.identity, name: m.name, text: Array.from(m.text).slice(0, PREVIEW_LENGTH).join('') });

const parse = <T>(raw: string | null | undefined): T | undefined => {
    if (!raw) return undefined;
    try { return JSON.parse(raw) as T; } catch { return undefined; }
};

/** Stream entries come back as [id, [field, value, …]]; the message is field `m`. */
type Entry = [string, string[]];
const fromEntry = ([id, fields]: Entry): [string, StoredMessage] | undefined => {
    const at = fields.indexOf('m');
    const message = at >= 0 ? parse<StoredMessage>(fields[at + 1]) : undefined;
    return message ? [id, message] : undefined;
};

const reactionsOf = (raw: string | null | undefined): ChatReactions | undefined => {
    const list = parse<Array<[string, string[]]>>(raw);
    return list?.length ? Object.fromEntries(list) : undefined;
};

/** Messages as the client gets them: reactions, pins and whether each file is still there. */
async function present(chat: string, entries: Array<[string, StoredMessage]>, pinnedIds?: Set<string>): Promise<ChatMessage[]> {
    if (entries.length === 0) return [];
    const ids = entries.map(([id]) => id);
    const [reactions, pins, files] = await Promise.all([
        redis().hmget(reactionsKey(chat), ...ids),
        pinnedIds ? Promise.resolve(pinnedIds) : redis().hkeys(pinsKey(chat)).then((keys) => new Set(keys)),
        fileMetas(entries.flatMap(([, m]) => m.attachments?.map((a) => a.id) ?? [])),
    ]);
    return entries.map(([id, m], i) => ({
        id,
        channel: chat,
        identity: m.identity,
        name: m.name,
        text: m.text,
        at: timeOf(id),
        attachments: m.attachments?.map((a) => attachmentOf(a.id, files.get(a.id), a)),
        reactions: reactionsOf(reactions[i]),
        reply: m.reply,
        pinned: pins.has(id) || undefined,
    }));
}

/** Up to `limit` messages before `before` (the newest without it), oldest first. */
export async function listMessages(chat: string, before: string | undefined, limit: number): Promise<{ messages: ChatMessage[]; more: boolean }> {
    const raw = await redis().xrevrange(streamKey(chat), before ? `(${before}` : '+', '-', 'COUNT', limit + 1) as Entry[];
    const entries = raw.slice(0, limit).map(fromEntry).filter((e) => e !== undefined).reverse();
    return { messages: await present(chat, entries), more: raw.length > limit };
}

/** A message from the stream, or its pinned copy once the stream has let it go. */
export async function findMessage(chat: string, id: string): Promise<StoredMessage | undefined> {
    const [entry] = await redis().xrange(streamKey(chat), id, id) as Entry[];
    if (entry) return fromEntry(entry)?.[1];
    return parse<Pin>(await redis().hget(pinsKey(chat), id))?.message;
}

export const messageExists = async (chat: string, id: string) => (await findMessage(chat, id)) !== undefined;

export async function presentOne(chat: string, id: string, message: StoredMessage): Promise<ChatMessage> {
    return (await present(chat, [[id, message]]))[0];
}

/** The newest message ID of each chat. */
export async function lastMessageIds(chats: string[]): Promise<Map<string, string>> {
    const pipeline = redis().pipeline();
    for (const chat of chats) pipeline.xrevrange(streamKey(chat), '+', '-', 'COUNT', 1);
    const results = (await pipeline.exec()) ?? [];
    const last = new Map<string, string>();
    chats.forEach((chat, i) => {
        const id = (results[i]?.[1] as Entry[] | undefined)?.[0]?.[0];
        if (id) last.set(chat, id);
    });
    return last;
}

/** Stores a message; returns its ID. Mentions go into each mentioned person's list. */
export async function addMessage(chat: string, message: StoredMessage): Promise<string> {
    const { messages } = config().chatHistory;
    const id = await redis().xadd(streamKey(chat), 'MAXLEN', messages, '*', 'm', JSON.stringify(message));
    if (!id) throw new Error('XADD returned no ID');
    const mentioned = mentionedIn(message.text).filter((identity) => identity !== message.identity);
    if (mentioned.length) {
        const ttl = config().chatHistory.days * 24 * 60 * 60;
        const tx = redis().multi();
        for (const identity of mentioned) {
            tx.rpush(mentionsKey(identity), `${chat} ${id}`).ltrim(mentionsKey(identity), -MAX_MENTIONS, -1).expire(mentionsKey(identity), ttl);
        }
        await tx.exec();
    }
    return id;
}

/** Removes a message everywhere it is kept: the stream, its pin, its reactions, mentions of it. */
export async function deleteMessage(chat: string, id: string, message: StoredMessage): Promise<void> {
    const tx = redis().multi().xdel(streamKey(chat), id).hdel(pinsKey(chat), id).hdel(reactionsKey(chat), id);
    for (const identity of mentionedIn(message.text)) tx.lrem(mentionsKey(identity), 0, `${chat} ${id}`);
    await tx.exec();
}

/** The caller's latest mentions in chats the config still has. */
export async function mentionsOf(identity: string): Promise<Array<{ channel: string; id: string }>> {
    const chats = new Set(config().chats.map((c) => c.id));
    return (await redis().lrange(mentionsKey(identity), 0, -1))
        .map((entry) => entry.split(' '))
        .filter(([chat, id]) => chats.has(chat) && MESSAGE_ID.test(id ?? ''))
        .map(([channel, id]) => ({ channel, id }));
}

// Adds or takes back one person's reaction. Kept as a list of [emoji, identities] pairs so
// the emoji stay in the order they were first used. Returns the new list as JSON, or
// nothing when the message already has the most different emoji.
const REACT = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
local list = raw and cjson.decode(raw) or {}
local found
for i, pair in ipairs(list) do if pair[1] == ARGV[2] then found = i break end end
if ARGV[4] == '1' then
  if not found then
    if #list >= tonumber(ARGV[5]) then return false end
    table.insert(list, { ARGV[2], { ARGV[3] } })
  else
    local ids = list[found][2]
    local has = false
    for _, id in ipairs(ids) do if id == ARGV[3] then has = true end end
    if not has then table.insert(ids, ARGV[3]) end
  end
elseif found then
  local kept = {}
  for _, id in ipairs(list[found][2]) do if id ~= ARGV[3] then table.insert(kept, id) end end
  if #kept == 0 then table.remove(list, found) else list[found][2] = kept end
end
if #list == 0 then
  redis.call('HDEL', KEYS[1], ARGV[1])
  return '[]'
end
local out = cjson.encode(list)
redis.call('HSET', KEYS[1], ARGV[1], out)
return out
`;

/** The message's reactions after the change; undefined when it has no room for another emoji. */
export async function react(chat: string, id: string, emoji: string, identity: string, on: boolean): Promise<ChatReactions | undefined> {
    const result = await redis().eval(REACT, 1, reactionsKey(chat), id, emoji, identity, on ? '1' : '0', MAX_REACTIONS) as string | null;
    if (result === null) return undefined;
    return reactionsOf(result) ?? {};
}

/** Pinned messages, newest pin first. */
export async function listPins(chat: string): Promise<ChatMessage[]> {
    const pins = Object.entries(await redis().hgetall(pinsKey(chat)))
        .map(([id, raw]) => [id, parse<Pin>(raw)] as const)
        .filter((p): p is readonly [string, Pin] => p[1] !== undefined)
        .sort((a, b) => b[1].at - a[1].at);
    return present(chat, pins.map(([id, pin]) => [id, pin.message]), new Set(pins.map(([id]) => id)));
}

/** False when the chat already has the most pins. */
export async function pin(chat: string, id: string, message: StoredMessage): Promise<boolean> {
    const key = pinsKey(chat);
    if (await redis().hexists(key, id)) return true;
    if (await redis().hlen(key) >= MAX_PINS) return false;
    await redis().hset(key, id, JSON.stringify({ at: Date.now(), message } satisfies Pin));
    return true;
}

/** Unpins; returns whether the message is gone with it (the stream had already let it go). */
export async function unpin(chat: string, id: string): Promise<boolean> {
    await redis().hdel(pinsKey(chat), id);
    const [entry] = await redis().xrange(streamKey(chat), id, id);
    if (entry) return false;
    await redis().hdel(reactionsKey(chat), id);
    return true;
}

/**
 * Trims each chat to its age limit and drops reactions of messages gone with the trimming.
 * A chat taken out of the config ages out the same way, so putting it back within that
 * time brings its history back; once its stream is empty its pins go too.
 */
export async function sweepChats(): Promise<void> {
    const { days } = config().chatHistory;
    const oldest = Date.now() - days * 24 * 60 * 60 * 1000;
    const chats = new Set(config().chats.map((c) => c.id));
    for await (const keys of redis().scanStream({ match: 'lala:chat:*', count: 100 }) as AsyncIterable<string[]>) {
        for (const key of keys) {
            const chat = key.slice('lala:chat:'.length);
            if (!chats.has(chat)) chats.add(chat);
        }
    }
    for (const chat of chats) {
        await redis().xtrim(streamKey(chat), 'MINID', oldest);
        const [first] = await redis().xrange(streamKey(chat), '-', '+', 'COUNT', 1) as Entry[];
        if (!first && !config().chats.some((c) => c.id === chat)) {
            await redis().del(streamKey(chat), reactionsKey(chat), pinsKey(chat));
            continue;
        }
        const pinned = new Set(await redis().hkeys(pinsKey(chat)));
        const stale = (await redis().hkeys(reactionsKey(chat))).filter((id) =>
            !pinned.has(id) && (!first || compareIds(id, first[0]) < 0));
        if (stale.length) await redis().hdel(reactionsKey(chat), ...stale);
    }
}

export function compareIds(a: string, b: string): number {
    const [am, as] = a.split('-').map(Number);
    const [bm, bs] = b.split('-').map(Number);
    return am - bm || as - bs;
}
