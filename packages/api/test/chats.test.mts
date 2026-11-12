import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';

process.env.LIVEKIT_API_SECRET = 'unit-test-secret';

const { parseConfig, rulesVersion } = await import('../src/lib/config');
const media = await import('../src/lib/media');
const { sanitizeMessageText } = await import('../src/lib/sanitize');
const { EMOJI, mentionedIn, previewOf, compareIds } = await import('../src/lib/chats');

/** An EXIF (TIFF, little-endian) block with an orientation and a GPS latitude. */
function exif(orientation: number): Buffer {
    const tiff = Buffer.alloc(8 + 2 + 2 * 12 + 4 + 2 + 12 + 4 + 24);
    tiff.write('II', 0, 'latin1');
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);
    const gps = 8 + 2 + 24 + 4;
    const data = gps + 2 + 12 + 4;
    tiff.writeUInt16LE(2, 8);
    tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(orientation, 18);
    tiff.writeUInt16LE(0x8825, 22); tiff.writeUInt16LE(4, 24); tiff.writeUInt32LE(1, 26); tiff.writeUInt32LE(gps, 30);
    tiff.writeUInt16LE(1, gps);
    tiff.writeUInt16LE(0x0002, gps + 2); tiff.writeUInt16LE(5, gps + 4); tiff.writeUInt32LE(3, gps + 6); tiff.writeUInt32LE(data, gps + 10);
    tiff.fill(0x55, data, data + 24);
    return tiff;
}

function jpeg(orientation: number): Buffer {
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exif(orientation)]);
    const app1 = Buffer.alloc(4); app1.writeUInt16BE(0xffe1, 0); app1.writeUInt16BE(body.length + 2, 2);
    const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xc8, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, body, sof, Buffer.from([0xff, 0xd9])]);
}

function pngChunk(type: string, data: Buffer): Buffer {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
    return Buffer.concat([head, data, crc]);
}

function png(extra: Buffer[] = []): Buffer {
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(640, 0); ihdr.writeUInt32BE(360, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', ihdr), ...extra, pngChunk('IEND', Buffer.alloc(0))]);
}

const chunksValid = (data: Buffer) => {
    for (let at = 8; at + 12 <= data.length;) {
        const length = data.readUInt32BE(at);
        if (data.readUInt32BE(at + 8 + length) !== crc32(data.subarray(at + 4, at + 8 + length))) return false;
        at += 12 + length;
    }
    return true;
};

describe('file types', () => {
    const box = (type: string, body: Buffer) => {
        const head = Buffer.alloc(8); head.writeUInt32BE(8 + body.length, 0); head.write(type, 4, 'latin1');
        return Buffer.concat([head, body]);
    };
    const ftyp = (...brands: string[]) => box('ftyp', Buffer.from(brands[0] + '\0\0\0\0' + brands.slice(1).join(''), 'latin1'));

    test('comes from the content', () => {
        assert.equal(media.detectType(png()), 'image/png');
        assert.equal(media.detectType(jpeg(1)), 'image/jpeg');
        assert.equal(media.detectType(Buffer.from('GIF89a\x10\x00\x10\x00', 'latin1')), 'image/gif');
        assert.equal(media.detectType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')), 'image/webp');
        assert.equal(media.detectType(Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1')), 'audio/wav');
        assert.equal(media.detectType(ftyp('isom', 'isom', 'mp41')), 'video/mp4');
        assert.equal(media.detectType(ftyp('mif1', 'mif1', 'avif')), 'image/avif');
        assert.equal(media.detectType(ftyp('heic', 'mif1')), 'image/heic');
        assert.equal(media.detectType(ftyp('M4A ', 'isom')), 'audio/mp4');
        assert.equal(media.detectType(Buffer.from('ID3\x04\0\0\0\0\0\0', 'latin1')), 'audio/mpeg');
        assert.equal(media.detectType(Buffer.from('OggS\0\x02', 'latin1')), 'audio/ogg');
        assert.equal(media.detectType(Buffer.from('fLaC\0\0\0\x22', 'latin1')), 'audio/flac');
        assert.equal(media.detectType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84, ...Buffer.from('webm')])), 'video/webm');
    });

    test('anything else is a download, whatever it is called', () => {
        assert.equal(media.detectType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), media.DOWNLOAD_TYPE);
        assert.equal(media.detectType(Buffer.from('<!doctype html><script>alert(1)</script>')), media.DOWNLOAD_TYPE);
        assert.equal(media.detectType(Buffer.from('%PDF-1.7')), media.DOWNLOAD_TYPE);
        assert.equal(media.detectType(Buffer.alloc(0)), media.DOWNLOAD_TYPE);
        assert.equal(media.INLINE_TYPES.has('image/heic'), false);
    });

    test('an MP4 says its video size in the track header', async () => {
        const tkhd = (w: number, h: number) => {
            const b = Buffer.alloc(84); b.writeUInt32BE(w << 16, 76); b.writeUInt32BE(h << 16, 80);
            return box('tkhd', b);
        };
        const moov = box('moov', Buffer.concat([box('trak', tkhd(0, 0)), box('trak', tkhd(1280, 720))]));
        const file = Buffer.concat([ftyp('isom', 'isom'), box('mdat', Buffer.alloc(1000)), moov]);
        const found = await media.findMoov(async (at, length) => file.subarray(at, at + length), file.length);
        assert.ok(found);
        assert.deepEqual(media.mp4Size(found.data), { width: 1280, height: 720 });
    });

    test('a WebM says its video size in its track entry', () => {
        const el = (id: number[], body: Buffer) => Buffer.concat([Buffer.from(id), Buffer.from([0x80 | body.length]), body]);
        const video = el([0xe0], Buffer.concat([el([0xb0], Buffer.from([0x07, 0x80])), el([0xba], Buffer.from([0x04, 0x38]))]));
        const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], video));
        const file = Buffer.concat([el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], Buffer.from('webm'))), Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), tracks]);
        assert.deepEqual(media.webmSize(file), { width: 1920, height: 1080 });
    });
});

