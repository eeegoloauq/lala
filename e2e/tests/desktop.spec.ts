import { test, expect, _electron as electron } from '@playwright/test';
import { execFileSync, spawn } from 'child_process';
import { mkdtempSync } from 'fs';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import path from 'path';
import { SERVER_PASSWORD } from '../playwright.config';
import { enter } from './helpers';

// Runs the desktop app from packages/desktop (npm ci there first) on an X11 display.
function launch() {
    const desktop = path.resolve(__dirname, '../../packages/desktop');
    return electron.launch({
        executablePath: path.join(desktop, 'node_modules/electron/dist/electron'),
        // --no-sandbox only matters when the suite runs as root. No fake permission UI:
        // the app's own handlers must grant media and screen capture.
        args: ['--no-sandbox', '--use-fake-device-for-media-stream', desktop],
        // A fresh profile: no saved servers, so no auto-connect.
        env: { ...process.env, HOME: mkdtempSync(path.join(tmpdir(), 'lala-desktop-')) },
    });
}

test('desktop connects, calls and shares a screen through its picker', async () => {
    const app = await launch();
    try {
        const win = await app.firstWindow();
        await win.locator('#urlInput').fill('http://127.0.0.1:3000');
        await win.locator('#connectBtn').click();
        await win.getByLabel('Server password').fill(SERVER_PASSWORD, { timeout: 30_000 });
        await win.getByRole('button', { name: 'Continue' }).click();
        await win.getByPlaceholder('Your name...').fill('Desk');
        await win.getByRole('button', { name: 'Continue' }).click();
        // The trusted server origin gets the bridge, and its permission handlers grant the microphone.
        expect(await win.evaluate(() => typeof (window as { electronAPI?: unknown }).electronAPI)).toBe('object');
        expect(await win.evaluate(() => navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'granted', e => e.name))).toBe('granted');

        await win.getByRole('button', { name: 'Create channel' }).click();
        await win.getByPlaceholder('e.g. "General"').fill('Desk room');
        await win.getByRole('button', { name: 'Create', exact: true }).click();
        await win.waitForURL(/\/room\//);

        // The app's own picker lists desktopCapturer sources and hands the choice to the display media handler.
        await win.getByRole('button', { name: 'Share screen' }).click();
        await win.getByRole('button', { name: /^Screens/ }).click();
        await win.locator('.ss-source-tile:not(.ss-skeleton)').first().click({ timeout: 20_000 });
        await win.getByRole('button', { name: 'Start', exact: true }).click();
        await expect(win.getByRole('button', { name: 'Stop screen share' })).toBeVisible({ timeout: 20_000 });
    } finally {
        await app.close();
    }
});

test('desktop returns to the connection page when the server fails to load', async () => {
    // Healthy enough for the connection check, then a proxy error, then a dropped connection.
    let page = 0;
    const server = createServer((req, res) => {
        if (req.url === '/api/health') return res.end('{}');
        if (++page === 1) {
            res.statusCode = 502;
            return res.end('Bad Gateway');
        }
        req.socket.destroy();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const app = await launch();
    try {
        const win = await app.firstWindow();
        const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
        for (const error of ['Server error: 502', /EMPTY_RESPONSE|Connection failed/]) {
            await win.locator('#urlInput').fill(url);
            await win.locator('#connectBtn').click();
            await expect(win.locator('#errorMsg')).toHaveText(error, { timeout: 20_000 });
            expect(await visible()).toBe(true);
        }
    } finally {
        await app.close();
        server.close();
    }
});

test('desktop reloads after a renderer crash and falls back to the connection page in a crash loop', async () => {
    const app = await launch();
    // Playwright drops a page whose renderer crashed, so the checks run in the main process.
    const crash = () => app.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents;
        return new Promise<void>(resolve => {
            contents.once('render-process-gone', () => resolve());
            contents.forcefullyCrashRenderer();
        });
    });
    const page = () => app.evaluate(async ({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents;
        if (contents.isCrashed() || contents.isLoading()) return null;
        return contents.executeJavaScript(
            "document.getElementById('connectBtn') ? document.getElementById('errorMsg').textContent : null",
        ).catch(() => null);
    });
    try {
        await app.firstWindow();
        await expect.poll(page, { timeout: 20_000 }).toBe('');

        // The first two crashes in a burst reload the page.
        for (let i = 0; i < 2; i++) {
            await crash();
            await expect.poll(page, { timeout: 20_000 }).toBe('');
        }

        // The third falls back to the connection page with a notice.
        await crash();
        await expect.poll(page, { timeout: 20_000 }).toMatch(/crashed several times/);
        // A fourth would close the app behind a native error box, which the test cannot dismiss.
    } finally {
        await app.close();
    }
});

/** A session bus and Python's D-Bus bindings, which the fake player needs. */
function canFakePlayer(): boolean {
    try {
        execFileSync('busctl', ['--user', 'list'], { stdio: 'ignore' });
        execFileSync('python3', ['-c', 'import dbus, gi'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

test('desktop asks once, then shows what plays to everyone', async ({ browser }) => {
    test.skip(process.platform !== 'linux' || !canFakePlayer(), 'needs a D-Bus session and python3-dbus');
    const run = Date.now().toString(36);
    const title = `Night Drive ${run}`;
    const cover = path.join(mkdtempSync(path.join(tmpdir(), 'lala-cover-')), 'cover.png');
    const player = spawn('python3', [path.join(__dirname, 'fixtures/fake-mpris.py'), `e2eplayer${run}`, 'E2E Player', title, cover], { stdio: 'ignore' });
    const app = await launch();
    try {
        const win = await app.firstWindow();
        await win.locator('#urlInput').fill('http://127.0.0.1:3000');
        await win.locator('#connectBtn').click();
        await win.getByLabel('Server password').fill(SERVER_PASSWORD, { timeout: 30_000 });
        await win.getByRole('button', { name: 'Continue' }).click();
        await win.getByPlaceholder('Your name...').fill(`Desk ${run}`);
        await win.getByRole('button', { name: 'Continue' }).click();

        // Nothing leaves before the answer.
        const prompt = win.getByRole('dialog', { name: 'Show what you play and listen to?' });
        await expect(prompt).toContainText(title, { timeout: 20_000 });
        await prompt.getByRole('button', { name: 'Show', exact: true }).click();

        // Someone in a browser sees the song in the list and on the card, with the cover from this server.
        const viewer = await enter(browser, `Viewer ${run}`);
        const row = viewer.page.locator('.people-row', { hasText: `Desk ${run}` });
        await expect(row).toContainText(title, { timeout: 20_000 });
        await row.click();
        const card = viewer.page.getByRole('dialog', { name: `Profile of Desk ${run}` });
        await expect(card).toContainText('E2E Player');
        await expect(card).toContainText('by Coastal Lines');
        await expect(card.locator('.profile-activity-image img')).toHaveAttribute('src', /^\/api\/presence\/images\/[0-9a-f]{16}$/);
        expect(await card.locator('.profile-activity-image img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);

        // Turned off in Settings, it goes away for the viewer.
        await win.getByRole('button', { name: 'Settings' }).first().click();
        const toggle = win.getByRole('checkbox', { name: 'Show what I play and listen to' });
        await win.locator('label.toggle', { has: toggle }).click();
        await expect(toggle).not.toBeChecked();
        await expect(row).not.toContainText(title, { timeout: 20_000 });
    } finally {
        await app.close();
        player.kill();
    }
});
