'use strict';

// Game detection against fake homes and /proc trees; no Electron, Steam or launcher needed.
// Run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { linuxProcesses, hasName } = require('../main/activity/procs');
const { runningSteamGame, runningAppIdFromProcesses, parseBinaryVdf } = require('../main/activity/steam');
const { launcherGames } = require('../main/activity/launchers');

function tree(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lala-activity-'));
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), content);
    }
    return root;
}

/** Steam's binary KeyValues, the inverse of parseBinaryVdf for maps, strings and int32. */
function binaryVdf(obj) {
    const parts = [];
    const walk = (o) => {
        for (const [k, v] of Object.entries(o)) {
            if (typeof v === 'number') {
                const n = Buffer.alloc(4);
                n.writeUInt32LE(v);
                parts.push(Buffer.from([0x02]), Buffer.from(`${k}\0`), n);
            } else if (typeof v === 'string') {
                parts.push(Buffer.from([0x01]), Buffer.from(`${k}\0${v}\0`));
            } else {
                parts.push(Buffer.from([0x00]), Buffer.from(`${k}\0`));
                walk(v);
                parts.push(Buffer.from([0x08]));
            }
        }
    };
    walk(obj);
    parts.push(Buffer.from([0x08]));
    return Buffer.concat(parts);
}

test('process names: comm, argv[0] and a Wine exe', () => {
    const proc = tree({
        '10/comm': 'Hades2.exe\n',
        '10/cmdline': 'Z:\\home\\e\\Games\\Hades II\\Ship\\Hades2.exe\0',
        '11/comm': 'wine64-preloade\n',
        '11/cmdline': '/usr/bin/wine64-preloader\0/usr/bin/wine64\0C:\\Games\\SomeVeryLongGameName.exe\0',
        'self/comm': 'node\n',
    });
    const procs = linuxProcesses(proc);
    assert.equal(procs.length, 2);
    const hades = procs.find(p => p.pid === 10);
    assert.ok(hasName(hades, 'hades2'));
    assert.ok(hasName(procs.find(p => p.pid === 11), 'someverylonggamename'));
    assert.ok(hasName({ names: new Set(['someverylongga']) }, 'someverylonggamename') === false);
    assert.ok(hasName({ names: new Set(['someverylonggam']) }, 'someverylonggamename'));
});

test('steam: the AppId from reaper, ignoring later arguments', () => {
    const procs = [
        { args: ['/usr/bin/bash'] },
        { args: ['/home/e/.steam/steam/ubuntu12_32/reaper', 'SteamLaunch', 'AppId=105600', '--', '/x/proton', 'waitforexitandrun', 'AppId=1'] },
    ];
    assert.equal(runningAppIdFromProcesses(procs), 105600);
    assert.equal(runningAppIdFromProcesses([{ args: ['reaper', 'SteamLaunch', 'AppId=0', '--'] }]), 0);
    assert.equal(runningAppIdFromProcesses([{ args: ['game', 'AppId=5'] }]), 0);
});

test('steam: a game by its appmanifest, a shortcut by shortcuts.vdf', () => {
    const root = tree({
        'steamapps/libraryfolders.vdf': '"libraryfolders" { "0" { "path" "/nonexistent" } }',
        'steamapps/appmanifest_105600.acf': '"AppState" { "appid" "105600" "name" "Terraria" }',
        'userdata/123/config/shortcuts.vdf': binaryVdf({ shortcuts: { 0: { appid: 3123456789, AppName: 'Hades II', Exe: '"/g/Hades2.exe"', icon: '' } } }),
    });
    const launch = (id) => [{ args: ['reaper', 'SteamLaunch', `AppId=${id}`, '--'] }];
    assert.deepEqual(runningSteamGame({ procs: launch(105600), roots: [root] }), {
        appId: 105600, name: 'Terraria', iconPath: null, url: 'https://store.steampowered.com/app/105600',
    });
    assert.deepEqual(runningSteamGame({ procs: launch(3123456789), roots: [root] }), { appId: 3123456789, name: 'Hades II', iconPath: null });
    // The 64-bit game ID form of the same shortcut.
    const gameId = (BigInt(3123456789) << 32n) | 0x02000000n;
    assert.equal(runningSteamGame({ procs: launch(gameId), roots: [root] })?.name, 'Hades II');
    assert.equal(runningSteamGame({ procs: launch(42), roots: [root] }), null);
});

test('steam: binary vdf with uint64 and a broken file', () => {
    const buf = Buffer.concat([Buffer.from([0x00]), Buffer.from('a\0'), Buffer.from([0x07]), Buffer.from('big\0'), Buffer.alloc(8, 1), Buffer.from([0x08, 0x08])]);
    assert.equal(typeof parseBinaryVdf(buf).a.big, 'bigint');
    assert.throws(() => parseBinaryVdf(Buffer.from([0x01, 0x61])));
});

