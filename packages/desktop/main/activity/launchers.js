'use strict';

// Games from Linux launchers that keep a list of what they installed, so a game they run is
// known by its executable and shown by the name the launcher gives it: Bottles (each bottle's
// bottle.yml), Heroic (Epic through Legendary, GOG, and games added by hand) and Lutris (its
// pga.db and per-game YAML). Native installs and Flatpaks are both read. A game matches by
// process name, so it shows even when started outside its launcher. The files are read again
// at most every REFRESH_MS, not on every poll.

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { exeKey } = require('./procs');

const REFRESH_MS = 30_000;
const MAX_FILE = 8 << 20;

function readFile(file) {
    try {
        return fs.statSync(file).size > MAX_FILE ? null : fs.readFileSync(file, 'utf8');
    } catch {
        return null;
    }
}

function readJson(file) {
    try {
        const text = readFile(file);
        return text === null ? null : JSON.parse(text);
    } catch {
        return null;
    }
}

function readYaml(file) {
    try {
        const text = readFile(file);
        return text === null ? null : yaml.load(text, { schema: yaml.JSON_SCHEMA });
    } catch {
        return null;
    }
}

function listDir(dir) {
    try {
        return fs.readdirSync(dir);
    } catch {
        return [];
    }
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const existing = (file) => (file && fs.existsSync(file) ? file : null);

// ─── Bottles ───

/** External_Programs of every bottle: the programs the person added, with name and icon. */
function bottlesGames(home) {
    const games = [];
    for (const base of [
        path.join(home, '.local/share/bottles/bottles'),
        path.join(home, '.var/app/com.usebottles.bottles/data/bottles/bottles'),
    ]) {
        for (const bottle of listDir(base)) {
            const config = readYaml(path.join(base, bottle, 'bottle.yml'));
            const programs = config && typeof config.External_Programs === 'object' ? config.External_Programs : null;
            for (const p of Object.values(programs || {})) {
                const exe = str(p?.executable) || str(p?.path);
                const name = str(p?.name);
                if (!exe || !name || p.removed) continue;
                const icon = str(p.icon);
                games.push({ exe, name, icon: icon && path.isAbsolute(icon) ? existing(icon) : null });
            }
        }
    }
    return games;
}

// ─── Heroic ───

/** Heroic's config folders: native and Flatpak; Legendary's own folder for Epic games too. */
function heroicRoots(home) {
    return [path.join(home, '.config/heroic'), path.join(home, '.var/app/com.heroicgameslauncher.hgl/config/heroic')];
}

function heroicGames(home) {
    const games = [];
    const legendaryFiles = [path.join(home, '.config/legendary/installed.json')];
    for (const root of heroicRoots(home)) {
        legendaryFiles.push(path.join(root, 'legendaryConfig/legendary/installed.json'));

        // GOG: installed.json has the folder; the game's goggame-<id>.info has name and exe.
        const gog = readJson(path.join(root, 'gog_store/installed.json'));
        for (const g of Array.isArray(gog?.installed) ? gog.installed : []) {
            const dir = str(g?.install_path);
            if (!dir) continue;
            const info = readJson(path.join(dir, `goggame-${g.appName}.info`));
            const task = Array.isArray(info?.playTasks) ? info.playTasks.find(t => t?.isPrimary) || info.playTasks[0] : null;
            const exe = str(task?.path);
            const name = str(info?.name);
            if (exe && name) games.push({ exe, name, icon: null });
        }

        // Games added by hand ("Add game" in Heroic).
        const sideload = readJson(path.join(root, 'sideload_apps/library.json'));
        for (const g of Array.isArray(sideload?.games) ? sideload.games : []) {
            const exe = str(g?.install?.executable);
            const name = str(g?.title);
            if (exe && name) games.push({ exe, name, icon: null });
        }
    }
    for (const file of legendaryFiles) {
        const installed = readJson(file);
        for (const g of installed && typeof installed === 'object' ? Object.values(installed) : []) {
            const exe = str(g?.executable);
            const name = str(g?.title);
            if (exe && name) games.push({ exe, name, icon: null });
        }
    }
    return games;
}

// ─── Lutris ───

let sqlite;
function openReadOnly(file) {
    if (sqlite === undefined) {
        try {
            sqlite = require('node:sqlite');
        } catch {
            sqlite = null; // a runtime without it: Lutris games aren't seen
        }
    }
    return sqlite ? new sqlite.DatabaseSync(file, { readOnly: true }) : null;
}

/** Installed Lutris games: name and slug from pga.db, the exe from the game's YAML config. */
function lutrisGames(home) {
    const games = [];
    for (const [data, config] of [
        [path.join(home, '.local/share/lutris'), path.join(home, '.config/lutris')],
        [path.join(home, '.var/app/net.lutris.Lutris/data/lutris'), path.join(home, '.var/app/net.lutris.Lutris/config/lutris')],
    ]) {
        const dbFile = path.join(data, 'pga.db');
        if (!fs.existsSync(dbFile)) continue;
        let rows = [];
        let db;
        try {
            db = openReadOnly(dbFile);
            rows = db ? db.prepare('SELECT name, slug, configpath FROM games WHERE installed = 1').all() : [];
        } catch {
            rows = []; // locked, or another schema
        } finally {
            try { db?.close(); } catch { /* already closed */ }
        }
        for (const row of rows) {
            const name = str(row.name);
            const configpath = str(row.configpath);
            if (!name || !configpath || /[\\/]/.test(configpath)) continue;
            // Newer Lutris keeps game configs under data, older under config.
            const conf = readYaml(path.join(data, 'games', `${configpath}.yml`)) || readYaml(path.join(config, 'games', `${configpath}.yml`));
            const exe = str(conf?.game?.exe);
            if (!exe) continue;
            const slug = str(row.slug);
            const icon = slug && !/[\\/]/.test(slug)
                ? existing(path.join(home, '.local/share/icons/hicolor/128x128/apps', `lutris_${slug}.png`))
                    || existing(path.join(data, 'icons', `${slug}.png`))
                : null;
            games.push({ exe, name, icon });
        }
    }
    return games;
}

// ─── The index ───

let cache = { at: 0, home: null, index: new Map() };

/** exe key -> { name, icon }, from every launcher; the first launcher to name an exe wins. */
function launcherGames(home = os.homedir(), now = Date.now()) {
    if (cache.home === home && now - cache.at < REFRESH_MS) return cache.index;
    const index = new Map();
    for (const source of [bottlesGames, heroicGames, lutrisGames]) {
        let games = [];
        try {
            games = source(home);
        } catch { /* one launcher's odd files don't stop the others */ }
        for (const g of games) {
            const key = exeKey(g.exe);
            if (key && !index.has(key)) index.set(key, { name: g.name, icon: g.icon });
        }
    }
    cache = { at: now, home, index };
    return index;
}

module.exports = { launcherGames, bottlesGames, heroicGames, lutrisGames };
