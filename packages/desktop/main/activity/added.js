'use strict';

// Games the person added by hand ("Add game" in Settings): anything no other source knows,
// such as a game started straight through Wine or a native one from its folder. Each is
// stored on this computer only (userData/games.json) as the process key it matches and the
// name the person gave it. The page gets only { id, name }: the list of running programs to
// pick from goes into a native menu (ipc.js), never to the page, which the server provides.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { linuxProcesses, exeKey } = require('./procs');

const MAX_GAMES = 100;
const NAME_MAX = 100; // as the server keeps it (packages/api/src/lib/profile.ts)

/** Wine's own programs and launch helpers: never a game. */
const WINE_PROGRAMS = new Set([
    'services', 'winedevice', 'plugplay', 'svchost', 'explorer', 'rpcss', 'conhost', 'start', 'tabtip',
    'winemenubuilder', 'rundll32', 'wineboot', 'steamerrorreporter', 'steamerrorreporter64', 'crashpad_handler', 'unitycrashhandler64', 'unitycrashhandler32',
    'iexplore', 'msiexec', 'regedit', 'cmd', 'wineconsole', 'mscorsvw', 'dllhost', 'unins000', 'setup', 'installer',
]);

/** Programs that run beside games but aren't any: Steam, its runtime, Wine itself. */
const HELPERS = /^(steam|steamwebhelper|reaper|pressure-vessel.*|srt-bwrap|wine.*|proton|bwrap|gamescope.*|gamemoded|mangohud)$/;

// ─── Storage ───

class AddedGames {
    constructor(file) {
        this.file = file;
        this.games = this.read();
    }

    read() {
        try {
            const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            return (Array.isArray(data?.games) ? data.games : [])
                .filter(g => typeof g?.id === 'string' && typeof g.key === 'string' && g.key && typeof g.name === 'string')
                .map(g => ({ id: g.id, key: g.key, name: cleanName(g.name) || g.key }))
                .slice(0, MAX_GAMES);
        } catch {
            return [];
        }
    }

