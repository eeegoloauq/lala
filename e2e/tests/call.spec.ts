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

/** Opens Lala in a fresh browser profile, passes the server password and sets a name. */
async function enter(browser: Browser, name: string, settings?: object): Promise<{ page: Page; errors: string[] }> {
    const page = await (await newClient(browser)).newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
        if (m.type() === 'error' || m.text().includes('useCameraProcessor')) errors.push(m.text());
    });
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
    // Alice publishes her camera through the background blur processor.
    const alice = await enter(browser, 'Alice', { cameraEffect: 'blur' });
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
    const bob = { page: await (await newClient(browser)).newPage(), errors: [] as string[] };
    bob.page.on('pageerror', e => bob.errors.push(e.message));
    await bob.page.goto(link);
    await bob.page.getByPlaceholder('Your name...').fill('Bob');
    await bob.page.getByRole('button', { name: 'Continue' }).click();

    await expect.poll(async () => (await media(alice.page)).audio, { timeout: 20_000 }).toBe(1);
    await expect.poll(async () => (await media(bob.page)).audio, { timeout: 20_000 }).toBe(1);

    await alice.page.getByRole('button', { name: 'Turn on camera' }).click();
    // Bob decodes Alice's encrypted, blurred video: frames have a size and keep advancing.
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
    const { rooms, deviceId, identity } = await alice.page.evaluate(async () => ({
        rooms: (await (await fetch('/api/rooms')).json()).rooms,
        deviceId: localStorage.getItem('lala-device-id'),
        identity: localStorage.getItem('lala_cached_hmac_identity'),
    }));
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
