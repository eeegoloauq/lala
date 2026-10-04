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
