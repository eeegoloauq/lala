import { crc32 } from 'node:zlib';

/**
 * What an uploaded file is, from its content rather than the uploader's claim, and the
 * parts of it the server changes or reads: location metadata (removed, in place, so the
 * file keeps its size) and the picture or video size the client reserves before it loads.
 */

/** Shown in the page: everything else is served as a download. */
export const INLINE_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
    'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/flac', 'audio/mp4', 'audio/webm',
    'video/mp4', 'video/webm',
]);

export const DOWNLOAD_TYPE = 'application/octet-stream';

/** Enough of the start of a file for `detectType`. */
export const HEAD_BYTES = 64 * 1024;

const ascii = (data: Buffer, start: number, end: number) => data.subarray(start, end).toString('latin1');

/** The ISO base media brands (`ftyp`) by what they are. */
function brandType(data: Buffer): string | undefined {
    if (ascii(data, 4, 8) !== 'ftyp') return undefined;
    const size = Math.min(data.readUInt32BE(0), data.length);
    const brands = [ascii(data, 8, 12)];
    for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(data, at, at + 4));
    if (brands.some((b) => b === 'avif' || b === 'avis')) return 'image/avif';
    if (brands.some((b) => ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].includes(b))) return 'image/heic';
    if (brands.some((b) => b === 'M4A ' || b === 'M4B ')) return 'audio/mp4';
    if (brands[0] === 'qt  ') return 'video/quicktime';
    if (brands.some((b) => ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ', 'MSNV', '3gp4', '3gp5'].includes(b))) return 'video/mp4';
    return undefined;
}

/** The EBML document type of a Matroska file: `webm` for WebM. */
function ebmlDocType(data: Buffer): string | undefined {
    const at = data.indexOf(Buffer.from([0x42, 0x82]), 4);
    if (at < 0 || at > 64) return undefined;
    const size = vint(data, at + 2);
    if (!size || size.value > 32) return undefined;
    return ascii(data, at + 2 + size.length, at + 2 + size.length + size.value);
}

/** The type of a file from its first bytes (`HEAD_BYTES` of them), `DOWNLOAD_TYPE` when unknown. */
export function detectType(head: Buffer): string {
    const starts = (bytes: number[], at = 0) => head.length >= at + bytes.length && bytes.every((b, i) => head[at + i] === b);
    if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') return 'image/gif';
    if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp';
    if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WAVE') return 'audio/wav';
    if (head.length >= 12) {
        const brand = brandType(head);
        if (brand) return brand;
    }
    if (ascii(head, 0, 4) === 'fLaC') return 'audio/flac';
    if (ascii(head, 0, 4) === 'OggS') return 'audio/ogg';
    if (ascii(head, 0, 3) === 'ID3') return 'audio/mpeg';
    // An MPEG audio frame: 11 sync bits, a layer other than "reserved", a bitrate other than "bad".
    if (head.length >= 4 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0 && (head[2] & 0xf0) !== 0xf0) return 'audio/mpeg';
    if (starts([0x1a, 0x45, 0xdf, 0xa3]) && ebmlDocType(head) === 'webm') return 'video/webm';
    return DOWNLOAD_TYPE;
}

export const isPicture = (type: string) => type.startsWith('image/');

export interface Size { width: number; height: number }

const valid = (width: number, height: number): Size | undefined =>
    width > 0 && height > 0 && width <= 65535 && height <= 65535 ? { width, height } : undefined;

/** A picture's size as the browser shows it (an EXIF rotation by 90° swaps the sides). */
export function pictureSize(data: Buffer, type: string, orientation = 1): Size | undefined {
    const size = rawPictureSize(data, type);
    return size && orientation >= 5 && orientation <= 8 ? { width: size.height, height: size.width } : size;
}

function rawPictureSize(data: Buffer, type: string): Size | undefined {
    try {
        if (type === 'image/png') return valid(data.readUInt32BE(16), data.readUInt32BE(20));
        if (type === 'image/gif') return valid(data.readUInt16LE(6), data.readUInt16LE(8));
        if (type === 'image/webp') {
            const chunk = ascii(data, 12, 16);
            if (chunk === 'VP8 ') return valid(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff);
            if (chunk === 'VP8L') {
                const bits = data.readUInt32LE(21);
                return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
            }
            if (chunk === 'VP8X') return valid(data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1);
            return undefined;
        }
        if (type === 'image/jpeg') {
            for (let at = 2; at + 9 < data.length;) {
                if (data[at] !== 0xff) return undefined;
                const marker = data[at + 1];
                if (marker === 0xff) { at++; continue; }
                // Start of frame: every SOFn except DHT (C4), JPG (C8) and DAC (CC).
                if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                    return valid(data.readUInt16BE(at + 7), data.readUInt16BE(at + 5));
                }
                if (marker === 0xd9 || marker === 0xda) return undefined;
                at += 2 + data.readUInt16BE(at + 2);
            }
            return undefined;
        }
        if (type === 'image/avif') {
            // The largest image spatial extent: the primary image, not a thumbnail or alpha plane.
            let best: Size | undefined;
            const end = Math.min(data.length, HEAD_BYTES);
            for (let at = data.indexOf('ispe'); at >= 0 && at + 16 <= end; at = data.indexOf('ispe', at + 4)) {
                const size = valid(data.readUInt32BE(at + 8), data.readUInt32BE(at + 12));
                if (size && (!best || size.width * size.height > best.width * best.height)) best = size;
            }
            return best;
        }
    } catch {
        return undefined;   // cut short: no size, the client copes
    }
    return undefined;
}

