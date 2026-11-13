'use strict';

// What plays on Linux: every player on the session bus that speaks MPRIS (Spotify, Legato,
// browsers, mpv, VLC, …). Read with `busctl --json`, part of systemd, so nothing extra ships;
// without it (a distro without systemd) there is simply no music to show.

const { execFile } = require('child_process');

const PREFIX = 'org.mpris.MediaPlayer2.';
const OBJECT = '/org/mpris/MediaPlayer2';

/** Bus names of browsers; their tabs also report the titles of videos. */
const BROWSERS = /^(firefox|chromium|chrome|google-chrome|brave|vivaldi|opera|msedge|microsoft-edge|epiphany|plasma-browser-integration|librewolf|zen|floorp)\b/i;

function busctl(args) {
    return new Promise((resolve) => {
        execFile('busctl', ['--user', '--json=short', ...args], { timeout: 3000, maxBuffer: 1 << 20 }, (err, stdout) => {
            if (err) return resolve(null);
            try {
                // One JSON value per line when several properties are asked for.
                resolve(stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
            } catch {
                resolve(null);
            }
        });
    });
}

const value = (v) => v && typeof v === 'object' && 'data' in v ? v.data : undefined;

const identities = new Map();

/** The player's own name ("Spotify", "Legato"), asked once per bus name. */
async function identityOf(bus) {
    if (identities.has(bus)) return identities.get(bus);
    const out = await busctl(['get-property', bus, OBJECT, 'org.mpris.MediaPlayer2', 'Identity']);
    const name = (out && typeof value(out[0]) === 'string' && value(out[0])) || bus.slice(PREFIX.length).split('.')[0];
    identities.set(bus, name);
    return name;
}

/**
 * Players with something loaded, playing ones first. `browsers` lets browser tabs count.
 * `ownPid` leaves out Lala's own window, which Chromium may register as a player too.
 */
async function readPlayers({ browsers, ownPid }) {
    const names = await busctl(['call', 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames']);
    const list = names && Array.isArray(value(names[0])) ? value(names[0])[0] : [];
    const players = (list || []).filter(n => typeof n === 'string' && n.startsWith(PREFIX))
        .filter(n => !n.includes(`instance${ownPid}`) && !/\blala\b/i.test(n.slice(PREFIX.length)))
        .filter(n => browsers || !BROWSERS.test(n.slice(PREFIX.length)));

    const found = [];
    for (const bus of players) {
        const out = await busctl(['get-property', bus, OBJECT, 'org.mpris.MediaPlayer2.Player', 'PlaybackStatus', 'Metadata', 'Position']);
        if (!out || out.length < 3) continue;
        const status = value(out[0]);
        const meta = value(out[1]) || {};
        const title = value(meta['xesam:title']);
        if ((status !== 'Playing' && status !== 'Paused') || typeof title !== 'string' || !title.trim()) continue;
        const artists = value(meta['xesam:artist']);
        const lengthUs = Number(value(meta['mpris:length']));
        const positionUs = Number(value(out[2]));
        found.push({
            bus,
            player: await identityOf(bus),
            title: title.trim(),
            artist: Array.isArray(artists) ? artists.filter(a => typeof a === 'string').join(', ') || undefined : undefined,
            album: typeof value(meta['xesam:album']) === 'string' ? value(meta['xesam:album']) || undefined : undefined,
            artUrl: typeof value(meta['mpris:artUrl']) === 'string' ? value(meta['mpris:artUrl']) : undefined,
            url: typeof value(meta['xesam:url']) === 'string' ? value(meta['xesam:url']) : undefined,
            durationMs: Number.isFinite(lengthUs) && lengthUs > 0 ? Math.round(lengthUs / 1000) : undefined,
            positionMs: Number.isFinite(positionUs) && positionUs >= 0 ? Math.round(positionUs / 1000) : 0,
            paused: status === 'Paused',
        });
    }
    return found.sort((a, b) => Number(a.paused) - Number(b.paused));
}

module.exports = { readPlayers, BROWSERS };
