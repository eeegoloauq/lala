'use strict';

// What plays on this computer, for the profile (docs/design.md#profiles). Started by the web
// app only while the person shares it or hasn't been asked yet; sends the renderer a summary
// (a game or a song, a small picture, times on this computer's clock) when it changes. The
// process list and players' raw metadata never leave this module.
//
// A game wins over music: one activity is shown. Steam games come from Steam's launch line
// and files (steam.js); on Linux, games from Bottles, Heroic and Lutris by what those
// launchers installed (launchers.js); others the person added by hand (added.js), then a
// short list of process names (KNOWN_GAMES). Music from MPRIS on
// Linux (mpris.js) and the media session on Windows (windows.js); macOS offers no public way
// to read what plays, so there only games are seen.

const fs = require('fs');
const { app, nativeImage, net } = require('electron');
const { readPlayers, BROWSERS: LINUX_BROWSERS } = require('./mpris');
const { runningSteamGame } = require('./steam');
const { launcherGames } = require('./launchers');
const { linuxProcesses, hasName, exeKey } = require('./procs');
const { macExecutables } = require('./added');
const { startWindowsWatch, playerName, BROWSERS: WINDOWS_BROWSERS } = require('./windows');

const POLL_MS = 5000;
/** A paused song stays shown this long, so a pause between tracks doesn't blink. */
const PAUSE_KEEP_MS = 60_000;
/** A position this far from where the last update put it is a seek, worth sending. */
const SEEK_MS = 3000;
const IMAGE_PX = 128;

/** Games outside Steam, by process name (lowercase, no .exe) -> the name to show. */
const KNOWN_GAMES = {
    'league of legends': 'League of Legends',
    'valorant-win64-shipping': 'VALORANT',
    'fortniteclient-win64-shipping': 'Fortnite',
    'robloxplayerbeta': 'Roblox',
    'minecraft.windows': 'Minecraft',
    'genshinimpact': 'Genshin Impact',
    'overwatch': 'Overwatch 2',
    'wow': 'World of Warcraft',
    'hearthstone': 'Hearthstone',
    'diablo iv': 'Diablo IV',
    'osu!': 'osu!',
};

// ─── Pictures ───

const images = new Map(); // source key -> Promise<data URL | undefined>

/** A square crop scaled to 128 px, as a JPEG data URL (PNG for icons, which may be transparent). */
function toDataUrl(image, png = false) {
    if (!image || image.isEmpty()) return undefined;
    const { width, height } = image.getSize();
    const side = Math.min(width, height);
    const square = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
    const scaled = side > IMAGE_PX ? square.resize({ width: IMAGE_PX, height: IMAGE_PX, quality: 'good' }) : square;
    return png ? `data:image/png;base64,${scaled.toPNG().toString('base64')}` : `data:image/jpeg;base64,${scaled.toJPEG(82).toString('base64')}`;
}

/** A cover from a player's artUrl: a local file, or https from the player's own service. */
async function coverFromUrl(artUrl) {
    try {
        const url = new URL(artUrl);
        if (url.protocol === 'file:') {
            const file = decodeURIComponent(url.pathname);
            if (fs.statSync(file).size > 8 << 20) return undefined;
            return toDataUrl(nativeImage.createFromPath(file));
        }
        if (url.protocol !== 'https:') return undefined;
        const res = await net.fetch(url.href, { signal: AbortSignal.timeout(5000) });
        if (!res.ok || Number(res.headers.get('content-length') || 0) > 8 << 20) return undefined;
        const data = Buffer.from(await res.arrayBuffer());
        return data.length > 8 << 20 ? undefined : toDataUrl(nativeImage.createFromBuffer(data));
    } catch {
        return undefined;
    }
}

function imageOnce(key, make) {
    if (!images.has(key)) {
        if (images.size > 50) images.delete(images.keys().next().value);
        images.set(key, make().catch(() => undefined));
    }
    return images.get(key);
}

// ─── Games outside Steam ───

/** The first game in `games` (exe key -> value) that one of the processes runs, as [key, value]. */
function gameIn(games, procs) {
    for (const entry of games) {
        if (procs.some(p => hasName(p, entry[0]))) return entry;
    }
    return null;
}

// ─── The watcher ───

class ActivityWatcher {
    /** `added` is the AddedGames store: games the person picked, which win over launchers. */
    constructor(emit, added) {
        this.emit = emit;
        this.added = added;
        this.options = null;
        this.timer = null;
        this.stopWindows = null;
        this.windowsSnapshot = null;
        this.windowsCovers = new Map(); // track key -> data URL, since the script sends a cover once
        this.last = undefined;          // what the renderer has, as sent
        this.game = null;               // { key, startedAt }
        this.track = null;              // { key, positionMs, at, pausedSince }
    }

    start(options) {
        this.options = options;
        if (this.timer) return;
        this.startWindows();
        this.tick();
        this.timer = setInterval(() => this.tick(), POLL_MS);
    }

    /** Windows: the script looks for a fixed list of process names, so a changed list restarts it. */
    startWindows() {
        if (process.platform !== 'win32') return;
        this.stopWindows?.();
        const names = [...new Set([...Object.keys(KNOWN_GAMES), ...(this.added?.byKey().keys() || [])])];
        this.stopWindows = startWindowsWatch(names, (snap) => { this.windowsSnapshot = snap; });
    }

    /** The added games changed: look again now. */
    gamesChanged() {
        if (!this.timer) return;
        this.startWindows();
        this.tick();
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
        this.stopWindows?.();
        this.stopWindows = null;
        this.windowsSnapshot = null;
        this.last = undefined;
        this.game = null;
        this.track = null;
    }

