import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { enter, media, newClient } from './helpers';

// A bot is its own program. Here it is a page that runs livekit-client directly, served
// by the test itself (not the app, so the app's CSP doesn't apply), and calls the API
// with its credential the way any bot would.
// Read when a test runs: the web package is installed by the web server step, after tests load.
const livekitClient = () => readFileSync(join(__dirname, '../../packages/web/node_modules/livekit-client/dist/livekit-client.esm.mjs'), 'utf8');
const BOT_PAGE = `<!doctype html><title>bot</title><script type="module">
import * as LK from './livekit-client.esm.mjs';
window.LK = LK;
</script>`;

declare global {
    interface Window {
        LK: typeof import('livekit-client');
        room: import('livekit-client').Room;
    }
}

interface Bot {
    page: Page;
    call: (method: string, path: string, body?: object, credential?: string) => Promise<{ status: number; body: any }>;
}

/** The credentials match the hashes in lala-e2e.yaml. */
async function startBot(browser: Browser, key: string): Promise<Bot> {
    const context = await newClient(browser);
    // The page comes from the test, not the server, so Chromium treats it as public and
    // needs leave for it to reach LiveKit on the loopback address.
    await context.grantPermissions(['local-network-access']);
    const client = livekitClient();
    await context.route('**/__bot/**', (route) => route.request().url().endsWith('.mjs')
        ? route.fulfill({ body: client, contentType: 'text/javascript' })
        : route.fulfill({ body: BOT_PAGE, contentType: 'text/html' }));
    const page = await context.newPage();
    await page.goto('/__bot/index.html');
    await page.waitForFunction(() => window.LK !== undefined);
    const own = `${key}.e2e-${key}-secret-not-used-outside-tests`;
    const call: Bot['call'] = (method, path, body, credential = own) => page.evaluate(async ({ method, path, body, credential }) => {
        const res = await fetch(`/api${path}`, {
            method,
            headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
            body: body && JSON.stringify(body),
        });
        return { status: res.status, body: await res.json() };
    }, { method, path, body, credential });
    return { page, call };
}

/** Joins the room with a token from the API; a bot with speak publishes the fake microphone. */
async function joinCall(bot: Bot, roomId: string, speak: boolean): Promise<void> {
    const { status, body } = await bot.call('POST', '/token', { room: roomId });
    expect(status).toBe(200);
    await bot.page.evaluate(async ({ url, token, speak }) => {
        window.room = new window.LK.Room();
        await window.room.connect(url, token);
        if (speak) await window.room.localParticipant.setMicrophoneEnabled(true);
    }, { url: body.url, token: body.token, speak });
}

/** Tracks the bot receives from others. */
const subscribed = (bot: Bot) => bot.page.evaluate(() =>
    [...window.room.remoteParticipants.values()].flatMap((p) => [...p.trackPublications.values()]).filter((t) => t.isSubscribed).length);

/** An attribute of another participant, as this bot sees it. */
const attributeOf = (bot: Bot, identity: string, name: string) => bot.page.evaluate(({ identity, name }) =>
    window.room.remoteParticipants.get(identity)?.attributes[name], { identity, name });

test.afterEach(async ({ browser }) => {
    await Promise.all(browser.contexts().map(c => c.close()));
});

test('a bot signs in with its secret and gets only the rights the config gives it', async ({ browser }) => {
    const radio = await startBot(browser, 'radio');

    // The credential stands in for the server password; a wrong one is refused outright.
    expect((await radio.call('GET', '/bot', undefined, 'radio.wrong-secret')).status).toBe(401);
    expect((await radio.call('GET', '/bot', undefined, 'minutes.e2e-radio-secret-not-used-outside-tests')).status).toBe(401);
    const me = await radio.call('GET', '/bot');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ identity: 'bot-radio', name: 'Radio', rights: { speak: true, chat: true, listen: false } });
    expect(me.body.rooms.map((r: { name: string }) => r.name)).toEqual(['Bots']);

    const rooms = (await radio.call('GET', '/rooms')).body.rooms as Array<{ id: string; displayName: string }>;
    const id = (name: string) => rooms.find((r) => r.displayName === name)!.id;

    // Only its own rooms; it never creates rooms, moderates or hands out invites.
    expect((await radio.call('POST', '/token', { room: id('Lobby') })).body).toEqual({ error: 'not_allowed' });
    expect((await radio.call('POST', '/rooms', { name: 'Bot made this' })).status).toBe(403);
    expect((await radio.call('POST', `/rooms/${id('Bots')}/admin/kick`, { identity: 'bot-minutes' })).status).toBe(403);
    expect((await radio.call('POST', '/access/invite')).status).toBe(403);

    // The token carries the config's name and the bot's grants, whatever the bot asks for.
    const token = await radio.call('POST', '/token', { room: id('Bots'), name: 'Not Radio' });
    expect(token.status).toBe(200);
    expect(token.body.identity).toBe('bot-radio');
    expect(token.body.canModerate).toBe(false);
    const claims = JSON.parse(Buffer.from(token.body.token.split('.')[1], 'base64url').toString());
    expect(claims.name).toBe('Radio');
    expect(claims.video).toMatchObject({ canSubscribe: false, canUpdateOwnMetadata: false, canPublishData: true, canPublishSources: ['microphone'] });
    expect(claims.video.hidden).toBeFalsy();

    // Status and commands are checked by the server.
    expect((await radio.call('POST', '/bot/profile', { commands: [{ name: 'play' }] })).status).toBe(400);
    expect((await radio.call('POST', '/bot/profile', { name: 'Someone else' })).status).toBe(400);
    const profile = await radio.call('POST', '/bot/profile', { status: 'Teardrop · Massive Attack', commands: [{ name: '!play', description: 'song name or link' }] });
    expect(profile.body).toEqual({ status: 'Teardrop · Massive Attack', commands: [{ name: '!play', description: 'song name or link' }] });
});

