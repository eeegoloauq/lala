/**
 * The demo's text chats, answered inside the page like the rest of server.ts: a short
 * written history in #general (formatting, a mention of the visitor, a reply, a pin, a
 * picture and a song), Lala's latest release notes in #announcements, a few more lines
 * while the page is open, and the rules a visitor agrees to first.
 */
import releases from 'virtual:lala-releases';
import type { ChannelsResponse, ChatAttachment, ChatEvent, ChatMessage, ServerRules, TextChannel } from '../../lib/types';

interface Person { identity: string; name: string }

interface DemoChannel extends Omit<TextChannel, 'canPost' | 'lastMessageId'> {
    messages: ChatMessage[];
}

const MAX_LENGTH = 4000;
const MAX_REACTIONS = 20;
/** One emoji, possibly with modifiers and joiners: what a reaction may be. */
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}]|\u200d|\ufe0f|\u20e3)*$/u;
/** Shown inline; every other upload is a download, as packages/api will decide from the content. */
const INLINE = /^(image\/(png|jpeg|gif|webp|avif)|audio\/(mpeg|ogg|wav|webm|mp4|flac)|video\/(mp4|webm))$/;

const RULES_TEXT = `# Welcome to the Lala demo
Everyone here is simulated, and a reload starts it all over.

1. Be kind, even to people made of JavaScript.
2. No spam or ads.
3. Mark anything explicit as a ||spoiler||.`;

/** [minutes ago, who, text, extras]: #general as the visitor finds it. */
type Line = [number, string, string, { pin?: true; replyTo?: number; react?: Record<string, string[]>; me?: true }?];
const HISTORY: Line[] = [
    [26 * 60, 'Theo', 'morning. who broke the coffee machine this time'],
    [26 * 60 - 3, 'Sasha', 'it says **DESCALE** in capital letters. it has been saying that since june'],
    [26 * 60 - 5, 'Kofi', 'the machine is fine, it just has *boundaries*'],
    [25 * 60, 'Mira', '**Movie night** is Friday at 21:00 in Lounge.\n- bring snacks\n- Theo brings the projector he promised in March\n- vote for the film with a reaction below', { pin: true, react: { '🍿': ['Kofi', 'Lena', 'Ines'] } }],
    [25 * 60 - 2, 'Theo', 'the projector is *definitely* coming this time', { replyTo: 3, react: { '😂': ['Sasha', 'Mira'] } }],
    [24 * 60, 'Lena', 'shortlist so far:\n1. Arrival\n2. Paddington 2\n3. whatever Ravi keeps calling "a vibe"'],
    [24 * 60 - 1, 'Ravi', 'it IS a vibe'],
    [23 * 60, 'Yuki', 'Paddington 2 is the correct answer and I will not be taking questions', { react: { '💯': ['Lena', 'Omar', 'Mira', 'Zoe'] } }],
    [9 * 60, 'Omar', 'for anyone who asked: the noise suppression setting is under Settings → Audio, `RNNoise` is the strong one'],
    [9 * 60 - 4, 'Ines', 'it removed my keyboard, my dog AND my upstairs neighbour. 10/10'],
    [7 * 60, 'Hugo', 'is the server down or is it me'],
    [7 * 60 - 1, 'Elsa', 'it is you, Hugo'],
    [7 * 60 - 1, 'Hugo', 'it was me. router was unplugged. the cat did it'],
    [4 * 60, 'Ada', 'found this, explains why my build takes 9 minutes [a short guide to caching](https://example.com/caching)'],
    [3 * 60, 'Nika', '||the ending of Arrival|| is the best ending of any film, no notes'],
    [3 * 60 - 2, 'Jonas', 'NIKA', { react: { '😱': ['Pia', 'Malik'] } }],
    [70, 'Kofi', 'reminder that the quiz bot is offline because someone asked it what a "mungo bean" was'],
    [45, 'Mira', 'you should try the new text chat, it has __formatting__ now. select some text and see', { me: true }],
];
/** Said while the page is open, one now and then, each once. */
const LIVE: Array<[string, string]> = [
    ['Zoe', 'just got here, what did I miss'],
    ['Theo', 'update: the projector has been located. it was in the projector bag'],
    ['Pia', 'can we do Paddington 2 AND Arrival. double feature. emotional range'],
    ['Malik', 'brb, the dog wants to show me something urgent (a leaf)'],
    ['Theo', '{me} are you coming to movie night? we need one more vote'],
    ['Lena', 'votes so far: Paddington 2 is winning by a lot'],
    ['Ravi', 'my vibe movie got zero votes and I want that on the record'],
];

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
let seq = 0;
const newId = (at: number) => `${at}-${seq++}`;