    async tick() {
        if (this.busy) return;
        this.busy = true;
        try {
            const activity = (await this.currentGame()) || (await this.currentSong());
            if (this.timer && this.changed(activity)) {
                this.last = activity;
                this.emit(activity);
            }
        } catch (err) {
            console.warn('[activity] detection failed:', err && err.message);
        } finally {
            this.busy = false;
        }
    }

    async currentGame() {
        const win = process.platform === 'win32' ? this.windowsSnapshot : null;
        if (process.platform === 'win32' && !win) return null;
        const linux = process.platform === 'linux';
        const procs = win ? win.procs.map(p => ({ names: new Set([p.name]), path: p.path }))
            : linux ? linuxProcesses()
                : process.platform === 'darwin' ? (await macExecutables()).map(f => ({ names: new Set([exeKey(f)]) })) : [];
        const procPath = (key) => procs.find(p => p.names.has(key))?.path;
        const exeIcon = (exe) => exe ? imageOnce(exe, async () => toDataUrl(await app.getFileIcon(exe, { size: 'large' }), true)) : undefined;
        const fileImage = (file, png) => file && imageOnce(file, async () => toDataUrl(nativeImage.createFromPath(file), png));
        let found = null;
        const steam = runningSteamGame({ windows: win?.steam, procs });
        const added = !steam && this.added ? gameIn(this.added.byKey(), procs) : null;
        const launched = !steam && !added && linux ? gameIn(launcherGames(), procs) : null;
        const known = !steam && !added && !launched ? gameIn(Object.entries(KNOWN_GAMES), procs) : null;
        if (steam) {
            found = { key: `steam:${steam.appId}`, name: steam.name, url: steam.url, image: fileImage(steam.iconPath) };
        } else if (added) {
            const [exe, name] = added;
            found = { key: `added:${exe}`, name, image: exeIcon(procPath(exe)) };
        } else if (launched) {
            const [exe, game] = launched;
            found = { key: `launcher:${exe}`, name: game.name, image: fileImage(game.icon, true) };
        } else if (known) {
            const [proc, name] = known;
            found = { key: `proc:${proc}`, name, image: exeIcon(procPath(proc)) };
        }
        if (!found) {
            this.game = null;
            return null;
        }
        if (this.game?.key !== found.key) this.game = { key: found.key, startedAt: Date.now() };
        return { kind: 'playing', name: found.name, startedAt: this.game.startedAt, url: found.url, image: await found.image };
    }

    async currentSong() {
        const browsers = !!this.options?.browsers;
        let song = null;
        if (process.platform === 'linux') {
            const [first] = await readPlayers({ browsers, ownPid: process.pid });
            if (first) song = { ...first, key: `${first.bus}|${first.title}|${first.artist}|${first.album}`, image: first.artUrl ? imageOnce(first.artUrl, () => coverFromUrl(first.artUrl)) : undefined };
        } else if (process.platform === 'win32' && this.windowsSnapshot) {
            const sessions = this.windowsSnapshot.media
                .filter(m => m.status === 'Playing' || m.status === 'Paused')
                .filter(m => browsers || !WINDOWS_BROWSERS.test(m.app))
                .filter(m => !/\blala\b/i.test(m.app))
                .sort((a, b) => Number(a.status !== 'Playing') - Number(b.status !== 'Playing'));
            const m = sessions[0];
            if (m) {
                if (m.cover) this.windowsCovers.set(m.key, toDataUrl(nativeImage.createFromBuffer(Buffer.from(m.cover, 'base64'))));
                if (this.windowsCovers.size > 50) this.windowsCovers.delete(this.windowsCovers.keys().next().value);
                song = {
                    key: m.key, player: playerName(m.app), title: m.title, artist: m.artist || undefined, album: m.album || undefined,
                    durationMs: m.durationMs > 0 ? m.durationMs : undefined, positionMs: Math.max(0, m.positionMs || 0), paused: m.status !== 'Playing',
                    image: this.windowsCovers.get(m.key),
                };
            }
        }
        const now = Date.now();
        if (!song) {
            this.track = null;
            return null;
        }
        const same = this.track?.key === song.key;
        // Some players (Spotify on Linux) always report 0: count on from when the track began.
        if (!song.paused && song.positionMs === 0 && same && !this.track.pausedSince) {
            song.positionMs = this.track.positionMs + (now - this.track.at);
        }
        const pausedSince = song.paused ? (same && this.track.pausedSince) || now : null;
        this.track = { key: song.key, positionMs: song.positionMs, at: now, pausedSince };
        if (pausedSince && now - pausedSince > PAUSE_KEEP_MS) return null;
        return {
            kind: 'listening', title: song.title, artist: song.artist, album: song.album, player: song.player,
            url: song.url, durationMs: song.durationMs, positionMs: song.positionMs, positionAt: now,
            paused: song.paused || undefined, image: await song.image,
        };
    }

    /** Whether the renderer should hear about it: anything but a song playing on as expected. */
    changed(next) {
        const prev = this.last;
        if (prev === undefined) return true;
        if (!prev || !next) return prev !== next;
        const { positionMs: p1, positionAt: a1, startedAt: s1, ...restPrev } = prev;
        const { positionMs: p2, positionAt: a2, startedAt: s2, ...restNext } = next;
        if (JSON.stringify(restPrev) !== JSON.stringify(restNext) || s1 !== s2) return true;
        if (next.kind !== 'listening') return false;
        const expected = prev.paused ? p1 : p1 + (a2 - a1);
        return Math.abs(Math.min(expected, next.durationMs ?? Infinity) - p2) > SEEK_MS;
    }
}

module.exports = { ActivityWatcher, KNOWN_GAMES, LINUX_BROWSERS };