test('launchers: Bottles, Heroic and Lutris by executable', () => {
    const home = tree({
        '.var/app/com.usebottles.bottles/data/bottles/bottles/Rip/bottle.yml': [
            'Name: Rip',
            'External_Programs:',
            '  3a1b:',
            '    executable: Hades2.exe',
            '    name: "Hades II: Early"',
            '    path: /home/e/Games/Hades II/Ship/Hades2.exe',
            '  9c2d:',
            '    executable: setup.exe',
            '    name: Old',
            '    removed: true',
            '',
        ].join('\n'),
        '.config/heroic/legendaryConfig/legendary/installed.json': JSON.stringify({ Fortnite: { title: 'Celeste', executable: 'Celeste.exe' } }),
        '.config/heroic/sideload_apps/library.json': JSON.stringify({ games: [{ title: 'My Game', install: { executable: '/opt/mygame/mygame.x86_64' } }] }),
        'gog/witcher/goggame-1207664663.info': JSON.stringify({ name: 'The Witcher 3', playTasks: [{ isPrimary: true, path: 'bin\\x64\\witcher3.exe' }] }),
        '.local/share/lutris/games/stardew-1700000000.yml': 'game:\n  exe: /home/e/Games/stardew/StardewValley\n',
    });
    fs.mkdirSync(path.join(home, '.config/heroic/gog_store'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config/heroic/gog_store/installed.json'), JSON.stringify({ installed: [{ appName: '1207664663', install_path: path.join(home, 'gog/witcher') }] }));
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(home, '.local/share/lutris/pga.db'));
    db.exec('CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, configpath TEXT, installed INTEGER)');
    db.prepare('INSERT INTO games (name, slug, configpath, installed) VALUES (?, ?, ?, ?)').run('Stardew Valley', 'stardew-valley', 'stardew-1700000000', 1);
    db.prepare('INSERT INTO games (name, slug, configpath, installed) VALUES (?, ?, ?, ?)').run('Gone', 'gone', '../../etc/x', 1);
    db.close();

    const games = launcherGames(home, 1);
    assert.deepEqual(Object.fromEntries([...games].map(([k, v]) => [k, v.name])), {
        hades2: 'Hades II: Early',
        celeste: 'Celeste',
        'witcher3': 'The Witcher 3',
        'mygame.x86_64': 'My Game',
        stardewvalley: 'Stardew Valley',
    });
    assert.equal(launcherGames(home, 2), games, 'cached between polls');
});

test('added games: stored on disk, cleaned names, one per program', () => {
    const { AddedGames } = require('../main/activity/added');
    const file = path.join(tree({}), 'sub/games.json');
    const store = new AddedGames(file);
    const hades = store.add('hades2', 'Hades2');
    assert.equal(store.add('hades2', 'Other').id, hades.id);
    assert.ok(store.rename(hades.id, '  Hades\u0000 II\n'));
    assert.equal(store.rename(hades.id, '   '), false);
    assert.equal(store.rename('nope', 'x'), false);
    store.add('celeste', 'x'.repeat(300));
    const again = new AddedGames(file);
    assert.deepEqual(again.list().map(g => g.name), ['Hades II', 'x'.repeat(100)]);
    assert.equal(again.byKey().get('hades2'), 'Hades II');
    assert.ok(again.remove(hades.id));
    assert.equal(again.remove(hades.id), false);
    assert.deepEqual(new AddedGames(file).list().length, 1);
    fs.writeFileSync(file, '{ broken');
    assert.deepEqual(new AddedGames(file).list(), []);
});

test('running programs: Wine exes and programs from home, not the system or helpers', () => {
    const { linuxPrograms } = require('../main/activity/added');
    const home = '/home/e';
    const proc = tree({
        '1/comm': 'Hades2.exe\n', '1/cmdline': 'Z:\\home\\e\\Games\\Hades II\\Ship\\Hades2.exe\0',
        '2/comm': 'services.exe\n', '2/cmdline': 'C:\\windows\\system32\\services.exe\0',
        '3/comm': 'bash\n', '3/cmdline': '/usr/bin/bash\0',
        '4/comm': 'Game.x86_64\n', '4/cmdline': './Game.x86_64\0',
        '5/comm': 'steamwebhelper\n', '5/cmdline': '/home/e/.local/share/Steam/ubuntu12_64/steamwebhelper\0',
        '6/comm': 'lala\n', '6/cmdline': 'lala\0',
    });
    fs.symlinkSync('/usr/bin/bash', path.join(proc, '3/exe'));
    fs.symlinkSync('/home/e/Games/Celeste/Game.x86_64', path.join(proc, '4/exe'));
    fs.symlinkSync('/home/e/.local/share/Steam/ubuntu12_64/steamwebhelper', path.join(proc, '5/exe'));
    fs.symlinkSync('/opt/lala/electron', path.join(proc, '6/exe'));
    const list = linuxPrograms({ home, procRoot: proc, ownPid: 0, skip: new Set(['electron']) });
    assert.deepEqual(list, [
        { key: 'hades2', name: 'Hades2', label: 'Hades2.exe — Hades II/Ship' },
        { key: 'game.x86_64', name: 'Game', label: 'Game.x86_64 — Games/Celeste' },
    ]);
});
