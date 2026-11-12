import { Router, type Request, type Response } from 'express';
import type { ChannelsResponse, ChatAttachment, ChatEvent, MessagesResponse, PinsResponse, TextChannel, UploadResponse } from '@lala/shared';
import { config, type ConfigChat } from '../lib/config';
import { callerIdentity } from '../lib/identity';
import { isBotIdentity } from '../lib/bots';
import { isServerAdmin, mayEnter, mayPost } from '../lib/rights';
import { isShutOut, shutOutAmong } from '../lib/bans';
import { nameOf } from '../lib/presence';
import { sanitizeDisplayText, sanitizeMessageText } from '../lib/sanitize';
import { sendToAllowed } from '../lib/sse';
import { acceptRules, acceptedAmong, requireRules, rulesFor, rulesPending } from '../lib/rules';
import { INLINE_TYPES } from '../lib/media';
import { attachFiles, drainRequest, fileMetas, fileOnDisk, removeFiles, storeUpload } from '../lib/chatFiles';
import {
    EMOJI, MAX_ATTACHMENTS, MAX_TEXT, MESSAGE_ID, addMessage, deleteMessage, findMessage, lastMessageIds,
    listMessages, listPins, mentionsOf, pin, presentOne, previewOf, react, unpin, type StoredMessage,
} from '../lib/chats';

/** Chat events carry what people wrote: only streams of people who may read them get them. */
function announce(event: ChatEvent): void {
    sendToAllowed(event.type, event, async (people) => {
        const shutOut = await shutOutAmong(people);
        const candidates = people.filter((p) => mayEnter(p.identity) && !isBotIdentity(p.identity) && !shutOut.has(p.identity));
        const ids = candidates.map((p) => p.identity);
        return config().rules?.required ? acceptedAmong(ids) : new Set(ids);
    }).catch((err) => console.error('[chats] sending an event failed:', err));
}

/** The caller, when they are a person allowed on the server; answers the request otherwise. */
async function reader(req: Request, res: Response): Promise<string | undefined> {
    const identity = callerIdentity(req);
    if (!identity || isBotIdentity(identity)) {
        res.status(400).json({ error: 'identity_required' });
        return undefined;
    }
    if (!mayEnter(identity) || await isShutOut(identity, req.ip)) {
        res.status(403).json({ error: 'forbidden' });
        return undefined;
    }
    return identity;
}

function chatOf(req: Request, res: Response): ConfigChat | undefined {
    const chat = config().chats.find((c) => c.id === req.params.chat);
    if (!chat) res.status(404).json({ error: 'channel_not_found' });
    return chat;
}

function messageIdOf(req: Request, res: Response): string | undefined {
    const id = String(req.params.message);
    if (MESSAGE_ID.test(id)) return id;
    res.status(404).json({ error: 'not_found' });
    return undefined;
}

/** A file name as people see it: no paths, no control or direction characters. */
function fileName(header: string | undefined): string {
    let name = '';
    try { name = decodeURIComponent(header ?? ''); } catch { /* not encoded as the client does */ }
    return sanitizeDisplayText(name.replace(/[\\/]/g, '_'), 200) || 'file';
}

/**
 * The text chats named in the config, the rules, and the files sent in them:
 * /api/chats, /api/rules/accept and /api/files/:id (mounted at /api).
 */
