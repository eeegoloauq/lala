import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { SERVER_PASSWORD } from '../playwright.config';

// Runs the desktop app from packages/desktop (npm ci there first) on an X11 display.
test('desktop connects, calls and shares a screen through its picker', async () => {
    const desktop = path.resolve(__dirname, '../../packages/desktop');
    const app = await electron.launch({
        executablePath: path.join(desktop, 'node_modules/electron/dist/electron'),
        // --no-sandbox only matters when the suite runs as root.
        args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', desktop],
        // A fresh profile: no saved servers, so no auto-connect.
        env: { ...process.env, HOME: mkdtempSync(path.join(tmpdir(), 'lala-desktop-')) },
    });
    try {
        const win = await app.firstWindow();
        await win.locator('#urlInput').fill('http://127.0.0.1:3000');
        await win.locator('#connectBtn').click();
        await win.getByLabel('Server password').fill(SERVER_PASSWORD, { timeout: 30_000 });
        await win.getByRole('button', { name: 'Continue' }).click();
        await win.getByPlaceholder('Your name...').fill('Desk');
        await win.getByRole('button', { name: 'Continue' }).click();
        // The trusted server origin gets the bridge.
        expect(await win.evaluate(() => typeof (window as { electronAPI?: unknown }).electronAPI)).toBe('object');

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
