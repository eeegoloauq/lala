import { test, expect, type Browser, type Page } from '@playwright/test';
import { LIVEKIT_KEY, LIVEKIT_SECRET, SERVER_PASSWORD } from '../playwright.config';

// Each person in a test is a separate client to the API, as they would be in real use:
// per-address limits (rate limits, SSE connections) must not add up across tests.
let clients = 0;
export async function newClient(browser: Browser) {
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
export async function openPage(browser: Browser): Promise<{ page: Page; errors: string[] }> {
    const page = await (await newClient(browser)).newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
        if (m.type() === 'error' || m.text().includes('useCameraProcessor')) errors.push(m.text());
    });
    return { page, errors };
}

/** Opens Lala, passes the server password and sets a name; a fixed device ID makes it a person from lala-e2e.yaml. */
export async function enter(browser: Browser, name: string, settings?: object, deviceId?: string): Promise<{ page: Page; errors: string[] }> {
    const { page, errors } = await openPage(browser);
    if (deviceId) await page.addInitScript(id => localStorage.setItem('lala-device-id', id), deviceId);
    if (settings) await page.addInitScript(s => localStorage.setItem('lala-settings', s), JSON.stringify(settings));
    await page.goto('/');
    await page.getByLabel('Server password').fill(SERVER_PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByPlaceholder('Your name...').fill(name);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Rooms', { exact: true })).toBeVisible();
    return { page, errors };
}

/** Live remote audio elements and decoded video sizes on the page. */
export const media = (page: Page) => page.evaluate(() => ({
    audio: [...document.querySelectorAll('audio')]
        .filter(a => (a.srcObject as MediaStream | null)?.getAudioTracks().some(t => t.readyState === 'live')).length,
    videos: [...document.querySelectorAll('video')].map(v => ({ width: v.videoWidth, time: v.currentTime })),
}));

export const api = (page: Page, device: string, method: string, path: string, body?: object) =>
    page.evaluate(async ({ device, method, path, body }) => {
        const res = await fetch(`/api${path}`, {
            method,
            headers: { 'X-Lala-Device': device, 'Content-Type': 'application/json' },
            body: body && JSON.stringify(body),
        });
        return { status: res.status, body: await res.json() };
    }, { device, method, path, body });

/** Creates a room from the sidebar and waits until the page is in it. */
export async function createRoom(page: Page, name: string, options: { stage?: boolean; password?: string } = {}) {
    await page.getByRole('button', { name: 'Create channel' }).click();
    await page.getByPlaceholder('e.g. "General"').fill(name);
    if (options.password) await page.getByPlaceholder('No password — open channel').fill(options.password);
    if (options.stage) await page.getByLabel('Only I speak').check();
    const before = page.url();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    // From one room to another the URL changes from one /room/ to the next.
    await page.waitForURL(url => url.href !== before && url.pathname.includes('/room/'));
}

/**
 * The tracks LiveKit has for a room, from its server API with the e2e keys: what the media
 * server itself sees, such as whether a track is end-to-end encrypted.
 */
export async function serverTracks(room: string): Promise<Array<{ source?: string; encryption?: string }>> {
    const { createHmac } = await import('node:crypto');
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: LIVEKIT_KEY, nbf: now - 10, exp: now + 60, video: { roomAdmin: true, room } })}`;
    const jwt = `${unsigned}.${createHmac('sha256', LIVEKIT_SECRET).update(unsigned).digest('base64url')}`;
    const res = await fetch('http://127.0.0.1:7880/twirp/livekit.RoomService/ListParticipants', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ room }),
    });
    if (!res.ok) throw new Error(`ListParticipants: ${res.status} ${await res.text()}`);
    const { participants = [] } = await res.json() as { participants?: Array<{ tracks?: Array<{ source?: string; encryption?: string }> }> };
    return participants.flatMap(p => p.tracks ?? []);
}
