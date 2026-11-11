import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { TrackSource } from 'livekit-server-sdk';

// Read by the modules at load: the access gate is on, as on a server with a password.
process.env.LALA_ACCESS_PASSWORD = 'unit-test-server-password';
process.env.LIVEKIT_API_SECRET = 'unit-test-secret';

const { configRoomId, parseConfig, setConfig } = await import('../src/lib/config');
const { generateSecret, hashSecret, parseSecretHash, verifySecret } = await import('../src/lib/secrets');
const { authenticateBot, botAuth } = await import('../src/lib/bots');
const { requireAccess } = await import('../src/routes/access');
const { callerIdentity } = await import('../src/lib/identity');
const rights = await import('../src/lib/rights');
const { parseProfileUpdate } = await import('../src/lib/botProfile');
type RoomState = import('../src/lib/rooms').RoomState;

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const radioSecret = generateSecret();
const minutesSecret = generateSecret();

const rooms = [{ name: 'General' }, { name: 'Stage', speak: 'admins', video: 'admins', screen: 'admins' }, { name: 'Other' }];
const raw = async () => ({
    users: { boss: { role: 'admin', ids: ['a'.repeat(36)] } },
    guests: false,
    rooms,
    bots: {
        radio: { name: 'Radio', avatar: 'radio.png', secret: await hashSecret(radioSecret), rooms: ['General', 'stage'], rights: ['speak', 'chat'] },
        minutes: { secret: await hashSecret(minutesSecret), rooms: ['General'], rights: ['chat', 'listen'] },
    },
});
const files = (name: string) => {
    if (name === 'radio.png') return PNG;
    throw new Error('ENOENT');
};

const room = (name: string, extra: Partial<RoomState> = {}): RoomState => ({
    id: configRoomId(name),
    name,
    createdAt: 0,
    maxParticipants: 0,
    rights: { join: 'everyone', speak: 'everyone', video: 'everyone', screen: 'everyone', chat: 'everyone' },
    ...extra,
});
const noFlags = { muted: false, voiced: false };

before(async () => setConfig(parseConfig(await raw(), files)));