describe('picture location', () => {
    test('a JPEG loses its GPS data and keeps its size and orientation', () => {
        const data = jpeg(6);
        const length = data.length;
        assert.ok(data.includes(Buffer.alloc(24, 0x55)));
        const { changed, orientation } = media.stripPictureLocation(data, 'image/jpeg');
        assert.equal(changed, true);
        assert.equal(orientation, 6);
        assert.equal(data.length, length);
        assert.ok(!data.includes(Buffer.alloc(24, 0x55)));
        // Turned by 90°, so the shown size swaps the sides of the stored one (200x100).
        assert.deepEqual(media.pictureSize(data, 'image/jpeg', orientation), { width: 100, height: 200 });
        assert.equal(media.stripPictureLocation(data, 'image/jpeg').changed, false);
    });

    test('a PNG loses eXIf and XMP coordinates and its chunks stay valid', () => {
        const xmp = Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<rdf:Description exif:GPSLatitude="52,31.2N" exif:GPSLongitude="13,24.3E"/><exif:GPSAltitude>34/1</exif:GPSAltitude>', 'latin1');
        const data = png([pngChunk('eXIf', exif(1)), pngChunk('iTXt', xmp)]);
        const { changed } = media.stripPictureLocation(data, 'image/png');
        assert.equal(changed, true);
        const text = data.toString('latin1');
        assert.ok(!text.includes('52,31.2N') && !text.includes('GPSAltitude') && !text.includes('13,24.3E'));
        assert.ok(!data.includes(Buffer.alloc(24, 0x55)));
        assert.ok(chunksValid(data));
        assert.deepEqual(media.pictureSize(data, 'image/png'), { width: 640, height: 360 });
    });

    test('a video loses its ISO 6709 location', () => {
        const moov = Buffer.from('....udta....\xa9xyz\x00\x12\x15\xc7+52.5200+013.4050/....', 'latin1');
        assert.equal(media.stripVideoLocation(moov), true);
        assert.ok(!moov.toString('latin1').includes('52.52'));
    });

    test('cut-off files give no size rather than failing', () => {
        assert.equal(media.pictureSize(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00]), 'image/jpeg'), undefined);
        assert.equal(media.pictureSize(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'), 'image/webp'), undefined);
        assert.deepEqual(media.stripPictureLocation(Buffer.from('Exif\0\0II*\0\xff\xff\xff\xff', 'latin1'), 'image/jpeg'), { changed: false, orientation: 1 });
    });
});