// ─── Video size ───

/** Reads `length` bytes at `position` of the file; fewer at its end. */
export type ReadAt = (position: number, length: number) => Promise<Buffer>;

/** An MP4's top-level `moov` box: where it is and what it holds (at most 32 MB of it). */
export async function findMoov(read: ReadAt, fileSize: number): Promise<{ at: number; data: Buffer } | undefined> {
    for (let at = 0; at + 8 <= fileSize;) {
        const header = await read(at, 16);
        if (header.length < 8) return undefined;
        let size = header.readUInt32BE(0);
        let headerSize = 8;
        if (size === 1) {
            if (header.length < 16) return undefined;
            size = Number(header.readBigUInt64BE(8));
            headerSize = 16;
        } else if (size === 0) {
            size = fileSize - at;
        }
        if (size < headerSize) return undefined;
        if (ascii(header, 4, 8) === 'moov') {
            if (size > 32 * 1024 * 1024) return undefined;
            return { at, data: await read(at, size) };
        }
        at += size;
    }
    return undefined;
}

/** The size of an MP4's first video track, from its track header. */
export function mp4Size(moov: Buffer): Size | undefined {
    for (let at = moov.indexOf('tkhd'); at >= 4; at = moov.indexOf('tkhd', at + 4)) {
        const box = at - 4;
        const version = moov[at + 4];
        // Width and height are the last two fields, 16.16 fixed point.
        const end = box + (version === 1 ? 104 : 92);
        if (end > moov.length) return undefined;
        const size = valid(moov.readUInt32BE(end - 8) >>> 16, moov.readUInt32BE(end - 4) >>> 16);
        if (size) return size;   // an audio track has 0x0
    }
    return undefined;
}

/** A Matroska variable-length integer at `at`: its value and how many bytes it took. */
function vint(data: Buffer, at: number, keepMarker = false): { value: number; length: number } | undefined {
    const first = data[at];
    if (first === undefined || first === 0) return undefined;
    const length = Math.clz32(first) - 23;
    if (length > 8 || at + length > data.length) return undefined;
    let value = keepMarker ? first : first & (0xff >> length);
    for (let i = 1; i < length; i++) value = value * 256 + data[at + i];
    return { value, length };
}

/** The video size of a WebM file, from the track entries at its start. */
export function webmSize(head: Buffer): Size | undefined {
    // Segment, Tracks, TrackEntry and Video hold the sizes; everything else is skipped.
    const containers = new Set([0x18538067, 0x1654ae6b, 0xae, 0xe0]);
    let width = 0;
    let height = 0;
    for (let at = 0; at < head.length;) {
        const id = vint(head, at, true);
        if (!id) return undefined;
        const size = vint(head, at + id.length);
        if (!size) return undefined;
        const body = at + id.length + size.length;
        if (containers.has(id.value)) {
            at = body;
            continue;
        }
        if (id.value === 0xb0 || id.value === 0xba) {
            const value = head.readUIntBE(body, Math.min(size.value, 6));
            if (id.value === 0xb0) width = value; else height = value;
            if (width && height) return valid(width, height);
        }
        if (id.value === 0x1f43b675) return undefined;   // the first cluster: past the tracks
        at = body + size.value;
    }
    return undefined;
}

// ─── Location ───

/**
 * Empties the GPS directory of the EXIF (TIFF) block starting at `tiff`, in place. Returns
 * the picture's orientation (1 when it says none) and whether anything changed.
 */
