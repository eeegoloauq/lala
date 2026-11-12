import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A file the build needs that is not on npm: a fixed URL and the checksum it must have. */
export interface PinnedFile {
    url: string;
    sha256: string;
    /** Where it is kept under node_modules/.cache, so a build downloads it once. */
    cache: string;
}

const CACHE_DIR = fileURLToPath(new URL('../node_modules/.cache/', import.meta.url));
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** The file from the cache, or downloaded once; refused when it isn't byte for byte the pinned one. */
export async function fetchPinned(file: PinnedFile): Promise<Buffer> {
    const path = CACHE_DIR + file.cache;
    const cached = await readFile(path).catch(() => null);
    if (cached && sha256(cached) === file.sha256) return cached;
    const res = await fetch(file.url);
    if (!res.ok) throw new Error(`Downloading ${file.url} failed: ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    if (sha256(data) !== file.sha256) throw new Error(`${file.url} does not match its pinned checksum`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return data;
}