test('people see which bots are in a call and which can hear it', async ({ browser }) => {
    const radio = await startBot(browser, 'radio');
    const minutes = await startBot(browser, 'minutes');
    const rooms = (await radio.call('GET', '/rooms')).body.rooms as Array<{ id: string; displayName: string }>;
    const roomId = rooms.find((r) => r.displayName === 'Bots')!.id;
    await radio.call('POST', '/bot/profile', { status: 'Teardrop', commands: [{ name: '!play', description: 'song name or link' }] });
    await joinCall(radio, roomId, true);
    await joinCall(minutes, roomId, false);

    const admin = await enter(browser, 'Admin', undefined, 'e2e-admin-device');
    const page = admin.page;
    const room = page.locator('.channel-item', { hasText: /^Bots/ });
    // Before joining: the room says a bot can hear it, and the list marks the bots.
    await expect(room.locator('.channel-listens')).toBeVisible();
    const row = (name: string) => page.locator('.channel-user-card', { hasText: name });
    await expect(row('Minutes').locator('.bot-badge')).toBeVisible();
    await expect(row('Minutes').locator('.bot-listens')).toBeVisible();
    await expect(row('Radio').locator('.bot-badge')).toBeVisible();
    await expect(row('Radio').locator('.bot-listens')).toHaveCount(0);

    await room.click();
    await page.waitForURL(/\/room\//);
    await expect(page.getByRole('status').filter({ hasText: 'Minutes can hear this call.' })).toBeVisible();
    const tile = (name: string) => page.locator('.p-tile', { hasText: name });
    await expect(tile('Radio').locator('.bot-badge')).toBeVisible();
    await expect(tile('Radio').locator('.bot-listens')).toHaveCount(0);
    await expect(tile('Minutes').locator('.bot-listens')).toBeVisible();

    // The admin hears Radio; Minutes, with listen, gets the admin's microphone; Radio gets nothing.
    await expect.poll(async () => (await media(page)).audio, { timeout: 20_000 }).toBe(1);
    await expect.poll(() => subscribed(minutes), { timeout: 20_000 }).toBeGreaterThan(0);
    expect(await subscribed(radio)).toBe(0);

    // The server put the status on Radio when it joined and updates it on request;
    // Radio itself can't change its attributes or name.
    await expect.poll(() => attributeOf(minutes, 'bot-radio', 'lala.bot-status'), { timeout: 10_000 }).toBe('Teardrop');
    const forged = await radio.page.evaluate(() => Promise.race([
        window.room.localParticipant.setAttributes({ 'lala.bot-status': 'forged' }).then(() => 'accepted', () => 'refused'),
        new Promise((resolve) => setTimeout(() => resolve('no answer'), 5_000)),
    ]));
    expect(forged).not.toBe('accepted');
    await radio.call('POST', '/bot/profile', { status: 'Angel' });
    await expect.poll(() => attributeOf(minutes, 'bot-radio', 'lala.bot-status'), { timeout: 10_000 }).toBe('Angel');
    expect(await minutes.page.evaluate(() => window.room.remoteParticipants.get('bot-radio')?.name)).toBe('Radio');

    // What people see of it: the header names who can hear, the tile shows the status, the
    // profile lists commands and rights, and `!` in chat suggests the commands.
    await expect(page.locator('.room-header')).toContainText('Minutes can hear');
    await expect(tile('Radio').locator('.p-tile-bot-status')).toHaveText('Angel');
    await tile('Radio').click({ button: 'right' });
    await page.locator('.ctx-menu').getByText('Profile').click();
    const profile = page.getByRole('dialog', { name: 'Profile of Radio' });
    await expect(profile).toContainText("Can't hear the call");
    await profile.getByRole('button', { name: '!play' }).click();
    await expect(page.getByPlaceholder('Send a message...')).toHaveValue('!play ');
    await page.getByPlaceholder('Send a message...').fill('!p');
    await expect(page.getByRole('option', { name: /!play/ })).toBeVisible();
    await page.getByPlaceholder('Send a message...').press('Enter');
    await expect(page.getByPlaceholder('Send a message...')).toHaveValue('!play ');
    await page.getByPlaceholder('Send a message...').fill('');

    // The same menu as for people, without giving a bot the floor; a server mute takes its microphone.
    await tile('Minutes').click({ button: 'right' });
    await expect(page.locator('.ctx-menu')).toContainText('Volume');
    await expect(page.locator('.ctx-menu')).not.toContainText('Let speak');
    await page.keyboard.press('Escape');
    await tile('Radio').click({ button: 'right' });
    await page.locator('.ctx-menu').getByText('Server mute').click();
    await expect.poll(() => radio.page.evaluate(() => window.room.localParticipant.permissions?.canPublishSources.length), { timeout: 10_000 }).toBe(0);
    await radio.call('POST', `/rooms/${roomId}/admin/mute`, { identity: 'bot-radio', muted: false }).then((r) => expect(r.status).toBe(403));

    expect(admin.errors).toEqual([]);
});