function clearExifGps(data: Buffer, tiff: number): { orientation: number; changed: boolean } | undefined {
    const order = ascii(data, tiff, tiff + 2);
    if (order !== 'II' && order !== 'MM') return undefined;
    const le = order === 'II';
    const u16 = (at: number) => le ? data.readUInt16LE(at) : data.readUInt16BE(at);
    const u32 = (at: number) => le ? data.readUInt32LE(at) : data.readUInt32BE(at);
    const inside = (at: number, length: number) => at >= tiff && at + length <= data.length;
    if (!inside(tiff, 8) || u16(tiff + 2) !== 42) return undefined;

    const ifd0 = tiff + u32(tiff + 4);
    if (!inside(ifd0, 2)) return undefined;
    const count = u16(ifd0);
    if (!inside(ifd0 + 2, count * 12)) return undefined;
    let orientation = 1;
    let gps: number | undefined;
    for (let i = 0; i < count; i++) {
        const entry = ifd0 + 2 + i * 12;
        const tag = u16(entry);
        if (tag === 0x0112) orientation = u16(entry + 8);
        if (tag === 0x8825) gps = tiff + u32(entry + 8);
    }
    if (gps === undefined || !inside(gps, 2)) return { orientation, changed: false };

    const entries = u16(gps);
    if (entries === 0 || !inside(gps + 2, entries * 12)) return { orientation, changed: false };
    const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
    for (let i = 0; i < entries; i++) {
        const entry = gps + 2 + i * 12;
        const bytes = (TYPE_SIZE[u16(entry + 2)] ?? 0) * u32(entry + 4);
        // Values over four bytes are stored elsewhere; those go too.
        if (bytes > 4) {
            const at = tiff + u32(entry + 8);
            if (inside(at, bytes)) data.fill(0, at, at + bytes);
        }
    }
    // No entries, and the zeros after the count read as "no next directory".
    data.fill(0, gps, gps + 2 + entries * 12);
    return { orientation, changed: true };
}

// Coordinates in XMP, as attributes or elements (`exif:GPSLatitude`, `exif:GPSLongitude`, …),
// and ISO 6709 strings like phones write into videos (`+52.5200+013.4050+034.000/`).
const XMP_GPS = /exif(?:EX)?:GPS\w*="[^"]*"|<exif(?:EX)?:GPS(\w*)>[^<]*<\/exif(?:EX)?:GPS\1>/g;
const ISO6709 = /[+-]\d{2}(?:\.\d+)?[+-]\d{3}(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)?(?:CRS[\w:]+)?\//g;

/** Overwrites each match with spaces (same length, so offsets and sizes stay right). */
function blank(data: Buffer, pattern: RegExp): boolean {
    const text = data.toString('latin1');
    let changed = false;
    for (const match of text.matchAll(pattern)) {
        data.fill(0x20, match.index, match.index + match[0].length);
        changed = true;
    }
    return changed;
}

/** PNG chunks carry a CRC; after changing one in place it has to be recomputed. */
function fixPngCrcs(data: Buffer): void {
    for (let at = 8; at + 12 <= data.length;) {
        const length = data.readUInt32BE(at);
        if (at + 12 + length > data.length) return;
        data.writeUInt32BE(crc32(data.subarray(at + 4, at + 8 + length)), at + 8 + length);
        at += 12 + length;
    }
}

/**
 * Removes where a picture was taken: the EXIF GPS directory and XMP coordinates, in place.
 * Returns whether it changed the data and the EXIF orientation (for the shown size).
 */
export function stripPictureLocation(data: Buffer, type: string): { changed: boolean; orientation: number } {
    let changed = false;
    let orientation = 1;
    const exif = (tiff: number) => {
        const result = clearExifGps(data, tiff);
        if (!result) return;
        changed ||= result.changed;
        if (orientation === 1) orientation = result.orientation;
    };
    // JPEG APP1, HEIF items and most WebP chunks put "Exif\0\0" before the TIFF header.
    const marker = Buffer.from('Exif\0\0', 'latin1');
    for (let at = data.indexOf(marker); at >= 0; at = data.indexOf(marker, at + 6)) exif(at + 6);
    if (type === 'image/png') {
        for (let at = 8; at + 12 <= data.length;) {
            const length = data.readUInt32BE(at);
            if (ascii(data, at + 4, at + 8) === 'eXIf') exif(at + 8);
            at += 12 + length;
        }
    }
    if (type === 'image/webp') {
        for (let at = 12; at + 8 <= data.length;) {
            const length = data.readUInt32LE(at + 4);
            if (ascii(data, at, at + 4) === 'EXIF' && ascii(data, at + 8, at + 14) !== 'Exif\0\0') exif(at + 8);
            at += 8 + length + (length & 1);
        }
    }
    if (blank(data, XMP_GPS)) changed = true;
    if (changed && type === 'image/png') fixPngCrcs(data);
    return { changed, orientation: orientation >= 1 && orientation <= 8 ? orientation : 1 };
}

/** Removes the recording location from an MP4's `moov` box, in place; whether it changed. */
export const stripVideoLocation = (moov: Buffer) => blank(moov, ISO6709);