    save() {
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            const tmp = `${this.file}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify({ games: this.games }, null, 2));
            fs.renameSync(tmp, this.file);
        } catch (err) {
            console.warn('[activity] saving games failed:', err && err.message);
        }
    }

    /** What the page may see. */
    list() {
        return this.games.map(({ id, name }) => ({ id, name }));
    }

    /** Adds a program by key, or returns the one already added for it. */
    add(key, name) {
        const existing = this.games.find(g => g.key === key);
        if (existing) return { id: existing.id, name: existing.name };
        if (this.games.length >= MAX_GAMES) return null;
        const game = { id: crypto.randomUUID(), key, name: cleanName(name) || key };
        this.games.push(game);
        this.save();
        return { id: game.id, name: game.name };
    }

    rename(id, name) {
        const game = this.games.find(g => g.id === id);
        const clean = cleanName(name);
        if (!game || !clean) return false;
        game.name = clean;
        this.save();
        return true;
    }

    remove(id) {
        const before = this.games.length;
        this.games = this.games.filter(g => g.id !== id);
        if (this.games.length !== before) this.save();
        return this.games.length !== before;
    }

    /** exe key -> name, for matching. */
    byKey() {
        return new Map(this.games.map(g => [g.key, g.name]));
    }
}

/** One line, no control characters, at most NAME_MAX characters. */
function cleanName(name) {
    if (typeof name !== 'string') return '';
    return Array.from(name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, NAME_MAX).join('').trim();
}

/** "Hades2.exe" -> "Hades2", "Game.x86_64" -> "Game": a first guess at the name to show. */
function nameFromFile(file) {
    return String(file).split(/[\\/]/).pop().replace(/\.(exe|x86_64|x86|bin|sh|AppImage)$/i, '');
}

// ─── Running programs to pick from ───

/** Where games live on Linux; anything in /usr/bin and the like is the system's. */
function gameLikePath(file, home) {
    return file.startsWith(`${home}/`) || /^\/(opt|usr\/games|mnt|media|run\/media|srv|games)\//.test(file);
}

/**
 * Linux: Wine programs (an .exe in the command line) and programs run from the home folder,
 * /opt or a drive, as [{ key, label, name }]. `skip` holds keys never offered (Lala's own).
 */
function linuxPrograms({ home = os.homedir(), procRoot = '/proc', ownPid = process.pid, skip = new Set() } = {}) {
    const found = new Map();
    for (const p of linuxProcesses(procRoot)) {
        if (p.pid === ownPid) continue;
        const exeArg = p.args.slice(0, 4).find(a => /\.exe$/i.test(a));
        let file = exeArg;
        if (!file) {
            try {
                file = fs.readlinkSync(`${procRoot}/${p.pid}/exe`);
            } catch { continue; }
            if (!gameLikePath(file, home) || /\/(Steam|steam)\/(ubuntu12_|linux)|\/steamapps\/common\/(Proton|SteamLinuxRuntime)/.test(file)) continue;
        }
        const key = exeKey(file);
        if (!key || skip.has(key) || WINE_PROGRAMS.has(key) || HELPERS.test(key) || found.has(key)) continue;
        const parts = file.split(/[\\/]/).filter(Boolean);
        const where = parts.slice(-3, -1).join('/');
        found.set(key, { key, name: nameFromFile(file), label: where ? `${parts[parts.length - 1]} — ${where}` : parts[parts.length - 1] });
    }
    return [...found.values()];
}

/** Windows: programs with a window, outside the Windows folder; named by their description. */
function windowsPrograms() {
    const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
@(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path -and -not $_.Path.StartsWith($env:windir, 'OrdinalIgnoreCase') } |
  ForEach-Object { @{ name = $_.ProcessName.ToLower(); path = [string]$_.Path; description = [string]$_.Description } }) | ConvertTo-Json -Compress`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return new Promise((resolve) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
            { windowsHide: true, timeout: 10_000, maxBuffer: 4 << 20 }, (err, stdout) => {
                if (err) return resolve([]);
                try {
                    const list = JSON.parse(stdout.trim() || '[]');
                    resolve((Array.isArray(list) ? list : [list]).filter(p => typeof p?.name === 'string').map(p => {
                        const name = (typeof p.description === 'string' && p.description.trim()) || nameFromFile(p.path || p.name);
                        return { key: p.name, name, label: name === p.name ? name : `${name} — ${String(p.path).split('\\').pop()}` };
                    }));
                } catch {
                    resolve([]);
                }
            });
    });
}

/** macOS: this user's processes, as their full executable paths (`ps -x -o comm=`). */
function macExecutables() {
    return new Promise((resolve) => {
        execFile('ps', ['-x', '-o', 'comm='], { timeout: 3000, maxBuffer: 4 << 20 }, (err, stdout) => {
            resolve(err ? [] : stdout.split('\n').map(l => l.trim()).filter(Boolean));
        });
    });
}

/** macOS: apps from /Applications or ~/Applications, named by their bundle. */
async function macPrograms(home = os.homedir()) {
    const found = new Map();
    for (const file of await macExecutables()) {
        const bundle = /^(?:\/Applications|.+\/Applications|.+\/steamapps\/common)\/(?:.+\/)?([^/]+)\.app\/Contents\/MacOS\/[^/]+$/.exec(file);
        if (!bundle || file.startsWith('/System/') || (!file.startsWith('/Applications/') && !file.startsWith(home))) continue;
        const key = exeKey(file);
        if (!found.has(key)) found.set(key, { key, name: bundle[1], label: bundle[1] });
    }
    return [...found.values()];
}

/** Running programs the person might add as a game, sorted by label. */
async function runningPrograms(skip) {
    let list = [];
    if (process.platform === 'linux') list = linuxPrograms({ skip });
    else if (process.platform === 'win32') list = await windowsPrograms();
    else if (process.platform === 'darwin') list = await macPrograms();
    return list.filter(p => !skip.has(p.key)).sort((a, b) => a.label.localeCompare(b.label));
}

module.exports = { AddedGames, runningPrograms, linuxPrograms, macExecutables, cleanName, nameFromFile };
