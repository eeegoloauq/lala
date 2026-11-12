// Dice: an example Lala bot that people add to their room. It rolls dice on `!roll` and
// answers with a card, and leaves for good on `!leave`. See README.md.
//
//   LALA_URL=https://lala.example.com LALA_BOT_CREDENTIAL=dice.<secret> node dice.mjs

import { Room, RoomEvent, dispose } from '@livekit/rtc-node';

const BASE = (process.env.LALA_URL ?? '').replace(/\/+$/, '');
const CREDENTIAL = process.env.LALA_BOT_CREDENTIAL ?? '';
if (!BASE || !CREDENTIAL) {
    console.error('Set LALA_URL (the Lala address) and LALA_BOT_CREDENTIAL (from bot-secret.js).');
    process.exit(2);
}

const CHAT_TOPIC = 'lk.chat';
const COMMANDS = [
    { name: '!roll', description: 'dice such as 2d6; one d6 without' },
    { name: '!leave', description: 'take Dice out of this room' },
];

// The same program can run under several bot accounts; logs name the one it is.
let who = CREDENTIAL.split('.')[0];
const log = (...args) => console.log(new Date().toISOString(), `[${who}]`, ...args);

/** Calls the Lala API as the bot. */
async function api(method, path, body) {
    const res = await fetch(`${BASE}/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${CREDENTIAL}`, ...(body && { 'Content-Type': 'application/json' }) },
        body: body && JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`${method} ${path}: ${res.status} ${data.error ?? ''}`), { status: res.status, code: data.error });
    return data;
}

// ---- Dice ----

/** `2d6`, `d20`, `3d8`; at most 20 dice of up to 1000 sides. Null for anything else. */
function parseDice(text) {
    const match = /^(\d{0,2})d(\d{1,4})$/i.exec(text.trim() || 'd6');
    if (!match) return null;
    const count = Number(match[1] || 1);
    const sides = Number(match[2]);
    return count >= 1 && count <= 20 && sides >= 2 && sides <= 1000 ? { count, sides } : null;
}

function roll({ count, sides }) {
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
    return { rolls, total: rolls.reduce((a, b) => a + b, 0) };
}

// ---- Rooms ----

/** Rooms the bot is in, by room ID. */
const rooms = new Map();
let stopping = false;

async function join(roomId, roomName) {
    if (rooms.has(roomId)) return;
    const { token, url } = await api('POST', '/token', { room: roomId });
    const room = new Room();
    rooms.set(roomId, room);
    room.registerTextStreamHandler(CHAT_TOPIC, (reader, { identity }) => {
        reader.readAll().then((text) => onChat(roomId, room, identity, text)).catch((err) => log('reading chat failed:', err.message));
    });
    room.on(RoomEvent.Disconnected, () => {
        // Removed, or the room ended, or the connection dropped: the server knows which.
        if (rooms.get(roomId) !== room) return;
        rooms.delete(roomId);
        log(`disconnected from ${roomName}`);
        if (!stopping) setTimeout(() => rejoin(roomId, roomName), 2000);
    });
    // Dice only chats, so it subscribes to nothing; a bot with `listen` could.
    await room.connect(url, token, { autoSubscribe: false, dynacast: false });
    log(`joined ${roomName}`);
}

/** After a drop: back in if the invitation still stands, which the token request tells. */
async function rejoin(roomId, roomName) {
    try {
        await join(roomId, roomName);
    } catch (err) {
        log(`not rejoining ${roomName}: ${err.message}`);
    }
}

async function leave(roomId) {
    const room = rooms.get(roomId);
    rooms.delete(roomId);
    await room?.disconnect();
}

async function say(room, text, card) {
    await room.localParticipant.sendText(text, {
        topic: CHAT_TOPIC,
        // Older clients and read-aloud use the text; current clients also show the card.
        ...(card && { attributes: { 'lala.card': JSON.stringify(card) } }),
    });
}

async function onChat(roomId, room, from, text) {
    const [command, ...rest] = text.trim().split(/\s+/);
    if (command === '!roll') {
        const dice = parseDice(rest.join(''));
        if (!dice) {
            await say(room, 'Try !roll 2d6: up to 20 dice of 2 to 1000 sides.');
            return;
        }
        const { rolls, total } = roll(dice);
        const name = room.remoteParticipants.get(from)?.name || 'Someone';
        const what = `${dice.count}d${dice.sides}`;
        const detail = rolls.length > 1 ? `${rolls.join(' + ')} = ${total}` : `${total}`;
        await say(room, `${name} rolled ${what}: ${detail}`, { title: `${total}`, text: `${name} rolled ${what}${rolls.length > 1 ? `: ${rolls.join(' + ')}` : ''}`, icon: 'dice' });
        // The status is what the bot does now; it is the same in every room.
        await api('POST', '/bot/profile', { status: `Last roll: ${total} (${what})` }).catch((err) => log(err.message));
    } else if (command === '!leave') {
        await say(room, 'Bye!');
        // Ends the invitation: the room sees "Dice left" and the server takes it out of the call.
        await api('DELETE', `/rooms/${encodeURIComponent(roomId)}/bots/me`).catch((err) => log(err.message));
        await leave(roomId);
    }
}

// ---- Events from the server ----

/** Reads server-sent events from a fetch response and calls `onEvent(name, data)` for each. */
async function readEvents(res, onEvent) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            let event = 'message';
            let data = '';
            for (const line of block.split('\n')) {
                if (line.startsWith('event:')) event = line.slice(6).trim();
                else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (data) onEvent(event, JSON.parse(data));
        }
    }
}

function onEvent(event, data) {
    if (event === 'invited') {
        log(`added to ${data.room.name} by ${data.byName}`);
        join(data.room.id, data.room.name).catch((err) => {
            rooms.delete(data.room.id);
            log(`joining ${data.room.name} failed: ${err.message}`);
        });
    } else if (event === 'removed') {
        log(`removed from ${data.room.id}`);
        leave(data.room.id).catch((err) => log(err.message));
    }
}

/** Keeps the event stream open: while it is, people see the bot as available. */
async function listen() {
    let delay = 1000;
    while (!stopping) {
        try {
            const res = await fetch(`${BASE}/api/bot/events`, { headers: { Authorization: `Bearer ${CREDENTIAL}`, Accept: 'text/event-stream' } });
            if (res.status === 401) throw Object.assign(new Error('the credential was refused'), { fatal: true });
            if (!res.ok) throw new Error(`events: ${res.status}`);
            log('waiting to be added to rooms');
            delay = 1000;
            await readEvents(res, onEvent);
        } catch (err) {
            if (err.fatal) throw err;
            if (!stopping) log(`event stream: ${err.message}`);
        }
        if (!stopping) await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 30_000);
    }
}

async function stop() {
    stopping = true;
    await Promise.allSettled([...rooms.keys()].map(leave));
    await dispose();
    process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// The server may still be starting; the profile and the stream retry.
for (let attempt = 0; ; attempt++) {
    try {
        who = (await api('GET', '/bot')).name;
        const profile = await api('POST', '/bot/profile', { status: 'Ready to roll', commands: COMMANDS });
        log(`signed in, status "${profile.status}"`);
        break;
    } catch (err) {
        if (err.status === 401 || attempt >= 30) {
            console.error(err.message);
            process.exit(1);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}
await listen();