/** Release notes as a chat message: a heading, its section titles bold, wrapped lines joined. */
function releaseText(version: string, notes: string): string {
    const [title, ...rest] = notes.split('\n');
    const body = rest.join('\n')
        .replace(/\n {2,}(\S)/g, ' $1')
        .replace(/^(New|Fixed|Changed|Removed)$/gm, '**$1**');
    return `## Lala ${version}: ${title}\n${body.trim()}`;
}

export function demoChat(me: string, myName: () => string, people: readonly Person[]) {
    const rules: Omit<ServerRules, 'accepted'> = { text: RULES_TEXT, version: '1', required: true, updatedAt: Date.now() - 9 * 86_400_000 };
    let accepted = false;
    const pending = new Map<string, ChatAttachment>();
    const pinnedAt = new Map<string, number>();
    const listeners = new Set<(e: ChatEvent) => void>();
    const emit = (e: ChatEvent) => listeners.forEach(fn => fn(e));
    const byName = (name: string) => people.find(p => p.name === name) ?? people[0];

    const message = (channel: string, who: Person, text: string, at: number, extra: Partial<ChatMessage> = {}): ChatMessage =>
        ({ id: newId(at), channel, identity: who.identity, name: who.name, text, at, ...extra });
    const preview = (m: ChatMessage) => ({ id: m.id, identity: m.identity, name: m.name, text: m.text.slice(0, 200) });

    const general: DemoChannel = { id: 'general', name: 'general', topic: 'Anything goes', messages: [] };
    const announcements: DemoChannel = { id: 'announcements', name: 'announcements', topic: 'Lala releases', messages: [] };
    const channels = [general, announcements];

    for (const [ago, name, text, extra = {}] of HISTORY) {
        const at = Date.now() - ago * 60_000;
        const reactions = extra.react && Object.fromEntries(Object.entries(extra.react).map(([e, names]) => [e, names.map(n => byName(n).identity)]));
        const original = extra.replyTo !== undefined ? general.messages[extra.replyTo] : undefined;
        const msg = message('general', byName(name), extra.me ? `<@${me}> ${text}` : text, at, {
            reactions, reply: original && preview(original), pinned: extra.pin,
        });
        if (extra.pin) pinnedAt.set(msg.id, at + 60_000);
        general.messages.push(msg);
    }

    const lala = { identity: 'bot-lala', name: 'Lala' };
    for (const r of [...releases].reverse()) {
        announcements.messages.push(message('announcements', lala, releaseText(r.version, r.notes), Date.parse(r.date) || Date.now()));
    }
    if (!releases.length) announcements.messages.push(message('announcements', lala, 'Release notes show up here.', Date.now() - 3600_000));

    // A picture and a song, made in the page: the demo has no server to keep files on.
    void (async () => {
        const image = await drawPicture();
        const insert = (msg: ChatMessage) => {
            general.messages.push(msg);
            general.messages.sort((a, b) => a.at - b.at);
        };
        insert(message('general', byName('Ines'), 'the view from the office today. I am not going back inside', Date.now() - 8 * 60 * 60_000, {
            attachments: [{ id: 'demo-picture', name: 'view.png', type: 'image/png', size: image.size, width: 640, height: 360, url: URL.createObjectURL(image) }],
        }));
        const song = makeSong();
        insert(message('general', byName('Sasha'), 'made a tiny loop for movie night intermission, thoughts?', Date.now() - 2 * 60 * 60_000, {
            attachments: [{ id: 'demo-song', name: 'intermission.wav', type: 'audio/wav', size: song.size, url: URL.createObjectURL(song) }],
        }));
    })();

    // The visitor is the demo server's admin, so #announcements takes their posts too.
    const describe = (c: DemoChannel): TextChannel =>
        ({ id: c.id, name: c.name, topic: c.topic, canPost: true, lastMessageId: c.messages.at(-1)?.id });

    // Someone says something new now and then; once the lines run out, the room is quiet.
    let activity: ReturnType<typeof setTimeout> | undefined;
    const live = [...LIVE];
    function scheduleActivity() {
        if (activity || !live.length) return;
        activity = setTimeout(() => {
            activity = undefined;
            if (accepted) {
                const [name, text] = live.shift()!;
                const msg = message('general', byName(name), text.replace('{me}', `<@${me}>`), Date.now());
                general.messages.push(msg);
                emit({ type: 'chat_message', message: msg });
                const target = general.messages.at(-2);
                if (target && Math.random() < 0.5) {
                    const emoji = pick(['👍', '😂', '❤️', '👀']);
                    target.reactions = { ...target.reactions, [emoji]: [...(target.reactions?.[emoji] ?? []), byName(name).identity] };
                    emit({ type: 'chat_reactions', channel: 'general', id: target.id, reactions: target.reactions });
                }
            }
            scheduleActivity();
        }, 40_000 + Math.random() * 40_000);
    }

    const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const fail = (status: number, error: string) => json(status, { error });
    const noContent = () => new Response(null, { status: 204 });

    return {
        /** Whether the visitor still has to agree to the rules. */
        rulesPending: () => rules.required && !accepted,

        onEvent(fn: (e: ChatEvent) => void): () => void {
            listeners.add(fn);
            scheduleActivity();
            return () => listeners.delete(fn);
        },

        /** Answers `/chats…` and `/rules…`; null for any other path. */
        handle(path: string, method: string, init: RequestInit): Response | null {
            const url = new URL(path, 'http://demo');
            const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
            if (url.pathname === '/rules/accept' && method === 'POST') {
                if (body.version !== rules.version) return fail(409, 'invalid_input');
                accepted = true;
                return noContent();
            }
            if (url.pathname === '/chats' && method === 'GET') {
                const visible = rules.required && !accepted ? [] : channels;
                const mentions = visible.flatMap(c => c.messages.filter(m => m.text.includes(`<@${me}>`)).map(m => ({ channel: c.id, id: m.id }))).slice(-50);
                return json(200, { channels: visible.map(describe), rules: { ...rules, accepted }, mentions } satisfies ChannelsResponse);
            }
            const m = url.pathname.match(/^\/chats\/([^/]+)\/(messages|files|pins)(?:\/([^/]+))?(?:\/reactions\/([^/]+))?$/);
            if (!m) return null;
            const channel = channels.find(c => c.id === decodeURIComponent(m[1]));
            if (!channel) return fail(404, 'channel_not_found');
            const [, , kind, messageId, emoji] = m;

            if (kind === 'files' && method === 'POST') {
                const file = init.body as Blob;
                const name = decodeURIComponent(new Headers(init.headers).get('X-File-Name') ?? 'file').slice(0, 200);
                const type = INLINE.test(file.type) ? file.type : 'application/octet-stream';
                const attachment: ChatAttachment = { id: `f${Date.now()}${seq++}`, name, type, size: file.size, url: URL.createObjectURL(new Blob([file], { type })) };
                pending.set(attachment.id, attachment);
                return json(201, { attachment });
            }

            if (kind === 'pins') {
                if (!messageId && method === 'GET') {
                    const pins = channel.messages.filter(x => x.pinned).sort((a, b) => (pinnedAt.get(b.id) ?? 0) - (pinnedAt.get(a.id) ?? 0));
                    return json(200, { messages: pins });
                }
                const target = channel.messages.find(x => x.id === messageId);
                if (!target) return fail(404, 'not_found');
                if (method !== 'PUT' && method !== 'DELETE') return fail(404, 'not_found');
                target.pinned = method === 'PUT' || undefined;
                if (target.pinned) pinnedAt.set(target.id, Date.now()); else pinnedAt.delete(target.id);
                emit({ type: 'chat_pinned', channel: channel.id, message: target });
                return noContent();
            }

            if (!messageId && method === 'GET') {
                const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 100);
                const before = url.searchParams.get('before');
                const end = before ? channel.messages.findIndex(x => x.id === before) : channel.messages.length;
                const upTo = end < 0 ? channel.messages.length : end;
                const from = Math.max(0, upTo - limit);
                return json(200, { messages: channel.messages.slice(from, upTo), more: from > 0 });
            }
            if (!messageId && method === 'POST') {
                const text = typeof body.text === 'string' ? body.text.trim() : '';
                const files = Array.isArray(body.attachments) ? body.attachments as Array<{ id: string; spoiler?: boolean }> : [];
                const attachments = files.map(f => pending.get(f.id) && { ...pending.get(f.id)!, spoiler: !!f.spoiler || undefined });
                if ((!text && !attachments.length) || text.length > MAX_LENGTH || attachments.some(a => !a)) return fail(400, 'invalid_input');
                const original = typeof body.replyTo === 'string' ? channel.messages.find(x => x.id === body.replyTo) : undefined;
                if (body.replyTo !== undefined && !original) return fail(404, 'not_found');
                files.forEach(f => pending.delete(f.id));
                const msg = message(channel.id, { identity: me, name: myName() }, text, Date.now(), {
                    attachments: attachments.length ? attachments as ChatAttachment[] : undefined,
                    reply: original && preview(original),
                });
                channel.messages.push(msg);
                emit({ type: 'chat_message', message: msg });
                return json(201, msg);
            }
            const target = channel.messages.find(x => x.id === messageId);
            if (!target) return fail(404, 'not_found');
            if (!emoji && method === 'DELETE') {
                // The visitor is the demo server's admin, so any message goes.
                channel.messages.splice(channel.messages.indexOf(target), 1);
                pinnedAt.delete(target.id);
                emit({ type: 'chat_deleted', channel: channel.id, id: target.id });
                return noContent();
            }
            if (emoji && (method === 'PUT' || method === 'DELETE')) {
                const e = decodeURIComponent(emoji);
                if (!EMOJI.test(e) || e.length > 16) return fail(400, 'invalid_input');
                const reactions = { ...target.reactions };
                const list = reactions[e] ?? [];
                if (method === 'PUT') {
                    if (!list.length && Object.keys(reactions).length >= MAX_REACTIONS) return fail(409, 'invalid_input');
                    if (!list.includes(me)) reactions[e] = [...list, me];
                } else {
                    reactions[e] = list.filter(i => i !== me);
                    if (!reactions[e].length) delete reactions[e];
                }
                target.reactions = reactions;
                emit({ type: 'chat_reactions', channel: channel.id, id: target.id, reactions });
                return noContent();
            }
            return fail(404, 'not_found');
        },
    };
}

