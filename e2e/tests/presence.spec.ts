import { test, expect, type Page } from '@playwright/test';
import { createRoom, enter } from './helpers';

test.afterEach(async ({ browser }) => {
    await Promise.all(browser.contexts().map(c => c.close()));
});

// The identity e2e/lala-e2e.yaml names as `member`; nobody in this test uses it.
const MEMBER = '9046178020158a6b425b6646b40e25c2ca74';

/** Someone's row in the people list on `page`, in the group named `group`. */
const row = (page: Page, group: string, name: string) =>
    page.getByRole('complementary', { name: 'People' }).getByRole('region', { name: group }).locator('.people-row', { hasText: name });

const pickStatus = async (page: Page, status: string) => {
    await page.getByRole('button', { name: 'Set your status' }).click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${status}`) }).click();
};

test('people see who is online, their status, who is in a call and who left', async ({ browser }) => {
    // Every test shares the server, so the names are this run's own.
    const run = Date.now().toString(36);
    const [aliceName, bobName] = [`Alice ${run}`, `Bob ${run}`];
    const alice = await enter(browser, aliceName);
    const bob = await enter(browser, bobName);

    // Both have the app open; a member of the config who doesn't is listed as offline.
    await expect(row(alice.page, 'Online', bobName)).toBeVisible();
    await expect(row(bob.page, 'Online', aliceName)).toBeVisible();
    await expect(alice.page.locator(`.people-row[data-person="${MEMBER}"]`)).toBeVisible();

    // A status others see, then invisible: gone from their list, offline in Bob's own.
    await pickStatus(bob.page, 'Do Not Disturb');
    await expect(row(alice.page, 'Online', bobName).getByRole('img', { name: 'Do Not Disturb' })).toBeVisible();
    await pickStatus(bob.page, 'Invisible');
    await expect(alice.page.locator('.people-row', { hasText: bobName })).toHaveCount(0);
    await expect(row(bob.page, 'Offline', bobName)).toBeVisible();
    await pickStatus(bob.page, 'Online');
    await expect(row(alice.page, 'Online', bobName).getByRole('img', { name: 'Online' })).toBeVisible();

    // In a call, under the room's name.
    const roomName = `People ${run}`;
    await createRoom(bob.page, roomName);
    await expect(row(alice.page, 'In a call', bobName)).toContainText(roomName);

    // Out of the call he is online again; closing the app takes him off the list
    // without waiting for his heartbeats to stop.
    await bob.page.getByRole('button', { name: 'Leave call' }).click();
    await expect(row(alice.page, 'Online', bobName)).toBeVisible({ timeout: 20_000 });
    await bob.page.context().close();
    await expect(alice.page.locator('.people-row', { hasText: bobName })).toHaveCount(0, { timeout: 15_000 });

    expect(alice.errors).toEqual([]);
});
