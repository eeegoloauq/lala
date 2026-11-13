'use strict';

// The Steam game running now, from Steam's own files: no process list is needed, and it covers
// Proton games on Linux, whose processes are all wine. Steam keeps the running app's ID in its
// registry (registry.vdf on Linux and macOS, HKCU\Software\Valve\Steam on Windows, which
// windows.js reads); the name comes from the game's appmanifest, the icon from Steam's cache.

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
 * The running Steam game as { appId, name, iconPath, url }, or null. `windows` passes what
 * Windows' registry says: { appId, steamPath }.
 */
function runningSteamGame(windows) {
    const appId = windows ? windows.appId : runningAppIdFromRegistry();
    if (!appId) return null;
    const roots = windows ? (windows.steamPath ? [windows.steamPath] : []) : steamRoots();
    const name = gameName(appId, roots);
    if (!name) return null;
    return { appId, name, iconPath: gameIconPath(appId, roots), url: `https://store.steampowered.com/app/${appId}` };
}

module.exports = { runningSteamGame };
