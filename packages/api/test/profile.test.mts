import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const { parseProfile, profileChanged, shownProfile, safeActivityUrl } = await import('../src/lib/profile');

const NOW = 1_800_000_000_000;
const IMG = '0123456789abcdef';

describe('a profile from a client', () => {
    test('times become the server clock', () => {
        const playing = parseProfile({ activity: { kind: 'playing', name: 'Factorio', elapsedMs: 60_000 } }, NOW);
        assert.deepEqual(playing, { activity: { kind: 'playing', name: 'Factorio', startedAt: NOW - 60_000 } });
        const listening = parseProfile({ activity: { kind: 'listening', title: 'Song', player: 'Legato', durationMs: 200_000, positionMs: 5000 } }, NOW);
        assert.deepEqual(listening?.activity, { kind: 'listening', title: 'Song', player: 'Legato', durationMs: 200_000, positionMs: 5000, positionAt: NOW });
    });

    test('a position past the end is held at the end, and a negative one is dropped', () => {
        const over = parseProfile({ activity: { kind: 'listening', title: 'S', player: 'P', durationMs: 1000, positionMs: 5000 } }, NOW);
        assert.equal(over?.activity?.kind === 'listening' && over.activity.positionMs, 1000);
        assert.equal(parseProfile({ activity: { kind: 'listening', title: 'S', player: 'P', positionMs: -1 } }, NOW), undefined);
    });

    test('about keeps up to five lines and 190 characters, without control or bidi characters', () => {
        const p = parseProfile({ about: 'a‮\r\nb\n\n\n\nc\nd\ne\nf\ng' });
        assert.equal(p?.about, 'a\nb\n\nc\nd');
        assert.equal(Array.from(parseProfile({ about: '😀'.repeat(300) })?.about ?? '').length, 190);
    });

    test('a bad field is dropped and the rest kept', () => {
        const p = parseProfile({ about: 'hi', timeZone: 'Mars/Olympus', device: 'toaster', activity: { kind: 'playing', name: '', elapsedMs: 1 } });
        assert.deepEqual(p, { about: 'hi' });
        assert.deepEqual(parseProfile({ timeZone: 'Europe/Berlin', device: 'phone' }), { timeZone: 'Europe/Berlin', device: 'phone' });
        assert.equal(parseProfile({}), undefined);
        assert.equal(parseProfile('nope'), undefined);
    });

    test('an image must be a version this server hands out', () => {
        const p = parseProfile({ activity: { kind: 'playing', name: 'G', elapsedMs: 0, image: 'https://evil.example/x.png' } }, NOW);
        assert.equal(p?.activity && 'image' in p.activity, false);
        const ok = parseProfile({ activity: { kind: 'playing', name: 'G', elapsedMs: 0, image: IMG } }, NOW);
        assert.equal(ok?.activity?.image, IMG);
    });
});

describe('activity links', () => {
    test('only https on a known public service', () => {
        assert.equal(safeActivityUrl('https://open.spotify.com/track/abc'), 'https://open.spotify.com/track/abc');
        assert.equal(safeActivityUrl('https://artist.bandcamp.com/album/x'), 'https://artist.bandcamp.com/album/x');
        assert.equal(safeActivityUrl('http://open.spotify.com/track/abc'), undefined);
        assert.equal(safeActivityUrl('https://navidrome.home.lan/rest/stream?id=1'), undefined);
        assert.equal(safeActivityUrl('https://user:pw@open.spotify.com/'), undefined);
        assert.equal(safeActivityUrl('https://open.spotify.com.evil.example/'), undefined);
        assert.equal(safeActivityUrl('file:///home/me/song.flac'), undefined);
        assert.equal(safeActivityUrl('javascript:alert(1)'), undefined);
    });
});

describe('what counts as a change', () => {
    const song = (at: number, position: number, extra = {}) =>
        parseProfile({ activity: { kind: 'listening', title: 'S', player: 'P', durationMs: 300_000, positionMs: position, ...extra } }, at);

    test('a heartbeat while the song plays on is no change; a seek or a pause is', () => {
        assert.equal(profileChanged(song(NOW, 10_000), song(NOW + 30_000, 40_000)), false);
        assert.equal(profileChanged(song(NOW, 10_000), song(NOW + 30_000, 120_000)), true);
        assert.equal(profileChanged(song(NOW, 10_000), song(NOW + 30_000, 40_000, { paused: true })), true);
        assert.equal(profileChanged(song(NOW, 10_000, { paused: true }), song(NOW + 30_000, 10_000, { paused: true })), false);
    });

    test('a game re-sent is no change; a new one, a restart or a new line about me is', () => {
        const game = (at: number, elapsed: number, name = 'G') => parseProfile({ about: 'x', activity: { kind: 'playing', name, elapsedMs: elapsed } }, at);
        assert.equal(profileChanged(game(NOW, 0), game(NOW + 30_000, 30_000)), false);
        assert.equal(profileChanged(game(NOW, 0), game(NOW + 30_000, 30_000, 'H')), true);
        assert.equal(profileChanged(game(NOW, 3_600_000), game(NOW + 30_000, 0)), true);
        assert.equal(profileChanged(game(NOW, 0), { ...game(NOW, 0), about: 'y' }), true);
        assert.equal(profileChanged(undefined, game(NOW, 0)), true);
        assert.equal(profileChanged(undefined, undefined), false);
    });
});

describe('what others see', () => {
    test('offline keeps only about and the time zone', () => {
        const p = parseProfile({ about: 'hi', timeZone: 'Asia/Tokyo', device: 'desktop', activity: { kind: 'playing', name: 'G', elapsedMs: 0 } }, NOW);
        assert.deepEqual(shownProfile(p, false), { about: 'hi', timeZone: 'Asia/Tokyo' });
        assert.deepEqual(shownProfile(p, true), p);
        assert.equal(shownProfile(parseProfile({ device: 'web' }), false), undefined);
    });
});
