import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { SERVER_PASSWORD } from '../playwright.config';

// Each person in a test is a separate client to the API, as they would be in real use:
// per-address limits (rate limits, SSE connections) must not add up across tests.
let clients = 0;
async function newClient(browser: Browser) {
    const n = ++clients;
    const address = `10.${test.info().workerIndex % 256}.${Math.floor(n / 256)}.${n % 256}`;
    const context = await browser.newContext();
    // Only API requests: on third-party ones the extra header would fail CORS preflight.
    await context.route('**/api/**', route => route.continue({
        headers: { ...route.request().headers(), 'x-forwarded-for': address },
    }));
    return context;
}

/** A page in a fresh browser profile that records its errors, including camera effect failures, which only warn. */
async function openPage(browser: Browser): Promise<{ page: Page; errors: string[] }> {
    const page = await (await newClient(browser)).newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
        if (m.type() === 'error' || m.text().includes('useCameraProcessor')) errors.push(m.text());
    });
    return { page, errors };
}

/** Opens Lala, passes the server password and sets a name; a fixed device ID makes it a person from lala-e2e.yaml. */
async function enter(browser: Browser, name: string, settings?: object, deviceId?: string): Promise<{ page: Page; errors: string[] }> {
    const { page, errors } = await openPage(browser);
    if (deviceId) await page.addInitScript(id => localStorage.setItem('lala-device-id', id), deviceId);
    if (settings) await page.addInitScript(s => localStorage.setItem('lala-settings', s), JSON.stringify(settings));
    await page.goto('/');
    await page.getByLabel('Server password').fill(SERVER_PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByPlaceholder('Your name...').fill(name);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Voice Channels')).toBeVisible();
    return { page, errors };
}

// Participants of one test must not linger in the next one's rooms.
test.afterEach(async ({ browser }) => {
    await Promise.all(browser.contexts().map(c => c.close()));
});

/** Live remote audio elements and decoded video sizes on the page. */
const media = (page: Page) => page.evaluate(() => ({
    audio: [...document.querySelectorAll('audio')]
        .filter(a => (a.srcObject as MediaStream | null)?.getAudioTracks().some(t => t.readyState === 'live')).length,
    videos: [...document.querySelectorAll('video')].map(v => ({ width: v.videoWidth, time: v.currentTime })),
}));

test('server password keeps the app closed', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Server password').fill('wrong-password');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toHaveText('Wrong password');
    await expect(page.getByText('Voice Channels')).toBeHidden();

    expect((await page.request.get('/api/rooms')).status()).toBe(401);
    expect((await page.request.get('/api/health')).status()).toBe(200);

    // An invite has to carry the server's signature.
    await page.goto('/room/abc#invite=9999999999.forged');
    await expect(page.getByRole('alert')).toHaveText(/invite link has expired/);
    expect(new URL(page.url()).hash).toBe('');

    await page.getByLabel('Server password').fill(SERVER_PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByPlaceholder('Your name...')).toBeVisible();
    await page.reload();
    await expect(page.getByPlaceholder('Your name...')).toBeVisible();
});

