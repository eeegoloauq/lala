import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import path from 'path';
import { SERVER_PASSWORD } from '../playwright.config';

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
