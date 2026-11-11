import { test, expect, type Page } from '@playwright/test';
import { enter } from './helpers';

test.afterEach(async ({ browser }) => {
    await Promise.all(browser.contexts().map(c => c.close()));
});

const look = (page: Page) => page.evaluate(() => {
    const root = document.documentElement;
    return {
        theme: root.dataset.theme,
        accent: root.style.getPropertyValue('--accent'),
        radius: root.style.getPropertyValue('--border-radius'),
    };
});

async function pickTheme(page: Page, label: string) {
    await page.getByTitle('Settings').click();
    await page.locator('.settings-nav-item', { hasText: 'Appearance' }).click();
    const row = page.locator('.settings-row', { hasText: 'Theme' }).first();
    await row.locator('.lala-select-trigger').click();
    await row.locator('.lala-select-option', { hasText: label }).click();
}

test('the server theme is the default until someone picks their own', async ({ browser }) => {
    const { page, errors } = await enter(browser, 'Painter');
    // lala-e2e.yaml: light with a blue accent and smaller corners.
    await expect.poll(() => look(page)).toEqual({ theme: 'light', accent: '#3366ff', radius: '4px' });

    await pickTheme(page, 'Dark');
    await expect.poll(() => look(page)).toEqual({ theme: 'dark', accent: '', radius: '' });

    // The choice stays; the server's colors don't come back over it.
    await page.reload();
    await expect.poll(() => look(page)).toEqual({ theme: 'dark', accent: '', radius: '' });
    expect(errors).toEqual([]);
});

test('CSS a user adds applies on their device only', async ({ browser }) => {
    const { page } = await enter(browser, 'Stylist');
    const sent: string[] = [];
    page.on('request', r => { if (r.postData()) sent.push(r.postData()!); });

    await page.getByTitle('Settings').click();
    await page.locator('.settings-nav-item', { hasText: 'Appearance' }).click();
    await page.getByLabel('Custom CSS').fill('.sidebar-header { outline: 3px solid rgb(1, 2, 3); }');
    await expect.poll(() => page.locator('.sidebar-header').evaluate(e => getComputedStyle(e).outlineColor)).toBe('rgb(1, 2, 3)');

    await page.reload();
    await expect.poll(() => page.locator('.sidebar-header').evaluate(e => getComputedStyle(e).outlineColor)).toBe('rgb(1, 2, 3)');
    expect(sent.some(body => body.includes('rgb(1, 2, 3)'))).toBe(false);

    // Someone else sees none of it.
    const other = await enter(browser, 'Viewer');
    expect(await other.page.locator('.sidebar-header').evaluate(e => getComputedStyle(e).outlineColor)).not.toBe('rgb(1, 2, 3)');
});
