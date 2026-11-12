import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LIVEKIT_API_SECRET = 'unit-test-secret';

const { ConfigError, loadConfig, parseConfig } = await import('../src/lib/config');

describe('config mistakes', () => {
    test('a room password written as a number asks for quotes', () => {
        assert.throws(() => parseConfig({ rooms: [{ name: 'General', password: 1 }] }), /rooms\[0\]\.password: expected text; put it in quotes: password: "1"/);
        assert.throws(() => parseConfig({ rooms: [{ name: 'General', password: '' }] }), /rooms\[0\]\.password: expected text$/);
        assert.equal(parseConfig({ rooms: [{ name: 'General', password: '1' }] }).rooms[0].password, '1');
    });

    test('a file that is not valid YAML is a config error naming the file and line', () => {
        const dir = mkdtempSync(join(tmpdir(), 'lala-config-'));
        const path = join(dir, 'lala.yaml');
        writeFileSync(path, 'users:\n  xe:\n    role: admin\n     ids:\n      - abc\n');
        process.env.LALA_CONFIG = path;
        try {
            assert.throws(loadConfig, (err: unknown) => err instanceof ConfigError && err.message.startsWith(`${path}: `) && /at line 3, column 11/.test(err.message));
        } finally {
            delete process.env.LALA_CONFIG;
            rmSync(dir, { recursive: true });
        }
    });
});
