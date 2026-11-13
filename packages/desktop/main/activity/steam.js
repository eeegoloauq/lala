'use strict';

// The Steam game running now. Its ID: on Linux from the launch line of Steam's `reaper`
// (`reaper SteamLaunch AppId=<id> -- …`), which also covers Proton games, whose processes are
// all wine, and Flatpak Steam, whose processes show in the host's /proc. Steam for Linux
// stopped writing RunningAppID to registry.vdf in 2023, so that file is only a fallback; it
// still serves macOS, and Windows reads the same key from HKCU\Software\Valve\Steam
// (windows.js). The name comes from the game's appmanifest, the icon from Steam's cache. A
// non-Steam game added to Steam has neither: its name and icon come from shortcuts.vdf.

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();

/** Where Steam lives: the usual install, the ~/.steam link, Flatpak, macOS. */
function steamRoots() {
    if (process.platform === 'darwin') return [path.join(HOME, 'Library/Application Support/Steam')];
    return [
        path.join(HOME, '.steam/steam'),
        path.join(HOME, '.local/share/Steam'),
        path.join(HOME, '.var/app/com.valvesoftware.Steam/.local/share/Steam'),
    ];
}

function readText(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return null;
    }
}

/** RunningAppID from registry.vdf (Linux, macOS); 0 when Steam runs nothing or isn't there. */
function runningAppIdFromRegistry() {
    const candidates = process.platform === 'darwin'
        ? [path.join(HOME, 'Library/Application Support/Steam/registry.vdf')]
        : [path.join(HOME, '.steam/registry.vdf'), path.join(HOME, '.var/app/com.valvesoftware.Steam/.steam/registry.vdf')];
    for (const file of candidates) {
        const match = /"RunningAppID"\s+"(\d+)"/i.exec(readText(file) || '');
        if (match && match[1] !== '0') return Number(match[1]);
    }
    return 0;
}

/** The AppId from a running `reaper SteamLaunch AppId=<id>`; 0 when Steam runs no game. */
function runningAppIdFromProcesses(procs) {
    for (const { args } of procs) {
        const launch = args.indexOf('SteamLaunch');
        if (launch < 0) continue;
        for (const arg of args.slice(launch + 1)) {
            if (arg === '--') break;
            const match = /^AppId=(\d+)$/i.exec(arg);
            if (match && match[1] !== '0') return Number(match[1]);
        }
    }
    return 0;
}

/**
 * Steam's binary KeyValues (shortcuts.vdf): 0x00 opens a map, 0x01 a string, 0x02 an int32,
 * 0x07 a uint64, 0x08 closes. Keys are lowercased; Steam has written both AppName and appname.
 */
function parseBinaryVdf(buf) {
    let i = 0;
    const cstring = () => {
        const end = buf.indexOf(0, i);
        if (end < 0) throw new Error('truncated');
        const text = buf.toString('utf8', i, end);
        i = end + 1;
        return text;
    };
    const map = () => {
        const out = {};
        while (i < buf.length) {
            const type = buf[i++];
            if (type === 0x08) return out;
            const key = cstring().toLowerCase();
            if (type === 0x00) out[key] = map();
            else if (type === 0x01) out[key] = cstring();
            else if (type === 0x02) { out[key] = buf.readUInt32LE(i); i += 4; }
            else if (type === 0x07) { out[key] = buf.readBigUInt64LE(i); i += 8; }
            else throw new Error(`type ${type}`);
        }
        return out;
    };
    return map();
}

/** Non-Steam games added to Steam, from every account's shortcuts.vdf: [{ appId, name, icon }]. */
function shortcuts(roots) {
    const found = [];
    for (const root of roots) {
        let users = [];
        try {
            users = fs.readdirSync(path.join(root, 'userdata'));
        } catch { continue; }
        for (const user of users) {
            try {
                const file = path.join(root, 'userdata', user, 'config/shortcuts.vdf');
                if (fs.statSync(file).size > 4 << 20) continue;
                for (const entry of Object.values(parseBinaryVdf(fs.readFileSync(file)).shortcuts || {})) {
                    if (typeof entry?.appid !== 'number' || typeof entry.appname !== 'string' || !entry.appname.trim()) continue;
                    const icon = typeof entry.icon === 'string' ? entry.icon.replace(/^"|"$/g, '') : '';
                    found.push({ appId: entry.appid, name: entry.appname.trim(), icon: /\.(png|jpe?g)$/i.test(icon) ? icon : null });
                }
            } catch { /* no shortcuts, or a file we can't read */ }
        }
    }
    return found;
}

/** Every library folder Steam knows, from libraryfolders.vdf, plus the roots themselves. */
function libraries(roots) {
    const found = new Set();
    for (const root of roots) {
        const vdf = readText(path.join(root, 'steamapps/libraryfolders.vdf'));
        if (vdf === null) continue;
        found.add(root);
        for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) found.add(m[1].replace(/\\\\/g, '\\'));
    }
    return [...found];
}

/** The game's name from its appmanifest in any library. */
function gameName(appId, roots) {
    for (const lib of libraries(roots)) {
        const match = /"name"\s+"([^"]+)"/.exec(readText(path.join(lib, 'steamapps', `appmanifest_${appId}.acf`)) || '');
        if (match) return match[1];
    }
    return null;
}

/**
 * A square picture of the game from Steam's library cache: the icon in the newer layout
 * (`librarycache/<id>/<sha1>.jpg`), else the older `<id>_icon.jpg`, else the cover.
 */
function gameIconPath(appId, roots) {
    for (const root of roots) {
        const cache = path.join(root, 'appcache/librarycache');
        try {
            const dir = path.join(cache, String(appId));
            const icon = fs.readdirSync(dir).find(f => /^[0-9a-f]{40}\.jpg$/.test(f));
            if (icon) return path.join(dir, icon);
            if (fs.existsSync(path.join(dir, 'library_600x900.jpg'))) return path.join(dir, 'library_600x900.jpg');
        } catch { /* not the newer layout */ }
        for (const name of [`${appId}_icon.jpg`, `${appId}_library_600x900.jpg`]) {
            if (fs.existsSync(path.join(cache, name))) return path.join(cache, name);
        }
    }
    return null;
}

/**
 * The running Steam game as { appId, name, iconPath, url }, or null; a shortcut has no store
 * page, so no url. `windows` passes what Windows' registry says: { appId, steamPath }; on
 * Linux `procs` is this poll's process list.
 */
function runningSteamGame({ windows, procs = [], roots } = {}) {
    const appId = windows ? windows.appId : runningAppIdFromProcesses(procs) || runningAppIdFromRegistry();
    if (!appId) return null;
    roots = roots || (windows ? (windows.steamPath ? [windows.steamPath] : []) : steamRoots());
    const name = gameName(appId, roots);
    if (name) return { appId, name, iconPath: gameIconPath(appId, roots), url: `https://store.steampowered.com/app/${appId}` };
    // A shortcut's ID may arrive as its 64-bit game ID, the 32-bit one in the high half.
    const short = appId > 0xffffffff ? Number(BigInt(appId) >> 32n) : appId;
    const shortcut = shortcuts(roots).find(s => s.appId === short);
    return shortcut ? { appId: short, name: shortcut.name, iconPath: shortcut.icon } : null;
}

module.exports = { runningSteamGame, runningAppIdFromProcesses, parseBinaryVdf, shortcuts };
