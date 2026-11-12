import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { ADMIN_CLAIM, SERVER_PASSWORD } from '../playwright.config';
import { api, createRoom, enter, media, openPage, serverTracks } from './helpers';

// Participants of one test must not linger in the next one's rooms.
test.afterEach(async ({ browser }) => {
    await Promise.all(browser.contexts().map(c => c.close()));
});

test('server password keeps the app closed', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Server password').fill('wrong-password');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toHaveText('Wrong password');
    await expect(page.getByText('Rooms', { exact: true })).toBeHidden();

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

test('the admin link from setup.sh does nothing on a server that has an admin', async ({ browser }) => {
    const guest = await enter(browser, 'Guest');
    // Opened as a link: a fresh load, not a change of the hash on the open page.
    await guest.page.goto(`/#claim=${ADMIN_CLAIM}`);
    await guest.page.reload();
    await expect(guest.page.getByText('Rooms', { exact: true })).toBeVisible();
    // The token leaves the address bar either way.
    expect(new URL(guest.page.url()).hash).toBe('');
    const deviceId = await guest.page.evaluate(() => localStorage.getItem('lala-device-id') ?? '');
    expect((await api(guest.page, deviceId, 'GET', '/me')).body.role).toBe('guest');
    expect((await api(guest.page, deviceId, 'POST', '/claim', { token: ADMIN_CLAIM })).status).toBe(403);
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

    // Alice copies the invite link from the room's menu: it carries the room password (the E2EE key) and a server invite.
    const room = alice.page.locator('.channel-item', { hasText: 'E2E room' });
    await room.click({ button: 'right' });
    const menu = alice.page.locator('.ctx-menu');
    await menu.getByRole('button', { name: 'Copy invite link' }).click();
    await expect(menu.getByRole('button', { name: 'Link copied' })).toBeVisible();
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
    // Decoding alone would pass unencrypted too: the media server must see only encrypted
    // tracks, the two microphones and the camera.
    const tracks = await serverTracks(new URL(alice.page.url()).pathname.split('/').pop()!);
    expect(tracks).toHaveLength(3);
    expect(tracks.map(t => t.encryption)).toEqual(['GCM', 'GCM', 'GCM']);

    await alice.page.getByRole('button', { name: 'Chat' }).click();
    await alice.page.getByPlaceholder('Send a message...').fill('hello from alice');
    await alice.page.getByPlaceholder('Send a message...').press('Enter');
    await bob.page.getByRole('button', { name: 'Chat' }).click();
    await expect(bob.page.getByText('hello from alice')).toBeVisible();

    expect(alice.errors).toEqual([]);
    expect(bob.errors).toEqual([]);
});

test('avatars come from the server: in the room list before joining, then in the call', async ({ browser }) => {
    // A 1x1 PNG: any JPEG, PNG or WebP is an avatar.
    const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    // Set before avatars were kept on the server: the app uploads it on its own.
    const alice = await enter(browser, 'Alice');
    await alice.page.evaluate(url => localStorage.setItem('lala_my_avatar', url), avatar);
    await alice.page.reload();
    await createRoom(alice.page, 'Avatar room');
    const roomId = new URL(alice.page.url()).pathname.split('/').pop();

    // Bob has never seen Alice. Her picture is in the room list before he joins, and loads.
    const bob = await enter(browser, 'Bob');
    const row = bob.page.locator(`.channel-user-card[data-participant-room="${roomId}"]`, { hasText: 'Alice' }).locator('img');
    await expect(row).toHaveAttribute('src', /^\/api\/avatars\/[0-9a-f]{36}\?v=[0-9a-f]{16}$/, { timeout: 10_000 });
    await expect.poll(() => row.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    const src = await row.getAttribute('src');

    // The URL never changes its content, so browsers keep it; it is only ever an image.
    const headers = await bob.page.evaluate(async url => {
        const res = await fetch(url);
        return { type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), sniff: res.headers.get('x-content-type-options') };
    }, src!);
    expect(headers).toEqual({ type: 'image/png', cache: 'private, max-age=31536000, immutable', sniff: 'nosniff' });
    // Anything that isn't an image is refused.
    const upload = await bob.page.evaluate(async () => (await fetch('/api/me/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'X-Lala-Device': localStorage.getItem('lala-device-id') ?? '' },
        body: '<svg onload="alert(1)"/>',
    })).status);
    expect(upload).toBe(400);
    expect(bob.errors.splice(0)).toEqual([expect.stringContaining('status of 400')]);

    await bob.page.goto(alice.page.url());
    await expect(bob.page.locator('.p-tile', { hasText: 'Alice' }).locator(`img[src="${src}"]`)).toBeVisible({ timeout: 20_000 });

    expect(alice.errors).toEqual([]);
    expect(bob.errors).toEqual([]);
});

