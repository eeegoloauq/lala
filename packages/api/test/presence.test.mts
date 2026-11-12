import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LIVEKIT_API_SECRET = 'unit-test-secret';

const { issueTicket, verifyTicket, shownStatus, buildPresenceList } = await import('../src/lib/presence');
type PresenceState = import('../src/lib/presence').PresenceState;

const A = 'a'.repeat(36);
const B = 'b'.repeat(36);
const C = 'c'.repeat(36);
const G = 'f'.repeat(36);

describe('presence tickets', () => {
    test('a ticket names its identity until it expires', () => {
        const now = Date.now();
        const ticket = issueTicket(A, now);
        assert.equal(verifyTicket(ticket, now), A);
        assert.equal(verifyTicket(ticket, now + 4 * 60 * 1000), A);
        assert.equal(verifyTicket(ticket, now + 6 * 60 * 1000), null);
    });

    test('a changed identity, expiry or signature is refused', () => {
        const [, expiry, sig] = issueTicket(A).split('.');
        assert.equal(verifyTicket(`${B}.${expiry}.${sig}`), null);
        assert.equal(verifyTicket(`${A}.${Number(expiry) + 60}.${sig}`), null);
        assert.equal(verifyTicket(`${A}.${expiry}.${sig.slice(0, -1)}x`), null);
        assert.equal(verifyTicket('nonsense'), null);
    });
});

describe('presence status', () => {
    test('online goes idle without input; the other choices stay', () => {
        assert.equal(shownStatus({ status: 'online', idle: true }), 'idle');
        assert.equal(shownStatus({ status: 'dnd', idle: true }), 'dnd');
        assert.equal(shownStatus({ status: 'invisible' }), 'offline');
        assert.equal(shownStatus(undefined), 'online');
    });
});

describe('the people list', () => {
    const users = new Map([[A, { name: 'alex' }], [B, { name: 'alex' }], [C, { name: 'sam' }]]);
    const states = (entries: Array<[string, PresenceState]>) => new Map(entries);
    const byId = (people: ReturnType<typeof buildPresenceList>) => new Map(people.map(p => [p.identity, p]));

    test('a member with two devices is one row, from the device used last', () => {
        const people = buildPresenceList({
            online: new Set([A, B]),
            states: states([[A, { name: 'Alex laptop', at: 1 }], [B, { name: 'Alex phone', at: 2, status: 'dnd' }]]),
            users, banned: new Set(), caller: G,
        });
        const alex = people.filter(p => p.identity === A || p.identity === B);
        assert.deepEqual(alex, [{ identity: B, name: 'Alex phone', status: 'dnd' }]);
    });

    test('members who are not online are offline, under their last name or the config key', () => {
        const people = byId(buildPresenceList({
            online: new Set(), states: states([[A, { name: 'Alex', at: 5 }]]), users, banned: new Set(), caller: G,
        }));
        assert.deepEqual(people.get(A), { identity: A, name: 'Alex', status: 'offline' });
        assert.deepEqual(people.get(C), { identity: C, name: 'sam', status: 'offline' });
    });

    test('an invisible person is offline to others and sees their own row', () => {
        const input = { online: new Set([C, G]), states: states([[C, { name: 'Sam', status: 'invisible' as const }], [G, { name: 'Guest', status: 'invisible' as const }]]), users, banned: new Set<string>() };
        const others = byId(buildPresenceList({ ...input, caller: A }));
        assert.equal(others.get(C)?.status, 'offline');
        assert.equal(others.has(G), false);
        assert.equal(byId(buildPresenceList({ ...input, caller: G })).get(G)?.status, 'offline');
    });

    test('guests are listed while online and banned people never', () => {
        const people = byId(buildPresenceList({
            online: new Set([G, C]), states: states([[G, { name: 'Guest' }], [C, { name: 'Sam' }]]),
            users, banned: new Set([C]), caller: A,
        }));
        assert.deepEqual(people.get(G), { identity: G, name: 'Guest', status: 'online' });
        assert.equal(people.has(C), false);
    });
});
