import type { PresenceActivity, PresenceProfile } from '@lala/shared';
import { sanitizeDisplayText, sanitizeMessageText } from './sanitize';

/**
 * What a person shares about themselves with their presence (docs/design.md#profiles):
 * a line about them, their time zone, the kind of device, and what the desktop app saw them
 * play or listen to. The client sends times relative to the request; they are stamped here
 * with the server's clock, which every viewer shares. Anything malformed is dropped field by
 * field, so one bad value doesn't cost the rest.
 */

export const ABOUT_MAX = 190;
const ABOUT_LINES = 5;
const TEXT_MAX = 200;
const PLAYER_MAX = 40;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const IMAGE_VERSION = /^[0-9a-f]{16}$/;

/**
 * Links an activity may carry: https on a public music service or game store. A player can
 * name any URL (a private Navidrome, a local file, a phishing page). The web client keeps
 * the same list (packages/web/src/lib/activityLinks.ts) and checks again.
 */
const LINK_HOSTS = new Set([
    'open.spotify.com',
    'music.youtube.com',
    'www.youtube.com',
    'music.apple.com',
    'soundcloud.com',
    'tidal.com',
    'www.deezer.com',
    'store.steampowered.com',
]);

export function safeActivityUrl(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > 500) return undefined;
    try {
        const url = new URL(value);
        const known = LINK_HOSTS.has(url.hostname) || url.hostname.endsWith('.bandcamp.com');
        return url.protocol === 'https:' && known && !url.username && !url.password ? url.href : undefined;
    } catch {
        return undefined;
    }
}

const text = (value: unknown, max: number) => typeof value === 'string' ? sanitizeDisplayText(value, max) || undefined : undefined;
const ms = (value: unknown, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), max) : undefined;
const image = (value: unknown) => typeof value === 'string' && IMAGE_VERSION.test(value) ? value : undefined;

function about(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const lines = sanitizeMessageText(value).replace(/\t/g, ' ').replace(/\n{3,}/g, '\n\n').split('\n');
    const kept = lines.slice(0, ABOUT_LINES).map(l => l.trimEnd()).join('\n');
    return Array.from(kept).slice(0, ABOUT_MAX).join('').trim() || undefined;
}

function timeZone(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return undefined;
    try {
        return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
    } catch {
        return undefined;
    }
}

function activity(value: unknown, now: number): PresenceActivity | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const a = value as Record<string, unknown>;
    if (a.kind === 'playing') {
        const name = text(a.name, 100);
        const elapsed = ms(a.elapsedMs, WEEK_MS);
        if (!name || elapsed === undefined) return undefined;
        return strip<PresenceActivity>({ kind: 'playing', name, startedAt: now - elapsed, image: image(a.image), url: safeActivityUrl(a.url) });
    }
    if (a.kind === 'listening') {
        const title = text(a.title, TEXT_MAX);
        const player = text(a.player, PLAYER_MAX);
        const durationMs = ms(a.durationMs, SIX_HOURS_MS) || undefined;
        const position = ms(a.positionMs, durationMs ?? SIX_HOURS_MS);
        if (!title || !player || position === undefined) return undefined;
        return strip<PresenceActivity>({
            kind: 'listening', title, artist: text(a.artist, TEXT_MAX), album: text(a.album, TEXT_MAX), player,
            image: image(a.image), url: safeActivityUrl(a.url), durationMs, positionMs: position, positionAt: now,
            paused: a.paused === true || undefined,
        });
    }
    return undefined;
}

/** Leaves out fields without a value, so stored and compared profiles stay small and equal. */
function strip<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** The profile a client sent, cleaned; undefined when nothing in it is usable. */
export function parseProfile(value: unknown, now = Date.now()): PresenceProfile | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const p = value as Record<string, unknown>;
    const device = p.device === 'desktop' || p.device === 'web' || p.device === 'phone' ? p.device : undefined;
    const profile = strip<PresenceProfile>({ about: about(p.about), timeZone: timeZone(p.timeZone), device, activity: activity(p.activity, now) });
    return Object.keys(profile).length > 0 ? profile : undefined;
}

/** A song that moved this far from where the last update put it was seeked, not just played on. */
const SEEK_MS = 3000;
/** A game whose start moved this much is a new session (a restart), not the same one re-sent. */
const RESTART_MS = 60_000;

/**
 * Whether viewers would see a difference. Heartbeats re-send the profile every 30 seconds
 * with fresh times; those alone don't announce anything, a seek or a new track does.
 */
export function profileChanged(before: PresenceProfile | undefined, after: PresenceProfile | undefined): boolean {
    const { activity: a, ...restBefore } = before ?? {};
    const { activity: b, ...restAfter } = after ?? {};
    if (JSON.stringify(restBefore) !== JSON.stringify(restAfter)) return true;
    if (!a || !b) return !!a !== !!b;
    if (a.kind === 'playing' && b.kind === 'playing') {
        return a.name !== b.name || a.image !== b.image || a.url !== b.url || Math.abs(a.startedAt - b.startedAt) > RESTART_MS;
    }
    if (a.kind === 'listening' && b.kind === 'listening') {
        const expected = a.paused ? a.positionMs : a.positionMs + (b.positionAt - a.positionAt);
        return a.title !== b.title || a.artist !== b.artist || a.album !== b.album || a.player !== b.player
            || a.image !== b.image || a.url !== b.url || a.durationMs !== b.durationMs || !!a.paused !== !!b.paused
            || Math.abs(Math.min(expected, b.durationMs ?? Infinity) - b.positionMs) > SEEK_MS;
    }
    return true;
}

/** What others see of a profile: everything while the person is online, only the lasting part otherwise. */
export function shownProfile(profile: PresenceProfile | undefined, online: boolean): PresenceProfile | undefined {
    if (!profile) return undefined;
    if (online) return profile;
    const lasting = strip<PresenceProfile>({ about: profile.about, timeZone: profile.timeZone });
    return Object.keys(lasting).length > 0 ? lasting : undefined;
}