/** A sunset over hills, as a PNG. */
async function drawPicture(): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const g = canvas.getContext('2d')!;
    const sky = g.createLinearGradient(0, 0, 0, 360);
    sky.addColorStop(0, '#2b1055');
    sky.addColorStop(0.6, '#d76d77');
    sky.addColorStop(1, '#ffaf7b');
    g.fillStyle = sky;
    g.fillRect(0, 0, 640, 360);
    g.fillStyle = '#ffe29a';
    g.beginPath();
    g.arc(420, 230, 46, 0, Math.PI * 2);
    g.fill();
    for (const [color, base, amp] of [['#3a1c4a', 270, 40], ['#1f0f2e', 310, 30]] as const) {
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(0, 360);
        for (let x = 0; x <= 640; x += 16) g.lineTo(x, base - Math.sin(x / 70 + base) * amp);
        g.lineTo(640, 360);
        g.fill();
    }
    return new Promise(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
}

/** Four seconds of a plucked arpeggio, as a WAV file. */
function makeSong(): Blob {
    const rate = 16000;
    const notes = [261.63, 329.63, 392, 523.25, 392, 329.63, 293.66, 349.23];
    const samples = new Int16Array(rate * 4);
    const step = samples.length / notes.length;
    notes.forEach((freq, n) => {
        for (let i = 0; i < step; i++) {
            const t = i / rate;
            samples[n * step + i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-4 * t) * 9000;
        }
    });
    const header = new DataView(new ArrayBuffer(44));
    const text = (offset: number, s: string) => [...s].forEach((c, i) => header.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF'); header.setUint32(4, 36 + samples.byteLength, true); text(8, 'WAVE');
    text(12, 'fmt '); header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
    header.setUint32(24, rate, true); header.setUint32(28, rate * 2, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true);
    text(36, 'data'); header.setUint32(40, samples.byteLength, true);
    return new Blob([header, samples], { type: 'audio/wav' });
}