export function createChatsRouter(): Router {
    const router = Router();

    router.get('/chats', async (req, res) => {
        const identity = await reader(req, res);
        if (!identity) return;
        const rules = await rulesFor(identity);
        // Until the required rules are agreed to, they are all there is.
        if (await rulesPending(identity)) {
            const response: ChannelsResponse = { channels: [], rules, mentions: [] };
            res.json(response);
            return;
        }
        const chats = config().chats;
        const [last, mentions] = await Promise.all([lastMessageIds(chats.map((c) => c.id)), mentionsOf(identity)]);
        const channels: TextChannel[] = chats.map((c) => ({
            id: c.id, name: c.name, topic: c.topic, canPost: mayPost(identity, c), lastMessageId: last.get(c.id),
        }));
        const response: ChannelsResponse = { channels, rules, mentions };
        res.json(response);
    });

    router.post('/rules/accept', async (req, res) => {
        const identity = await reader(req, res);
        if (!identity) return;
        const { version } = (req.body ?? {}) as Record<string, unknown>;
        if (typeof version !== 'string' || !await acceptRules(identity, version)) {
            // Another version: the rules changed while they were reading.
            res.status(409).json({ error: 'invalid_input' });
            return;
        }
        res.status(204).end();
    });

    // Pictures and players load these without the device header, so the ID, 128 random
    // bits, is what lets someone in; the instance password still applies.
    router.get('/files/:id', async (req, res) => {
        const file = await fileOnDisk(String(req.params.id));
        if (!file) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const inline = INLINE_TYPES.has(file.meta.type);
        const ascii = file.meta.name.replace(/[^\x20-\x7e]|["\\]/g, '_');
        res.set({
            'Content-Type': inline ? file.meta.type : 'application/octet-stream',
            'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.meta.name)}`,
            'X-Content-Type-Options': 'nosniff',
            // Nothing in a file may run or load, and other sites can't embed it.
            'Content-Security-Policy': "default-src 'none'; sandbox",
            'Cross-Origin-Resource-Policy': 'same-origin',
            // A file never changes under its ID.
            'Cache-Control': 'private, max-age=31536000, immutable',
        });
        res.sendFile(file.path, { cacheControl: false, lastModified: false, dotfiles: 'deny' }, (err) => {
            if (err && !res.headersSent) res.status(404).json({ error: 'not_found' });
        });
    });

    // Everything below needs the rules agreed to, when they are required.
    router.use('/chats', requireRules);

    router.get('/chats/:chat/messages', async (req, res) => {
        const identity = await reader(req, res);
        if (!identity) return;
        const chat = chatOf(req, res);
        if (!chat) return;
        const before = typeof req.query.before === 'string' ? req.query.before : undefined;
        if (before !== undefined && !MESSAGE_ID.test(before)) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
        const response: MessagesResponse = await listMessages(chat.id, before, limit);
        res.json(response);
    });

    router.post('/chats/:chat/messages', async (req, res) => {
        const identity = await reader(req, res);
        if (!identity) return;
        const chat = chatOf(req, res);
        if (!chat) return;
        if (!mayPost(identity, chat)) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const raw = body.attachments ?? [];
        const listed = Array.isArray(raw) ? raw as unknown[] : undefined;
        const files = listed?.map((f) => {
            const { id, spoiler } = (f ?? {}) as Record<string, unknown>;
            return typeof id === 'string' && (spoiler === undefined || typeof spoiler === 'boolean') ? { id, spoiler: spoiler === true } : undefined;
        });
        const text = typeof body.text === 'string' && body.text.length <= MAX_TEXT ? sanitizeMessageText(body.text) : undefined;
        const replyTo = body.replyTo;
        if (text === undefined || !files || files.some((f) => !f) || files.length > MAX_ATTACHMENTS
            || new Set(files.map((f) => f!.id)).size !== files.length
            || (!text && files.length === 0)
            || (replyTo !== undefined && (typeof replyTo !== 'string' || !MESSAGE_ID.test(replyTo)))) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }

        // Only the sender's own uploads for this chat that no message has taken yet.
        const metas = await fileMetas(files.map((f) => f!.id));
        const attachments: Array<Omit<ChatAttachment, 'url'>> = [];
        for (const f of files) {
            const meta = metas.get(f!.id);
            if (!meta || meta.uploader !== identity || meta.channel !== chat.id || meta.message) {
                res.status(400).json({ error: 'invalid_input' });
                return;
            }
            attachments.push({ id: f!.id, name: meta.name, type: meta.type, size: meta.size, width: meta.width, height: meta.height, spoiler: f!.spoiler || undefined });
        }

        let reply: StoredMessage['reply'];
        if (typeof replyTo === 'string') {
            const original = await findMessage(chat.id, replyTo);
            if (!original) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            reply = previewOf(replyTo, original);
        }

        const stored: StoredMessage = {
            identity, name: await nameOf(identity), text, attachments: attachments.length ? attachments : undefined, reply,
        };
        const id = await addMessage(chat.id, stored);
        await attachFiles(attachments.map((a) => a.id), id);
        const message = await presentOne(chat.id, id, stored);
        announce({ type: 'chat_message', message });
        res.status(201).json(message);
    });

    router.delete('/chats/:chat/messages/:message', async (req, res) => {
        const identity = await reader(req, res);
        if (!identity) return;
        const chat = chatOf(req, res);
        const id = chat && messageIdOf(req, res);
        if (!chat || !id) return;
        const message = await findMessage(chat.id, id);
        if (!message) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        if (message.identity !== identity && !isServerAdmin(identity)) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        await deleteMessage(chat.id, id, message);
        await removeFiles(message.attachments?.map((a) => a.id) ?? []);
        if (message.identity !== identity) console.log(`[chats] ${identity} deleted ${message.identity}'s message ${id} in ${chat.id}`);
        announce({ type: 'chat_deleted', channel: chat.id, id });
        res.status(204).end();
    });

    const reaction = async (req: Request, res: Response, on: boolean) => {
        const identity = await reader(req, res);
        if (!identity) return;
        const chat = chatOf(req, res);
        const id = chat && messageIdOf(req, res);
        if (!chat || !id) return;
        const emoji = String(req.params.emoji);
        if (emoji.length > 32 || !EMOJI.test(emoji)) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        if (!await findMessage(chat.id, id)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const reactions = await react(chat.id, id, emoji, identity, on);
        if (!reactions) {
            res.status(409).json({ error: 'invalid_input' });
            return;
        }
        announce({ type: 'chat_reactions', channel: chat.id, id, reactions });
        res.status(204).end();
    };
    router.put('/chats/:chat/messages/:message/reactions/:emoji', (req, res) => reaction(req, res, true));
    router.delete('/chats/:chat/messages/:message/reactions/:emoji', (req, res) => reaction(req, res, false));

    router.get('/chats/:chat/pins', async (req, res) => {
        const identity = await reader(req, res);
        if (!identity) return;
        const chat = chatOf(req, res);
        if (!chat) return;
        const response: PinsResponse = { messages: await listPins(chat.id) };
        res.json(response);
    });

    const setPin = async (req: Request, res: Response, on: boolean) => {
        const identity = await reader(req, res);
        if (!identity) return;
        const chat = chatOf(req, res);
        const id = chat && messageIdOf(req, res);
        if (!chat || !id) return;
        if (!isServerAdmin(identity)) {
            res.status(403).json({ error: 'forbidden' });
            return;
        }
        const message = await findMessage(chat.id, id);
        if (!message) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        if (on && !await pin(chat.id, id, message)) {
            res.status(409).json({ error: 'invalid_input' });
            return;
        }
        if (!on && await unpin(chat.id, id)) {
            // Only the pin kept it: it goes for good, files and all.
            await removeFiles(message.attachments?.map((a) => a.id) ?? []);
            announce({ type: 'chat_deleted', channel: chat.id, id });
            res.status(204).end();
            return;
        }
        announce({ type: 'chat_pinned', channel: chat.id, message: await presentOne(chat.id, id, message) });
        res.status(204).end();
    };
    router.put('/chats/:chat/pins/:message', (req, res) => setPin(req, res, true));
    router.delete('/chats/:chat/pins/:message', (req, res) => setPin(req, res, false));

    // The body is the file itself, read as a stream: the JSON parser skips this path. A
    // refusal reads the rest of it first (see drainRequest).
    router.post('/chats/:chat/files', async (req, res) => {
        const refuse = async (status: number, error: string) => {
            await drainRequest(req);
            res.status(status).json({ error });
        };
        const identity = callerIdentity(req);
        if (!identity || isBotIdentity(identity)) return refuse(400, 'identity_required');
        if (!mayEnter(identity) || await isShutOut(identity, req.ip)) return refuse(403, 'forbidden');
        const chat = config().chats.find((c) => c.id === req.params.chat);
        if (!chat) return refuse(404, 'channel_not_found');
        if (!mayPost(identity, chat)) return refuse(403, 'forbidden');
        const result = await storeUpload(req, chat.id, identity, fileName(req.header('X-File-Name')));
        if ('error' in result) {
            res.status(result.error === 'payload_too_large' ? 413 : 400).json({ error: result.error });
            return;
        }
        const response: UploadResponse = { attachment: result.attachment };
        res.status(201).json(response);
    });

    return router;
}
