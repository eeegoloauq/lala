import { crc32, deflateSync } from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { enter } from './helpers';

test.afterEach(async ({ browser }) => {
    await Promise.all(browser.contexts().map(c => c.close()));
});

/** A real PNG of one color, so the browser can draw it. */
function png(width: number, height: number): Buffer {
    const chunk = (type: string, data: Buffer) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(data.length, 0);
        head.write(type, 4, 'latin1');
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
        return Buffer.concat([head, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
    const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
    return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}

/** An API request from the page as a device; answers without a body (204) give none. */
const api = (page: Page, deviceId: string, method: string, path: string, body?: object) =>
    page.evaluate(async ({ deviceId, method, path, body }) => {
        const res = await fetch(`/api${path}`, {
            method,
            headers: { 'X-Lala-Device': deviceId, 'Content-Type': 'application/json' },
            body: body && JSON.stringify(body),
        });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : undefined };
    }, { deviceId, method, path, body });

/** A file as the browser gets it, with the access cookie: its status and headers. */
const fetchFile = (page: Page, url: string) =>
    page.evaluate(async (url) => {
        const res = await fetch(url);
        return { status: res.status, headers: Object.fromEntries(res.headers) };
    }, url);

const device = (page: Page) => page.evaluate(() => localStorage.getItem('lala-device-id') ?? '');

/** Uploads a file the way the client does; the answer's attachment. */
const upload = (page: Page, deviceId: string, name: string, type: string, body: string) =>
    page.evaluate(async ({ deviceId, name, type, body }) => {
        const res = await fetch('/api/chats/general/files', {
            method: 'POST',
            headers: { 'X-Lala-Device': deviceId, 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) },
            body,
        });
        return (await res.json()).attachment as { id: string; type: string; url: string };
    }, { deviceId, name, type, body });

test('text chats: a message with a picture reaches others, admins pin, deletes reach everyone', async ({ browser }) => {
    const alice = await enter(browser, 'Alice');
    const admin = await enter(browser, 'Admin', undefined, 'e2e-admin-device');

    // The rules from the config are listed, and the chats under them.
    await expect(alice.page.getByRole('button', { name: 'general' })).toBeVisible();
    await alice.page.getByRole('button', { name: 'general' }).click();
    await admin.page.getByRole('button', { name: 'general' }).click();

    const box = alice.page.getByPlaceholder('Message #general');
    await alice.page.locator('input[type="file"]').setInputFiles({ name: 'square.png', mimeType: 'image/png', buffer: png(48, 32) });
    await box.fill('hello from alice in #general');
    await box.press('Enter');

    // The admin's page gets it from the event stream, with the sender's name and the picture.
    const message = admin.page.locator('.tc-msg', { hasText: 'hello from alice in #general' });
    await expect(message).toBeVisible({ timeout: 10_000 });
    await expect(message).toContainText('Alice');
    const picture = message.locator('img[alt="square.png"]');
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => `${img.naturalWidth}x${img.naturalHeight}`), { timeout: 10_000 }).toBe('48x32');

    // Only admins post in #announcements.
    await alice.page.getByRole('button', { name: 'announcements' }).click();
    await expect(alice.page.getByPlaceholder('Message #announcements')).toBeHidden();
    await alice.page.getByRole('button', { name: 'general' }).click();

    // The requests below fail on purpose, and the browser logs each failure.
    expect(alice.errors).toEqual([]);
    const aliceDevice = await device(alice.page);
    const { body: page } = await api(alice.page, aliceDevice, 'GET', '/chats/general/messages');
    const sent = page.messages.find((m: { text: string }) => m.text === 'hello from alice in #general');
    expect(sent.attachments[0]).toMatchObject({ name: 'square.png', type: 'image/png', width: 48, height: 32 });

    // Pins are for admins.
    expect((await api(alice.page, aliceDevice, 'PUT', `/chats/general/pins/${sent.id}`)).status).toBe(403);
    expect((await api(admin.page, 'e2e-admin-device', 'PUT', `/chats/general/pins/${sent.id}`)).status).toBe(204);
    const pins = await api(alice.page, aliceDevice, 'GET', '/chats/general/pins');
    expect(pins.body.messages.map((m: { id: string }) => m.id)).toEqual([sent.id]);

    // Anyone deletes their own message, and it goes for everyone, file and all.
    expect((await api(alice.page, aliceDevice, 'DELETE', `/chats/general/messages/${sent.id}`)).status).toBe(204);
    await expect(message).toBeHidden({ timeout: 10_000 });
    expect((await fetchFile(alice.page, sent.attachments[0].url)).status).toBe(404);

    expect(admin.errors).toEqual([]);
});

test('text chat files: the server names the type, and only pictures and media show inline', async ({ browser }) => {
    const alice = await enter(browser, 'Alice');
    const deviceId = await device(alice.page);

    // An SVG can carry script: whatever the sender claims, it is a download.
    const svg = await upload(alice.page, deviceId, 'pic.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(svg.type).toBe('application/octet-stream');
    const served = await fetchFile(alice.page, svg.url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('application/octet-stream');
    expect(served.headers['content-disposition']).toMatch(/^attachment; filename="pic\.svg"/);
    expect(served.headers['content-security-policy']).toContain("default-src 'none'");

    // Over the server's limit for one file (2MB in lala-e2e.yaml).
    const big = await alice.page.evaluate(async (deviceId) => {
        const res = await fetch('/api/chats/general/files', {
            method: 'POST',
            headers: { 'X-Lala-Device': deviceId, 'Content-Type': 'application/octet-stream' },
            body: new Uint8Array(3 * 1024 * 1024),
        });
        return res.status;
    }, deviceId);
    expect(big).toBe(413);

    // An upload is the uploader's own: nobody else can send it.
    const other = await enter(browser, 'Other');
    const stolen = await api(other.page, await device(other.page), 'POST', '/chats/general/messages', { text: 'mine now', attachments: [{ id: svg.id }] });
    expect(stolen.status).toBe(400);
});