test('two people talk in a password room', async ({ browser }) => {
    // Alice's mic goes through RNNoise.
    const alice = await enter(browser, 'Alice', { noiseSuppressionMode: 'rnnoise' });
    await alice.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await alice.page.getByRole('button', { name: 'Create channel' }).click();
    await alice.page.getByPlaceholder('e.g. "General"').fill('E2E room');
    await alice.page.getByPlaceholder('No password — open channel').fill('room-password');
    await alice.page.getByRole('button', { name: 'Create', exact: true }).click();
    await alice.page.waitForURL(/\/room\//);

    // Alice copies the invite link: it carries the room password (the E2EE key) and a server invite.
    const room = alice.page.locator('.channel-item', { hasText: 'E2E room' });
    await room.hover();
    await room.getByTitle('Copy invite link').click();
    await expect(room.locator('.channel-copy-btn.copied')).toBeVisible();
    const link = await alice.page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/#pw=room-password&invite=\d+\.[\w-]+$/);

    // Bob has never entered the server password: the link alone lets him in.
    const bob = await openPage(browser);
    await bob.page.goto(link);
    await bob.page.getByPlaceholder('Your name...').fill('Bob');
    await bob.page.getByRole('button', { name: 'Continue' }).click();

    await expect.poll(async () => (await media(alice.page)).audio, { timeout: 20_000 }).toBe(1);
    await expect.poll(async () => (await media(bob.page)).audio, { timeout: 20_000 }).toBe(1);

    await alice.page.getByRole('button', { name: 'Turn on camera' }).click();
    // Bob decodes Alice's encrypted video: frames have a size and keep advancing.
    await expect.poll(async () => (await media(bob.page)).videos.some(v => v.width > 0 && v.time > 1), { timeout: 20_000 }).toBe(true);

    await alice.page.getByRole('button', { name: 'Chat' }).click();
    await alice.page.getByPlaceholder('Send a message...').fill('hello from alice');
    await alice.page.getByPlaceholder('Send a message...').press('Enter');
    await bob.page.getByRole('button', { name: 'Chat' }).click();
    await expect(bob.page.getByText('hello from alice')).toBeVisible();

    expect(alice.errors).toEqual([]);
    expect(bob.errors).toEqual([]);
});

test('a viewer receives a screen share', async ({ browser }) => {
    const alice = await enter(browser, 'Alice');
    await alice.page.getByRole('button', { name: 'Create channel' }).click();
    await alice.page.getByPlaceholder('e.g. "General"').fill('Screen room');
    await alice.page.getByRole('button', { name: 'Create', exact: true }).click();
    await alice.page.waitForURL(/\/room\//);

    const bob = await enter(browser, 'Bob');
    await bob.page.goto(alice.page.url());
    await expect.poll(async () => (await media(bob.page)).audio, { timeout: 20_000 }).toBe(1);

    await alice.page.getByRole('button', { name: 'Share screen' }).click();
    await alice.page.getByRole('button', { name: 'Start', exact: true }).click();
    // Bob decodes the screen track: frames have a size and keep advancing.
    await expect.poll(async () => (await media(bob.page)).videos.some(v => v.width > 0 && v.time > 1), { timeout: 20_000 }).toBe(true);

    // The share takes Bob's view; Alice's camera joins it as a picture-in-picture he can swap with it.
    const main = bob.page.locator('.fl-main');
    await expect(main.locator('.fl-main-label')).toHaveText('Alice');
    await alice.page.getByRole('button', { name: 'Turn on camera' }).click();
    await bob.page.getByRole('button', { name: 'Show camera large' }).click();
    await expect(main).toHaveClass(/fl-main-camera/);
    await bob.page.getByRole('button', { name: 'Show screen large' }).click();
    await expect(main).not.toHaveClass(/fl-main-camera/);

    // Hiding the share stops receiving it; focusing Alice brings it back.
    await bob.page.locator('.fl-strip .p-tile', { hasText: 'Alice' }).click({ button: 'right' });
    await bob.page.getByRole('button', { name: 'Hide screen share' }).click();
    await expect(main).toBeHidden();
    await expect.poll(async () => (await media(bob.page)).videos.length, { timeout: 10_000 }).toBe(1);
    await bob.page.locator('.p-tile', { hasText: 'Alice' }).click();
    await expect(main).toBeVisible();
    await expect(main).not.toHaveClass(/fl-main-camera/);
    await expect.poll(async () => (await media(bob.page)).videos.length, { timeout: 10_000 }).toBe(2);

    await alice.page.getByRole('button', { name: 'Turn off camera' }).click();
    await alice.page.getByRole('button', { name: 'Stop screen share' }).click();
    await expect.poll(async () => (await media(bob.page)).videos.length, { timeout: 20_000 }).toBe(0);

    expect(alice.errors).toEqual([]);
    expect(bob.errors).toEqual([]);
});

test('the room creator mutes, kicks, bans and deletes', async ({ browser }) => {
    const alice = await enter(browser, 'Alice');
    await alice.page.getByRole('button', { name: 'Create channel' }).click();
    await alice.page.getByPlaceholder('e.g. "General"').fill('Admin room');
    await alice.page.getByRole('button', { name: 'Create', exact: true }).click();
    await alice.page.waitForURL(/\/room\//);
    const roomUrl = alice.page.url();

    const bob = await enter(browser, 'Bob');
    const join = async () => {
        await bob.page.goto(roomUrl);
        await expect.poll(async () => (await media(alice.page)).audio, { timeout: 20_000 }).toBe(1);
    };
    const adminAction = async (action: string) => {
        await alice.page.locator('.p-tile', { hasText: 'Bob' }).click({ button: 'right' });
        await alice.page.getByRole('button', { name: action }).click();
    };
    await join();

    // The public room list names the creator by identity; the device ID behind it stays private.
    const { rooms, deviceId, identity } = await alice.page.evaluate(async () => {
        const deviceId = localStorage.getItem('lala-device-id')!;
        const me = await (await fetch('/api/me', { headers: { 'X-Lala-Device': deviceId } })).json();
        return { rooms: (await (await fetch('/api/rooms')).json()).rooms, deviceId, identity: me.identity };
    });
    expect(deviceId).toBeTruthy();
    expect(JSON.stringify(rooms)).not.toContain(deviceId);
    expect(rooms.find((r: { displayName: string }) => r.displayName === 'Admin room').adminIdentity).toBe(identity);

    // Server mute revokes Bob's publish permission, so his microphone track goes away.
    await adminAction('Server mute');
    await expect(alice.page.locator('.p-tile', { hasText: 'Bob' }).getByTitle('Muted by admin')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await media(alice.page)).audio, { timeout: 10_000 }).toBe(0);
    // The mute is the server's: rejoining does not lift it.
    await bob.page.reload();
    await expect(alice.page.locator('.p-tile', { hasText: 'Bob' }).getByTitle('Muted by admin')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await media(alice.page)).audio, { timeout: 10_000 }).toBe(0);
    await adminAction('Allow microphone');
    await expect(alice.page.locator('.p-tile', { hasText: 'Bob' }).getByTitle('Muted by admin')).toBeHidden({ timeout: 10_000 });

    // A kicked participant lands back on the lobby and may rejoin. The server tells the room.
    await alice.page.getByRole('button', { name: 'Chat' }).click();
    await adminAction('Kick');
    await bob.page.waitForURL(url => !url.pathname.startsWith('/room/'), { timeout: 10_000 });
    await expect(alice.page.getByText('Alice kicked Bob')).toBeVisible();
    await join();

    // A banned one may not.
    await adminAction('Ban');
    await bob.page.waitForURL(url => !url.pathname.startsWith('/room/'), { timeout: 10_000 });
    await bob.page.goto(roomUrl);
    await expect(bob.page.getByText('You are banned from this channel')).toBeVisible();

    // Deleting the room drops Alice's own connection, which the SDK logs as data channel errors.
    expect(alice.errors).toEqual([]);
    await alice.page.locator('.channel-item', { hasText: 'Admin room' }).click({ button: 'right' });
    await alice.page.getByRole('button', { name: 'Delete room' }).click();
    const deleted = alice.page.waitForResponse(r => r.request().method() === 'DELETE');
    await alice.page.getByRole('button', { name: 'Click again to delete' }).click();
    expect((await deleted).status()).toBe(200);
    await expect(bob.page.locator('.channel-item', { hasText: 'Admin room' })).toBeHidden({ timeout: 10_000 });
});

/** Calls the API from the page, which holds the server password cookie, as the given device. */
const api = (page: Page, device: string, method: string, path: string, body?: object) =>
    page.evaluate(async ({ device, method, path, body }) => {
        const res = await fetch(`/api${path}`, {
            method,
            headers: { 'X-Lala-Device': device, 'Content-Type': 'application/json' },
            body: body && JSON.stringify(body),
        });
        return { status: res.status, body: await res.json() };
    }, { device, method, path, body });

test('only the creator moderates, and one name is one live room', async ({ browser }) => {
    const { page } = await enter(browser, 'Alice');

    const created = await api(page, 'device-alice', 'POST', '/rooms', { name: 'Shared name' });
    expect(created.status).toBe(201);
    expect(created.body.canModerate).toBe(true);
    const id = created.body.id;

    // The same name, in any case, while the room is live: Bob gets Alice's room, not a second one.
    const again = await api(page, 'device-bob', 'POST', '/rooms', { name: ' shared NAME ' });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(id);
    expect(again.body.canModerate).toBe(false);

    for (const action of ['kick', 'ban', 'mute']) {
        const res = await api(page, 'device-bob', 'POST', `/rooms/${id}/admin/${action}`, { identity: 'anyone', muted: true });
        expect(res.status, action).toBe(403);
    }
    expect((await api(page, 'device-bob', 'DELETE', `/rooms/${id}`)).status).toBe(403);
    expect((await api(page, 'device-alice', 'DELETE', `/rooms/${id}`)).status).toBe(200);

    // Deleting the room frees its name.
    const reborn = await api(page, 'device-bob', 'POST', '/rooms', { name: 'Shared name' });
    expect(reborn.status).toBe(201);
    expect(reborn.body.id).not.toBe(id);
    expect(reborn.body.canModerate).toBe(true);
});

test('auto-join brings friends launching together into one room', async ({ browser }) => {
    const alice = await enter(browser, 'Alice', { autoJoinLastRoom: true });
    const bob = await enter(browser, 'Bob', { autoJoinLastRoom: true });

    // Creating a room remembers it as the last one; Bob's create joins Alice's live room.
    for (const { page } of [alice, bob]) {
        await page.getByRole('button', { name: 'Create channel' }).click();
        await page.getByPlaceholder('e.g. "General"').fill('Daily');
        await page.getByRole('button', { name: 'Create', exact: true }).click();
        await page.waitForURL(/\/room\//);
    }
    const ended = new URL(alice.page.url()).pathname;
    expect(new URL(bob.page.url()).pathname).toBe(ended);

    // The room ends, then both launch Lala at the same moment.
    const device = await alice.page.evaluate(() => localStorage.getItem('lala-device-id'));
    expect((await api(alice.page, device!, 'DELETE', `/rooms/${ended.split('/').pop()}`)).status).toBe(200);
    await Promise.all([alice.page.goto('/'), bob.page.goto('/')]);
    await Promise.all([alice, bob].map(({ page }) => page.waitForURL(/\/room\//)));
    const room = new URL(alice.page.url()).pathname;
    expect(room).not.toBe(ended);
    expect(new URL(bob.page.url()).pathname).toBe(room);
    await expect.poll(async () => (await media(alice.page)).audio, { timeout: 20_000 }).toBe(1);
});

test('configured rooms: always listed, members only, admins speak, password from the config', async ({ browser }) => {
    const admin = await enter(browser, 'Admin', undefined, 'e2e-admin-device');
    const member = await enter(browser, 'Member', undefined, 'e2e-member-device');
    const guest = await enter(browser, 'Guest');
    const room = (page: Page, name: string) => page.locator('.channel-item', { hasText: new RegExp(`^${name}`) });

    // Listed while empty, first and in config order.
    await expect(guest.page.locator('.channel-item').nth(0)).toContainText('Lobby');
    await expect(guest.page.locator('.channel-item').nth(1)).toContainText('Stage');

    // Members only: locked for the guest, and the server refuses a token too.
    await expect(room(guest.page, 'Members')).toHaveClass(/channel-item-locked/);
    const membersId = (await api(guest.page, 'unused', 'GET', '/rooms')).body.rooms.find((r: { displayName: string }) => r.displayName === 'Members').id;
    const guestDevice = await guest.page.evaluate(() => localStorage.getItem('lala-device-id'));
    expect((await api(guest.page, guestDevice!, 'POST', '/token', { room: membersId })).status).toBe(403);

    // The member gets in with the configured password: the server derived the same key the browser does.
    await room(member.page, 'Members').click();
    await member.page.getByPlaceholder('Password...').fill('members-password');
    await member.page.getByPlaceholder('Password...').press('Enter');
    await expect(member.page.getByRole('button', { name: 'Turn on camera' })).toBeVisible({ timeout: 20_000 });

    // Stage: the admin speaks, the guest only listens.
    await room(admin.page, 'Stage').click();
    await room(guest.page, 'Stage').click();
    await expect.poll(async () => (await media(guest.page)).audio, { timeout: 20_000 }).toBe(1);
    await expect(guest.page.getByRole('button', { name: 'Raise hand' })).toBeVisible();
    await expect(admin.page.locator('.p-tile', { hasText: 'Guest' })).toBeVisible();
    expect((await media(admin.page)).audio).toBe(0);

    expect(admin.errors).toEqual([]);
    expect(member.errors).toEqual([]);
    // The browser logs the refused token request above as an error.
    expect(guest.errors.filter(e => !e.includes('status of 403'))).toEqual([]);
});


test('a server ban keeps someone out of every room, under a new device ID too', async ({ browser }) => {
    const admin = await enter(browser, 'Admin', undefined, 'e2e-admin-device');
    const guest = await enter(browser, 'Guest');
    const lobby = (page: Page) => page.locator('.channel-item', { hasText: /^Lobby/ });
    await lobby(admin.page).click();
    await lobby(guest.page).click();
    const tile = admin.page.locator('.p-tile', { hasText: 'Guest' });
    await expect(tile).toBeVisible({ timeout: 20_000 });

    await tile.click({ button: 'right' });
    await admin.page.getByRole('button', { name: 'Ban from server' }).click();
    await guest.page.waitForURL(url => !url.pathname.startsWith('/room/'), { timeout: 10_000 });

    const { device, identity, stage } = await guest.page.evaluate(async () => {
        const device = localStorage.getItem('lala-device-id')!;
        const headers = { 'X-Lala-Device': device };
        const me = await (await fetch('/api/me', { headers })).json();
        const { rooms } = await (await fetch('/api/rooms', { headers })).json();
        return { device, identity: me.identity, stage: rooms.find((r: { displayName: string }) => r.displayName === 'Stage').id };
    });
    expect((await api(guest.page, device, 'POST', '/token', { room: stage })).status).toBe(403);
    // A new device ID is a new identity, but it comes from the banned address.
    expect((await api(guest.page, 'a-brand-new-device', 'POST', '/token', { room: stage })).status).toBe(403);

    expect((await api(admin.page, 'e2e-admin-device', 'POST', '/admin/unban', { identity })).status).toBe(200);
    expect((await api(guest.page, device, 'POST', '/token', { room: stage })).status).toBe(200);
    expect(admin.errors).toEqual([]);
});

test('background blur loads its model from the app under the production CSP', async ({ browser }) => {
    // Only the loading: running blur on another person's decoded video is too heavy for CI.
    const alice = await enter(browser, 'Alice', { cameraEffect: 'blur' });
    await alice.page.getByRole('button', { name: 'Create channel' }).click();
    await alice.page.getByPlaceholder('e.g. "General"').fill('Blur room');
    await alice.page.getByRole('button', { name: 'Create', exact: true }).click();
    await alice.page.waitForURL(/\/room\//);
    const model = alice.page.waitForResponse(r => r.url().endsWith('/mediapipe/selfie_segmenter.tflite'), { timeout: 30_000 });
    await alice.page.getByRole('button', { name: 'Turn on camera' }).click();
    expect((await model).status()).toBe(200);
    // A processor that fails to start says so in the console (collected by enter()).
    await expect.poll(() => alice.page.evaluate(() => document.querySelector('video')?.videoWidth ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(alice.errors).toEqual([]);
});


/** Creates a room from the sidebar and waits until the page is in it. */
async function createRoom(page: Page, name: string, options: { stage?: boolean } = {}) {
    await page.getByRole('button', { name: 'Create channel' }).click();
    await page.getByPlaceholder('e.g. "General"').fill(name);
    if (options.stage) await page.getByLabel('Only I speak').check();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/room\//);
}

test('on a stage only the creator speaks until giving someone the floor', async ({ browser }) => {
    const alice = await enter(browser, 'Alice');
    const bob = await enter(browser, 'Bob');
    await createRoom(alice.page, 'Stage room', { stage: true });
    await bob.page.goto(alice.page.url());
    const bobTile = alice.page.locator('.p-tile', { hasText: 'Bob' });
    await expect(bobTile).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await media(bob.page)).audio, { timeout: 20_000 }).toBe(1);
    expect((await media(alice.page)).audio).toBe(0);

    // Bob asks for the floor and Alice gives it; his own mic button comes back.
    await bob.page.getByRole('button', { name: 'Raise hand' }).click();
    await expect(bobTile.getByTitle('Wants to speak')).toBeVisible();
    await bobTile.click({ button: 'right' });
    await alice.page.getByRole('button', { name: 'Let speak' }).click();
    await bob.page.getByRole('button', { name: 'Unmute microphone' }).click();
    await expect.poll(async () => (await media(alice.page)).audio, { timeout: 20_000 }).toBe(1);
    await expect(bobTile.getByTitle('Wants to speak')).toBeHidden();

    // And takes it back.
    await bobTile.click({ button: 'right' });
    await alice.page.getByRole('button', { name: 'Take the floor back' }).click();
    await expect.poll(async () => (await media(alice.page)).audio, { timeout: 20_000 }).toBe(0);
    await expect(bob.page.getByRole('button', { name: 'Raise hand' })).toBeVisible();

    expect(alice.errors).toEqual([]);
    expect(bob.errors).toEqual([]);
});

test('switching rooms keeps the microphone', async ({ browser }) => {
    const alice = await enter(browser, 'Alice');
    const bob = await enter(browser, 'Bob');
    await createRoom(alice.page, 'First room');
    await createRoom(alice.page, 'Second room');
    // Alice is now in the second room, having left the first.
    await bob.page.locator('.channel-item', { hasText: 'Second room' }).click();
    await expect.poll(async () => (await media(bob.page)).audio, { timeout: 20_000 }).toBe(1);
    expect(alice.errors).toEqual([]);
});

test('changing a media setting in a call keeps the connection and the microphone', async ({ browser }) => {
    const alice = await enter(browser, 'Alice');
    const bob = await enter(browser, 'Bob');
    let signalSockets = 0;
    alice.page.on('websocket', ws => { if (ws.url().includes('/rtc')) signalSockets++; });
    await createRoom(alice.page, 'Settings room');
    await bob.page.goto(alice.page.url());
    const aliceTrack = () => bob.page.evaluate(() => [...document.querySelectorAll('audio')]
        .flatMap(a => (a.srcObject as MediaStream | null)?.getAudioTracks() ?? [])
        .find(t => t.readyState === 'live')?.id);
    await expect.poll(aliceTrack, { timeout: 20_000 }).toBeTruthy();
    const before = await aliceTrack();

    // Echo cancellation is a capture setting: the microphone is published again.
    await alice.page.getByTitle('Settings').click();
    await alice.page.locator('.settings-row', { hasText: 'Echo cancellation' }).locator('.toggle').click();
    await alice.page.keyboard.press('Escape');
    await expect.poll(async () => { const now = await aliceTrack(); return now && now !== before; }, { timeout: 20_000 }).toBe(true);
    expect(signalSockets).toBe(1);
    expect(alice.errors).toEqual([]);
});

test('a file sent in the chat arrives whole', async ({ browser }) => {
    const alice = await enter(browser, 'Alice');
    const bob = await enter(browser, 'Bob');
    await createRoom(alice.page, 'File room');
    await bob.page.goto(alice.page.url());
    await expect(alice.page.locator('.p-tile', { hasText: 'Bob' })).toBeVisible({ timeout: 20_000 });

    const content = 'x'.repeat(200_000);
    await alice.page.getByRole('button', { name: 'Chat' }).click();
    await alice.page.locator('input[type="file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from(content) });
    await bob.page.getByRole('button', { name: 'Chat' }).click();
    const download = bob.page.getByTitle('Download');
    await expect(download).toBeVisible({ timeout: 20_000 });
    const [file] = await Promise.all([bob.page.waitForEvent('download'), download.click()]);
    expect(readFileSync(await file.path(), 'utf8')).toBe(content);
    expect(alice.errors).toEqual([]);
    expect(bob.errors).toEqual([]);
});