test('on a phone, a tap beside the open sidebar closes it', async ({ browser }) => {
    const alice = await enter(browser, 'Alice');
    await alice.page.setViewportSize({ width: 390, height: 844 });
    await createRoom(alice.page, 'Phone room');

    const drawer = alice.page.locator('.sidebar-wrapper');
    await alice.page.getByRole('button', { name: 'Show the room list' }).click();
    await expect(drawer).toHaveClass(/sidebar-mobile-open/);
    // The call stays visible at the right edge, beside the drawer.
    await alice.page.mouse.click(380, 422);
    await expect(drawer).not.toHaveClass(/sidebar-mobile-open/);

    expect(alice.errors).toEqual([]);
});

test('a dropped connection gets back into the call, still muted', async ({ browser }) => {
    test.setTimeout(150_000);
    const alice = await enter(browser, 'Alice');
    await createRoom(alice.page, 'Rejoin room');
    const bob = await enter(browser, 'Bob');
    await bob.page.goto(alice.page.url());
    const bobTile = alice.page.locator('.p-tile', { hasText: 'Bob' });
    await expect(bobTile).toBeVisible({ timeout: 20_000 });
    await bob.page.getByRole('button', { name: 'Mute microphone' }).click();
    await expect(bobTile.getByTitle('Microphone off')).toBeVisible({ timeout: 10_000 });

    // Offline until LiveKit gives up on its own reconnect, then the app keeps trying.
    await bob.page.context().setOffline(true);
    await expect(bob.page.getByRole('status')).toHaveText(/Reconnecting/, { timeout: 90_000 });
    await bob.page.context().setOffline(false);

    // Back in the call, not on the home screen, and the microphone is still off.
    await expect(bob.page.getByRole('button', { name: 'Unmute microphone' })).toBeVisible({ timeout: 45_000 });
    expect(new URL(bob.page.url()).pathname).toBe(new URL(alice.page.url()).pathname);
    await expect(bobTile.getByTitle('Microphone off')).toBeVisible({ timeout: 20_000 });
    expect(alice.errors).toEqual([]);
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
    // The sidebar shows the same mute, and lifts it from its own menu.
    // Earlier tests' people can still be listed for a moment: only this room's Bob.
    const roomId = new URL(alice.page.url()).pathname.split('/').pop();
    const sidebarBob = alice.page.locator(`.channel-user-card[data-participant-room="${roomId}"]`, { hasText: 'Bob' });
    await expect(sidebarBob.getByTitle('Muted by admin')).toBeVisible({ timeout: 10_000 });
    await sidebarBob.click({ button: 'right' });
    await alice.page.locator('.ctx-menu').getByRole('button', { name: 'Allow microphone' }).click();
    await expect(alice.page.locator('.p-tile', { hasText: 'Bob' }).getByTitle('Muted by admin')).toBeHidden({ timeout: 10_000 });
    await expect(sidebarBob.getByTitle('Muted by admin')).toBeHidden({ timeout: 10_000 });

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
    // Not with a new device ID from the same address, nor without one.
    expect((await api(bob.page, 'a-brand-new-device', 'POST', '/token', { room: roomId })).status).toBe(403);
    const anonymous = await bob.page.evaluate(async room => (await fetch('/api/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room }),
    })).status, roomId);
    expect(anonymous).toBe(400);
    bob.errors.splice(0);

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

    // Listed while empty, first and in config order (the text chats come before the rooms).
    await expect(guest.page.locator('.channel-item:not(.text-item)').nth(0)).toContainText('Lobby');
    await expect(guest.page.locator('.channel-item:not(.text-item)').nth(1)).toContainText('Stage');

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


test('on a stage only the creator speaks until giving someone the floor', async ({ browser }) => {
    const alice = await enter(browser, 'Alice');
    const bob = await enter(browser, 'Bob');
    await createRoom(alice.page, 'Stage room', { stage: true });
    const roomId = new URL(alice.page.url()).pathname.split('/').pop();
    await bob.page.goto(alice.page.url());
    const bobTile = alice.page.locator('.p-tile', { hasText: 'Bob' });
    await expect(bobTile).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await media(bob.page)).audio, { timeout: 20_000 }).toBe(1);
    expect((await media(alice.page)).audio).toBe(0);

    // The sidebar menu knows from the room list that Bob may not speak.
    const sidebarBob = alice.page.locator(`.channel-user-card[data-participant-room="${roomId}"]`, { hasText: 'Bob' });
    await sidebarBob.click({ button: 'right' });
    await expect(alice.page.getByRole('button', { name: 'Let speak' })).toBeVisible();
    await alice.page.keyboard.press('Escape');

    // Bob asks for the floor and Alice gives it; his own mic button comes back.
    await bob.page.getByRole('button', { name: 'Raise hand' }).click();
    await expect(bobTile.getByTitle('Wants to speak')).toBeVisible();
    await bobTile.click({ button: 'right' });
    await alice.page.getByRole('button', { name: 'Let speak' }).click();
    await bob.page.getByRole('button', { name: 'Unmute microphone' }).click();
    await expect.poll(async () => (await media(alice.page)).audio, { timeout: 20_000 }).toBe(1);
    await expect(bobTile.getByTitle('Wants to speak')).toBeHidden();
    // The sidebar now offers to take it back.
    await sidebarBob.click({ button: 'right' });
    await expect(alice.page.getByRole('button', { name: 'Take the floor back' })).toBeVisible();
    await alice.page.keyboard.press('Escape');

    // And takes it back.
    await bobTile.click({ button: 'right' });
    await alice.page.getByRole('button', { name: 'Take the floor back' }).click();
    await expect.poll(async () => (await media(alice.page)).audio, { timeout: 20_000 }).toBe(0);
    await expect(bob.page.getByRole('button', { name: 'Raise hand' })).toBeVisible();

    expect(alice.errors).toEqual([]);
    expect(bob.errors).toEqual([]);
});

