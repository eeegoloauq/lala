import { test, expect, type Browser, type Page } from '@playwright/test';
import { SERVER_PASSWORD } from '../playwright.config';

/** Opens Lala in a fresh browser profile, passes the server password and sets a name. */
async function enter(browser: Browser, name: string, settings?: object): Promise<{ page: Page; errors: string[] }> {
    const page = await (await browser.newContext()).newPage();
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

    await page.getByLabel('Server password').fill(SERVER_PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByPlaceholder('Your name...')).toBeVisible();
    await page.reload();
    await expect(page.getByPlaceholder('Your name...')).toBeVisible();
});

test('two people talk in a password room', async ({ browser }) => {
    // Alice publishes her camera through the background blur processor.
    const alice = await enter(browser, 'Alice', { cameraEffect: 'blur' });
    await alice.page.getByRole('button', { name: 'Create channel' }).click();
    await alice.page.getByPlaceholder('e.g. "General"').fill('E2E room');
    await alice.page.getByPlaceholder('No password — open channel').fill('room-password');
    await alice.page.getByRole('button', { name: 'Create', exact: true }).click();
    await alice.page.waitForURL(/\/room\//);

    // Bob joins through an invite link, which carries the room password (and E2EE key).
    const bob = await enter(browser, 'Bob');
    await bob.page.goto(alice.page.url() + '#pw=room-password');

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

    // Server mute revokes Bob's publish permission, so his microphone track goes away.
    await adminAction('Server mute');
    await expect(alice.page.locator('.p-tile', { hasText: 'Bob' }).getByTitle('Muted by admin')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await media(alice.page)).audio, { timeout: 10_000 }).toBe(0);
    await adminAction('Allow microphone');
    await expect(alice.page.locator('.p-tile', { hasText: 'Bob' }).getByTitle('Muted by admin')).toBeHidden({ timeout: 10_000 });

    // A kicked participant lands back on the lobby and may rejoin.
    await adminAction('Kick');
    await bob.page.waitForURL(url => !url.pathname.startsWith('/room/'), { timeout: 10_000 });
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
