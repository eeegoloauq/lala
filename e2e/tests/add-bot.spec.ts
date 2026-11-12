import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createRoom, enter } from './helpers';

// People add bots to their rooms. The bots are the example in examples/bots, run as their
// own processes the way a self-hoster runs one: they keep the event stream open and join
// when added. Dice (invite: everyone) chats; Scribe (invite: members) can also hear the call.
// One process per bot serves every test here, so they run one after another.
test.describe.configure({ mode: 'serial' });

const EXAMPLE = join(__dirname, '../../examples/bots');
const credential = (key: string) => `${key}.e2e-${key}-secret-not-used-outside-tests`;

const withoutProxy = (env: NodeJS.ProcessEnv) => Object.fromEntries(Object.entries(env).filter(([name]) => !/^(https?|all|no)_proxy$/i.test(name)));

/** Starts the example bot and waits until it listens for invitations. */
function startBot(key: string): Promise<ChildProcess> {
    const child = spawn(process.execPath, ['dice.mjs'], {
        cwd: EXAMPLE,
        // Everything it talks to is on this machine: no proxy, which LiveKit's SDK would use.
        env: { ...withoutProxy(process.env), LALA_URL: 'http://127.0.0.1:3000', LALA_BOT_CREDENTIAL: credential(key) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    logs.set(key, () => output);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${key} did not start:\n${output}`)), 60_000);
        const onData = (chunk: Buffer) => {
            output += chunk;
            if (output.includes('waiting to be added')) {
                clearTimeout(timer);
                resolve(child);
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`${key} exited with ${code}:\n${output}`));
        });
    });
}

let bots: ChildProcess[] = [];
// What each bot printed, attached to a failed test.
const logs = new Map<string, () => string>();
test.beforeAll(async () => {
    test.setTimeout(90_000);
    bots = await Promise.all([startBot('dice'), startBot('scribe')]);
});
test.afterAll(() => {
    for (const bot of bots) bot.kill('SIGTERM');
});
test.afterEach(async ({ browser }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
        for (const [key, output] of logs) await testInfo.attach(`${key}.log`, { body: output(), contentType: 'text/plain' });
    }
    await Promise.all(browser.contexts().map(c => c.close()));
});

const tile = (page: Page, name: string) => page.locator('.p-tile', { hasText: name });
const chatLine = (page: Page, text: string) => page.locator('.cp-system', { hasText: text });
const addBotRow = (page: Page) => page.getByRole('button', { name: 'Add bot', exact: true });
const picker = (page: Page) => page.getByRole('dialog', { name: 'Add a bot' });

/** Calls the API as the page's device, from inside the page. */
const call = (page: Page, method: string, path: string) => page.evaluate(async ({ method, path }) => {
    const res = await fetch(`/api${path}`, { method, headers: { 'X-Lala-Device': localStorage.getItem('lala-device-id') ?? '' } });
    return { status: res.status, body: await res.json() };
}, { method, path });

/** Page errors, without the refusals this test asks for on purpose. */
const unexpected = (errors: string[]) => errors.filter(e => !e.includes('status of 403') && !e.includes('status of 409'));

const roomIdOf = (page: Page) => new URL(page.url()).pathname.split('/').pop()!;

async function openProfile(page: Page, name: string) {
    await tile(page, name).click({ button: 'right' });
    await page.locator('.ctx-menu').getByText('Profile').click();
    return page.getByRole('dialog', { name: `Profile of ${name}` });
}

test('someone adds a bot to their own room, others use it, and it is removed or leaves', async ({ browser }) => {
    const alice = await enter(browser, 'Alice');
    await createRoom(alice.page, 'Dice night');
    const roomId = roomIdOf(alice.page);

    // Alice is a guest, but ranks as an admin in a room she created: Scribe (members) is
    // hers to add too. Radio has no invite and is never listed.
    await addBotRow(alice.page).click();
    await expect(picker(alice.page).getByRole('button', { name: 'Dice' })).toBeEnabled();
    await expect(picker(alice.page).getByRole('button', { name: 'Scribe' })).toBeEnabled();
    await expect(picker(alice.page)).not.toContainText('Radio');
    await picker(alice.page).getByRole('button', { name: 'Dice' }).click();

    // The bot joins on its own after the server tells it; its status comes from the bot.
    await expect(tile(alice.page, 'Dice').locator('.bot-badge')).toBeVisible({ timeout: 20_000 });
    await expect(tile(alice.page, 'Dice').locator('.p-tile-bot-status')).toHaveText('Ready to roll', { timeout: 10_000 });
    await expect(tile(alice.page, 'Dice').locator('.bot-listens')).toHaveCount(0);
    await alice.page.getByRole('button', { name: 'Chat' }).click();
    await expect(chatLine(alice.page, 'Alice added Dice')).toBeVisible();
    await expect(chatLine(alice.page, 'Dice joined')).toHaveCount(0);

    // Bob comes in and asks it for a roll: everyone gets the text and the card.
    const bob = await enter(browser, 'Bob');
    await bob.page.goto(alice.page.url());
    await expect(tile(bob.page, 'Dice')).toBeVisible({ timeout: 20_000 });
    await bob.page.getByRole('button', { name: 'Chat' }).click();
    await bob.page.getByPlaceholder('Send a message...').fill('!roll 3d6');
    await bob.page.getByPlaceholder('Send a message...').press('Enter');
    for (const page of [alice.page, bob.page]) {
        await expect(page.locator('.cp-card')).toContainText('Bob rolled 3d6', { timeout: 15_000 });
        await expect(page.locator('.cp-bubble', { hasText: /^Bob rolled 3d6: \d+ \+ \d+ \+ \d+ = \d+$/ })).toBeVisible();
    }
    await expect(tile(alice.page, 'Dice').locator('.p-tile-bot-status')).toHaveText(/^Last roll: \d+ \(3d6\)$/, { timeout: 10_000 });

    // Only who added it, or a moderator, takes it out. Bob is neither.
    const bobsView = await openProfile(bob.page, 'Dice');
    await expect(bobsView).toContainText('Added by Alice');
    await expect(bobsView.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    // Closed by a click elsewhere: Escape would close the chat too.
    await bob.page.locator('.room-header h1').click();
    await expect(bobsView).toHaveCount(0);
    expect((await call(bob.page, 'DELETE', `/rooms/${roomId}/bots/dice`)).status).toBe(403);
    // In someone else's room a guest gets only the bots everyone may add.
    expect((await call(bob.page, 'GET', `/rooms/${roomId}/bots`)).body.bots.map((b: { key: string }) => b.key)).toEqual(['dice']);
    expect((await call(bob.page, 'POST', `/rooms/${roomId}/bots/scribe`)).status).toBe(403);

    const alicesView = await openProfile(alice.page, 'Dice');
    await alicesView.getByRole('button', { name: 'Remove' }).click();
    await expect(tile(alice.page, 'Dice')).toHaveCount(0, { timeout: 10_000 });
    await expect(chatLine(bob.page, 'Alice removed Dice')).toBeVisible();
    await expect(chatLine(bob.page, 'Dice left')).toHaveCount(0);

    // Added again, it leaves for good on its own command.
    await addBotRow(alice.page).click();
    await picker(alice.page).getByRole('button', { name: 'Dice' }).click();
    await expect(tile(bob.page, 'Dice')).toBeVisible({ timeout: 20_000 });
    // With a space the command is complete: Enter sends it rather than picking a suggestion.
    await bob.page.getByPlaceholder('Send a message...').fill('!leave ');
    await bob.page.getByPlaceholder('Send a message...').press('Enter');
    await expect(tile(bob.page, 'Dice')).toHaveCount(0, { timeout: 15_000 });
    await expect(chatLine(bob.page, 'Dice left')).toHaveCount(1);
    // The invitation is over: it doesn't come back.
    const list = await call(alice.page, 'GET', `/rooms/${roomId}/bots`);
    expect(list.body.bots.find((b: { key: string }) => b.key === 'dice')).toMatchObject({ online: true, added: false });

    expect(unexpected(alice.errors)).toEqual([]);
    expect(unexpected(bob.errors)).toEqual([]);
});

test('adding a bot that hears the call asks first, and password rooms have none yet', async ({ browser }) => {
    const admin = await enter(browser, 'Admin', undefined, 'e2e-admin-device');
    const page = admin.page;
    await createRoom(page, 'Notes room');

    await addBotRow(page).click();
    const scribe = picker(page).getByRole('button', { name: 'Scribe' });
    await expect(scribe.locator('.bot-listens')).toBeVisible();
    await scribe.click();
    const confirm = page.getByRole('dialog', { name: 'Add Scribe?' });
    await expect(confirm).toContainText('It will hear and see everyone here.');
    await confirm.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(tile(page, 'Scribe').locator('.bot-listens')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('status').filter({ hasText: 'Scribe can hear this call.' })).toBeVisible();
    await expect(page.locator('.room-header')).toContainText('Scribe can hear');
    await page.getByRole('button', { name: 'Chat' }).click();
    await expect(chatLine(page, 'Admin added Scribe, which can hear the call')).toBeVisible();

    // A moderator removes it with the usual kick, which also ends the invitation.
    await tile(page, 'Scribe').click({ button: 'right' });
    await page.locator('.ctx-menu').getByText('Kick', { exact: true }).click();
    await expect(tile(page, 'Scribe')).toHaveCount(0, { timeout: 10_000 });
    await expect.poll(async () => (await call(page, 'GET', `/rooms/${roomIdOf(page)}/bots`)).body.bots
        .find((b: { key: string }) => b.key === 'scribe')?.added).toBe(false);

    // A password room: the bot would need the media key, which the server never has.
    await createRoom(page, 'Locked notes', { password: 'locked-notes-password' });
    await addBotRow(page).click();
    await expect(picker(page)).toContainText('Not in password rooms yet');
    await expect(picker(page).getByRole('button', { name: 'Dice' })).toBeDisabled();
    expect((await call(page, 'POST', `/rooms/${roomIdOf(page)}/bots/dice`)).body).toEqual({ error: 'password_room' });

    expect(unexpected(admin.errors)).toEqual([]);
});