test('a moderator moves someone between rooms they moderate, by menu or by dragging', async ({ browser }) => {
    const alice = await enter(browser, 'Alice');
    const bob = await enter(browser, 'Bob');
    const carol = await enter(browser, 'Carol');
    const roomOf = (page: Page) => new URL(page.url()).pathname.split('/').pop()!;
    // One name is one live room; a run's own names keep a repeat out of the last run's rooms.
    const run = Date.now().toString(36);
    const [sideName, lobbyName, lockedName, backName] = ['Side', 'Lobby', 'Locked', 'Back'].map(n => `${n} ${run}`);
    // A created room ends once empty, so each destination keeps someone in it.
    await createRoom(alice.page, sideName);
    const side = roomOf(alice.page);
    await carol.page.goto(alice.page.url());
    await createRoom(alice.page, lobbyName);
    const lobby = roomOf(alice.page);
    await bob.page.goto(alice.page.url());
    await expect(alice.page.locator('.p-tile', { hasText: 'Bob' })).toBeVisible({ timeout: 20_000 });
    await createRoom(alice.page, lockedName, { password: 'move-test-password' });
    const locked = roomOf(alice.page);
    const sidebarBob = (room: string) => alice.page.locator(`.channel-user-card[data-participant-room="${room}"]`, { hasText: 'Bob' });

    // From the menu: Alice's open rooms are offered, the password room is not.
    await sidebarBob(lobby).click({ button: 'right' });
    await alice.page.getByRole('button', { name: 'Move to…' }).click();
    const moves = alice.page.locator('.ctx-menu-moves');
    await expect(moves.getByRole('button', { name: sideName })).toBeVisible();
    await expect(moves.getByRole('button', { name: lockedName })).toHaveCount(0);
    await moves.getByRole('button', { name: sideName }).click();
    await bob.page.waitForURL(`**/room/${side}`);
    // He arrives talking, as when switching rooms himself.
    await expect.poll(async () => (await media(carol.page)).audio, { timeout: 20_000 }).toBe(1);

    // The server refuses what the menu doesn't offer, and anyone but a moderator of both.
    // Those refusals log on the pages that ask; nothing else may.
    for (const { errors } of [alice, bob, carol]) expect(errors).toEqual([]);
    const device = await alice.page.evaluate(() => localStorage.getItem('lala-device-id')!);
    const bobId = await bob.page.evaluate(async () => (await (await fetch('/api/me', { headers: { 'X-Lala-Device': localStorage.getItem('lala-device-id')! } })).json()).identity);
    const intoLocked = await api(alice.page, device, 'POST', `/rooms/${side}/admin/move`, { identity: bobId, to: locked });
    expect(intoLocked).toEqual({ status: 400, body: { error: 'password_room' } });
    const byOther = await api(bob.page, 'someone-else', 'POST', `/rooms/${side}/admin/move`, { identity: bobId, to: locked });
    expect(byOther.status).toBe(403);
    for (const { errors } of [alice, bob]) errors.splice(0, errors.length, ...errors.filter(e => !/status of 40[03]/.test(e)));

    // By dragging his row onto another room. The events go to the two elements rather
    // than to screen positions: rooms ending above would shift the list under a mouse drag.
    await createRoom(alice.page, backName);
    const back = roomOf(alice.page);
    const dataTransfer = await alice.page.evaluateHandle(() => new DataTransfer());
    const backItem = alice.page.locator('.channel-item', { hasText: backName });
    await sidebarBob(side).dispatchEvent('dragstart', { dataTransfer });
    await backItem.dispatchEvent('dragover', { dataTransfer });
    await expect(backItem).toHaveClass(/channel-item-drop/);
    await backItem.dispatchEvent('drop', { dataTransfer });
    await sidebarBob(side).dispatchEvent('dragend', { dataTransfer });
    await bob.page.waitForURL(`**/room/${back}`);
    await expect(alice.page.locator('.p-tile', { hasText: 'Bob' })).toBeVisible({ timeout: 20_000 });

    for (const { errors } of [alice, bob, carol]) expect(errors).toEqual([]);
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
    // A picked file waits in the box's tray until it is sent.
    await alice.page.locator('input[type="file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from(content) });
    await alice.page.getByTitle('Send').click();
    await bob.page.getByRole('button', { name: 'Chat' }).click();
    const download = bob.page.getByTitle('Download');
    await expect(download).toBeVisible({ timeout: 20_000 });
    const [file] = await Promise.all([bob.page.waitForEvent('download'), download.first().click()]);
    expect(readFileSync(await file.path(), 'utf8')).toBe(content);

    // The sender names the type: an SVG (which can carry script) arrives as a download, not a picture.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    await alice.page.locator('input[type="file"]').setInputFiles({ name: 'pic.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
    await alice.page.getByTitle('Send').click();
    await expect(download).toHaveCount(2, { timeout: 20_000 });
    await expect(bob.page.locator('.cp-file-thumb')).toHaveCount(0);
    const [svgFile] = await Promise.all([bob.page.waitForEvent('download'), download.nth(1).click()]);
    expect(readFileSync(await svgFile.path(), 'utf8')).toBe(svg);
    expect(alice.errors).toEqual([]);
    expect(bob.errors).toEqual([]);
});