describe('chats in the config', () => {
    test('chats get an ID from their name, rules a version from their text', () => {
        const config = parseConfig({
            chats: [{ name: 'General Chat', topic: ' Anything ' }, { id: 'news', name: 'Announcements', post: 'admins' }],
            rules: { text: '# Rules\nBe kind.', required: true },
            chatHistory: { days: 7 },
            chatFiles: { space: '2GB' },
        });
        assert.deepEqual(config.chats, [
            { id: 'general-chat', name: 'General Chat', topic: 'Anything', post: 'everyone' },
            { id: 'news', name: 'Announcements', topic: undefined, post: 'admins' },
        ]);
        assert.deepEqual(config.rules, { text: '# Rules\nBe kind.', version: rulesVersion('# Rules\nBe kind.'), required: true });
        assert.deepEqual(config.chatHistory, { days: 7, messages: 10_000 });
        // Nothing ever deleted: no age limit and no count limit.
        assert.deepEqual(parseConfig({ chatHistory: { messages: 0 } }).chatHistory, { days: undefined, messages: 0 });
        assert.deepEqual(config.chatFiles, { space: 2 * 1024 ** 3, maxFile: undefined });
        assert.equal(parseConfig({ chatFiles: { maxFile: '25MB' } }).chatFiles.maxFile, 25 * 1024 ** 2);
    });

    test('an edit to the rules makes a new version', () => {
        assert.notEqual(rulesVersion('Be kind.'), rulesVersion('Be kind!'));
    });

    test('defaults: no chats, no rules, 10,000 messages a chat with no age limit, 1 GB', () => {
        const config = parseConfig({});
        assert.deepEqual(config.chats, []);
        assert.equal(config.rules, undefined);
        assert.deepEqual(config.chatHistory, { days: undefined, messages: 10_000 });
        assert.deepEqual(config.chatFiles, { space: 1024 ** 3, maxFile: undefined });
    });

    test('mistakes stop the server with the line they are on', () => {
        assert.throws(() => parseConfig({ chats: [{ name: 'a' }, { name: 'A' }] }), /chats\[1\]\.id: "a" is used twice/);
        assert.throws(() => parseConfig({ chats: [{ name: '!!!' }] }), /chats\[0\]\.id: the name has no letters/);
        assert.throws(() => parseConfig({ chats: [{ name: 'a', id: 'Not OK' }] }), /chats\[0\]\.id/);
        assert.throws(() => parseConfig({ chats: [{ name: 'a', post: 'nobody' }] }), /chats\[0\]\.post/);
        assert.throws(() => parseConfig({ chats: [{ name: 'a', color: 'red' }] }), /unknown key "color"/);
        assert.throws(() => parseConfig({ rules: { text: '' } }), /rules\.text/);
        assert.throws(() => parseConfig({ rules: { text: 'x', required: 'yes' } }), /rules\.required/);
        assert.throws(() => parseConfig({ chatFiles: { space: '1000' } }), /chatFiles\.space/);
        assert.throws(() => parseConfig({ chatFiles: { space: '100KB' } }), /at least 1MB/);
        assert.throws(() => parseConfig({ chatFiles: { maxFile: 'big' } }), /chatFiles\.maxFile/);
        assert.throws(() => parseConfig({ chatHistory: { days: 0 } }), /chatHistory\.days/);
    });
});

describe('messages', () => {
    test('keep line breaks, lose control and direction characters', () => {
        assert.equal(sanitizeMessageText('  a\r\nb\rc\td\u0000e\u202ef\u2028  '), 'a\nb\nc\tdef');
        // Joiners hold emoji sequences together.
        assert.equal(sanitizeMessageText('\u{1f469}\u200d\u{1f4bb}'), '\u{1f469}\u200d\u{1f4bb}');
    });

    test('mentions are identities, each once', () => {
        const id = 'a'.repeat(36);
        assert.deepEqual(mentionedIn(`<@${id}> hi <@${id}> and <@bot-radio> not <@nobody>`), [id, 'bot-radio']);
    });

    test('a reaction is one emoji', () => {
        for (const ok of ['\u{1f44d}', '\u2764\ufe0f', '\u{1f469}\u200d\u{1f4bb}', '\u{1f1e9}\u{1f1ea}', '\u{1f44d}\u{1f3fd}', '#\ufe0f\u20e3']) assert.ok(EMOJI.test(ok), ok);
        for (const bad of ['a', '👍 ', '<b>', '']) assert.ok(!EMOJI.test(bad), bad);
    });

    test('a reply preview is the first 200 characters, never half an emoji', () => {
        const preview = previewOf('1-0', { identity: 'x', name: 'X', text: 'a'.repeat(199) + '😀😀' });
        assert.equal(Array.from(preview.text).length, 200);
        assert.ok(preview.text.endsWith('😀'));
    });

    test('IDs sort by time, then sequence', () => {
        assert.deepEqual(['10-1', '9-5', '10-0'].sort(compareIds), ['9-5', '10-0', '10-1']);
    });
});
