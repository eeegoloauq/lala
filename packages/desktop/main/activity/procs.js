'use strict';

// This user's processes on Linux, read once per poll from /proc and shared by every game
// source. Only what matching needs is kept: the short name and the command line. Other
// users' processes can't be read and are skipped.

const fs = require('fs');

/** "C:\Games\Hades2.exe", "./Game.x86_64" -> "hades2", "game.x86_64": what game lists match on. */
function exeKey(file) {
    return String(file).split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
}

/**
 * [{ pid, args, names }]: `names` holds the keys a game may be known by: the kernel's short
 * name (15 characters at most), the program in argv[0] and, for Wine, an .exe among the
 * first arguments (a launch line like `wine64 Game.exe` before Wine rewrites it).
 */
function linuxProcesses(procRoot = '/proc') {
    const list = [];
    let pids;
    try {
        pids = fs.readdirSync(procRoot).filter(p => /^\d+$/.test(p));
    } catch {
        return list;
    }
    for (const pid of pids) {
        try {
            const comm = fs.readFileSync(`${procRoot}/${pid}/comm`, 'utf8').trim();
            const args = fs.readFileSync(`${procRoot}/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
            const names = new Set([exeKey(comm)]);
            if (args[0]) names.add(exeKey(args[0]));
            for (const arg of args.slice(1, 4)) if (/\.exe$/i.test(arg)) names.add(exeKey(arg));
            list.push({ pid: Number(pid), args, names });
        } catch { /* gone, or another user's */ }
    }
    return list;
}

/** Whether a process is known by `key`, allowing for the kernel cutting names at 15 characters. */
function hasName(proc, key) {
    return proc.names.has(key) || (key.length > 15 && proc.names.has(key.slice(0, 15)));
}

module.exports = { linuxProcesses, exeKey, hasName };