describe('bot config', () => {
    test('reads bots with identities, rooms, rights and avatar', async () => {
        const config = parseConfig(await raw(), files);
        const radio = config.bots.get('bot-radio')!;
        assert.equal(radio.name, 'Radio');
        assert.deepEqual(radio.rights, { speak: true, chat: true, listen: false });
        assert.deepEqual([...radio.rooms], [configRoomId('General'), configRoomId('Stage')]);
        assert.equal(radio.avatar, `data:image/png;base64,${PNG.toString('base64')}`);
        const minutes = config.bots.get('bot-minutes')!;
        assert.equal(minutes.name, 'minutes');
        assert.equal(minutes.rights.listen, true);
    });

    const broken: Array<[string, (bots: Record<string, Record<string, unknown>>) => void, RegExp]> = [
        ['a secret in plain text', (b) => { b.radio.secret = radioSecret; }, /never put the secret itself/],
        ['a room that is not configured', (b) => { b.radio.rooms = ['Nowhere']; }, /not a room listed/],
        ['a right bots cannot have', (b) => { b.radio.rights = ['speak', 'moderate']; }, /expected one of speak, chat, listen/],
        ['an unknown key', (b) => { b.radio.hidden = true; }, /unknown key "hidden"/],
        ['an avatar path outside the directory', (b) => { b.radio.avatar = '../secret.png'; }, /image file in the config directory/],
        ['an avatar that is not an image', (b) => { b.radio.avatar = 'missing.png'; }, /can't read/],
        ['no rooms', (b) => { b.radio.rooms = []; }, /expected a list of room names/],
    ];
    for (const [what, change, message] of broken) {
        test(`refuses ${what}`, async () => {
            const config = await raw();
            change(config.bots as Record<string, Record<string, unknown>>);
            assert.throws(() => parseConfig(config, files), message);
        });
    }

    test('refuses a key that is not a plain name', async () => {
        const config = await raw();
        (config.bots as Record<string, unknown>)['Radio Bot'] = config.bots.radio;
        assert.throws(() => parseConfig(config, files), /lowercase letters/);
    });
});

describe('server name', () => {
    test('defaults to Lala and takes the config name', async () => {
        assert.equal(parseConfig({}).name, 'Lala');
        assert.equal(parseConfig({ name: '  Our place ' }).name, 'Our place');
        assert.throws(() => parseConfig({ name: '' }), /name: expected a name/);
    });
});

describe('bot secrets', () => {
    test('verify only the matching secret', async () => {
        const stored = parseSecretHash(await hashSecret('right'))!;
        assert.equal(await verifySecret('right', stored), true);
        assert.equal(await verifySecret('wrong', stored), false);
    });

    test('reject hashes with unsafe parameters', () => {
        assert.equal(parseSecretHash('scrypt$1048577$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA=='), null);
        assert.equal(parseSecretHash('scrypt$16384$8$1$AAAA$AAAAAAAAAAAAAAAAAAAAAA=='), null);
        assert.equal(parseSecretHash('bcrypt$x'), null);
    });

    test('a credential is the key and the secret', async () => {
        assert.equal((await authenticateBot(`radio.${radioSecret}`))?.identity, 'bot-radio');
        // Twice, so the cached check is covered too.
        assert.equal((await authenticateBot(`radio.${radioSecret}`))?.identity, 'bot-radio');
        assert.equal(await authenticateBot(`radio.${minutesSecret}`), undefined);
        assert.equal(await authenticateBot(`minutes.${radioSecret}`), undefined);
        assert.equal(await authenticateBot(`ghost.${radioSecret}`), undefined);
        assert.equal(await authenticateBot(radioSecret), undefined);
    });
});

describe('bot requests', () => {
    let server: Server;
    let base: string;

    before(async () => {
        const app = express();
        app.set('trust proxy', 1);
        app.use('/api', botAuth);
        app.use('/api', requireAccess);
        app.get('/api/who', (req, res) => { res.json({ identity: callerIdentity(req) ?? null }); });
        server = app.listen(0);
        await new Promise((resolve) => server.once('listening', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    after(() => server.close());

    const who = (headers: Record<string, string>, ip = '10.0.0.1') =>
        fetch(`${base}/api/who`, { headers: { 'X-Forwarded-For': ip, ...headers } });

    test('a valid credential passes the server password and names the bot', async () => {
        const res = await who({ Authorization: `Bearer radio.${radioSecret}`, 'X-Lala-Device': 'some-device' });
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { identity: 'bot-radio' });
    });

    test('without a credential or session the gate stays shut', async () => {
        assert.equal((await who({ 'X-Lala-Device': 'some-device' })).status, 401);
    });

    test('a wrong credential is refused, not ignored', async () => {
        const res = await who({ Authorization: `Bearer radio.${minutesSecret}` }, '10.0.0.2');
        assert.equal(res.status, 401);
        assert.deepEqual(await res.json(), { error: 'invalid_bot_credential' });
    });

    test('failed attempts are limited per address', async () => {
        for (let i = 0; i < 10; i++) assert.equal((await who({ Authorization: 'Bearer radio.wrong' }, '10.0.0.3')).status, 401);
        assert.equal((await who({ Authorization: 'Bearer radio.wrong' }, '10.0.0.3')).status, 429);
        // The right secret from another address still works.
        assert.equal((await who({ Authorization: `Bearer radio.${radioSecret}` }, '10.0.0.4')).status, 200);
    });
});

describe('bot rights', () => {
    const general = room('General');
    const stage = room('Stage', { rights: { join: 'everyone', speak: 'admins', video: 'admins', screen: 'admins', chat: 'everyone' } });
    const other = room('Other');

    test('a bot enters though guests may not, and only while configured', () => {
        assert.equal(rights.mayEnter('bot-radio'), true);
        assert.equal(rights.mayEnter('bot-ghost'), false);
        assert.equal(rights.mayEnter('b'.repeat(36)), false);
    });

    test('a bot joins only its rooms', () => {
        assert.equal(rights.can('bot-radio', general, 'join'), true);
        assert.equal(rights.can('bot-radio', stage, 'join'), true);
        assert.equal(rights.can('bot-radio', other, 'join'), false);
        assert.equal(rights.can('bot-ghost', general, 'join'), false);
    });

    test('a bot never moderates or creates rooms, even as a room creator', () => {
        assert.equal(rights.isModerator('bot-radio', room('Mine', { creator: 'bot-radio' })), false);
        assert.equal(rights.canCreateRooms('bot-radio'), false);
    });

    test('speak and chat come from the bot entry; video and screen never', () => {
        const permission = rights.permissionFor('bot-radio', stage, noFlags);
        assert.deepEqual(permission.canPublishSources, [TrackSource.MICROPHONE]);
        assert.equal(permission.canPublishData, true);
        const minutes = rights.permissionFor('bot-minutes', general, noFlags);
        assert.deepEqual(minutes.canPublishSources, []);
        assert.equal(minutes.canPublish, false);
    });

    test('listen is off unless granted', () => {
        assert.equal(rights.permissionFor('bot-radio', general, noFlags).canSubscribe, false);
        assert.equal(rights.permissionFor('bot-minutes', general, noFlags).canSubscribe, true);
    });

    test('a server mute silences a bot; the floor does not make one speak', () => {
        assert.deepEqual(rights.permissionFor('bot-radio', general, { muted: true, voiced: false }).canPublishSources, []);
        assert.deepEqual(rights.permissionFor('bot-minutes', general, { muted: false, voiced: true }).canPublishSources, []);
    });

    test('the token grant keeps bots from changing their own name or attributes, and never hides them', () => {
        const grant = rights.grantFor('bot-radio', general, noFlags);
        assert.equal(grant.canUpdateOwnMetadata, false);
        assert.equal(grant.hidden, false);
        assert.equal(grant.canSubscribe, false);
        assert.equal(grant.room, general.id);
        const person = rights.grantFor('a'.repeat(36), general, noFlags);
        assert.equal(person.canUpdateOwnMetadata, true);
        assert.equal(person.canSubscribe, true);
        assert.deepEqual(person.canPublishSources, [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]);
    });
});

describe('bot profile', () => {
    test('accepts a status and commands, cleaned', () => {
        assert.deepEqual(parseProfileUpdate({ status: '  Teardrop‮ · Massive Attack ', commands: [{ name: '!play', description: 'song name or link' }, { name: '!skip' }] }), {
            status: 'Teardrop · Massive Attack',
            commands: [{ name: '!play', description: 'song name or link' }, { name: '!skip', description: '' }],
        });
        assert.deepEqual(parseProfileUpdate({}), {});
    });

    const invalid: unknown[] = [
        null,
        [],
        { name: 'New name' },
        { status: 5 },
        { status: 'x'.repeat(201) },
        { commands: 'play' },
        { commands: [{ name: 'play' }] },
        { commands: [{ name: '!Play' }] },
        { commands: [{ name: '!play' }, { name: '!play' }] },
        { commands: [{ name: '!play', hidden: true }] },
        { commands: Array.from({ length: 21 }, (_, i) => ({ name: `!c${i}` })) },
    ];
    for (const body of invalid) {
        test(`refuses ${JSON.stringify(body).slice(0, 60)}`, () => assert.equal(parseProfileUpdate(body), null));
    }
});
