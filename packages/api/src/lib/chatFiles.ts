import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { Request } from 'express';
import type { ChatAttachment } from '@lala/shared';
import { config } from './config';
import { redis } from './redis';
import {
    HEAD_BYTES, detectType, findMoov, isPicture, mp4Size, pictureSize,
    stripPictureLocation, stripVideoLocation, webmSize, type Size,
} from './media';

/**
 * Files sent with chat messages, on disk (`LALA_FILES_DIR`) under a random ID; what they
 * are is in Redis. One space limit covers them all: an upload that doesn't fit removes the
 * oldest files first, and a message whose file went shows its entry without a link. A file
 * goes with its message, and an upload no message names within an hour goes too.
 */

const META = 'lala:chat-files';      // id -> JSON FileMeta
const BY_AGE = 'lala:chat-files-age'; // id -> uploaded at (ms)
const PENDING_MS = 60 * 60 * 1000;
/** Pictures are read whole to remove their location; bigger ones are left as they are. */
const MAX_PICTURE_EDIT = 64 * 1024 * 1024;
const FILE_ID = /^[0-9a-f]{32}$/;

export interface FileMeta {
    name: string;
    type: string;
    size: number;
    width?: number;
    height?: number;
    channel: string;
    uploader: string;
    at: number;
    /** The message that names it; none while it waits for one. */
    message?: string;
}

const dir = () => resolve(process.env.LALA_FILES_DIR || 'data/chat-files');
const pathOf = (id: string) => join(dir(), id);
export const isFileId = (id: string) => FILE_ID.test(id);
export const fileUrl = (id: string) => `/api/files/${id}`;

/** Bytes the stored files take; this process is the only one writing them. */
let used = 0;
/** Space is counted and freed one upload at a time. */
let spaceLock: Promise<unknown> = Promise.resolve();
const withSpace = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = spaceLock.then(fn, fn);
    spaceLock = run.catch(() => undefined);
    return run;
};

const parse = (raw: string | null | undefined): FileMeta | undefined => {
    if (!raw) return undefined;
    try { return JSON.parse(raw) as FileMeta; } catch { return undefined; }
};

export function attachmentOf(id: string, meta: FileMeta | undefined, stored: Omit<ChatAttachment, 'url'>): ChatAttachment {
    return meta ? { ...stored, url: fileUrl(id) } : { ...stored };
}

/** Makes the directory and makes Redis and the disk agree: each drops what the other lacks. */
export async function initFiles(): Promise<void> {
    await mkdir(dir(), { recursive: true });
    const onDisk = new Set(await readdir(dir()));
    const metas = await redis().hgetall(META);
    used = 0;
    const missing: string[] = [];
    for (const [id, raw] of Object.entries(metas)) {
        const meta = parse(raw);
        if (meta && onDisk.has(id)) used += meta.size;
        else missing.push(id);
        onDisk.delete(id);
    }
    if (missing.length) await redis().multi().hdel(META, ...missing).zrem(BY_AGE, ...missing).exec();
    // Leftovers: uploads cut off by a restart, files whose entry is gone.
    await Promise.all([...onDisk].map((name) => unlink(join(dir(), name)).catch(() => undefined)));
    console.log(`[files] ${Object.keys(metas).length - missing.length} chat files, ${(used / 1024 / 1024).toFixed(1)} MB in ${dir()}`);
}

export async function removeFiles(ids: string[]): Promise<void> {
    const valid = ids.filter(isFileId);
    if (valid.length === 0) return;
    await withSpace(async () => {
        const metas = await redis().hmget(META, ...valid);
        await redis().multi().hdel(META, ...valid).zrem(BY_AGE, ...valid).exec();
        for (const [i, id] of valid.entries()) {
            const meta = parse(metas[i]);
            if (!meta) continue;
            used -= meta.size;
            await unlink(pathOf(id)).catch(() => undefined);
        }
    });
}

/** Removes the oldest files until `size` more bytes fit. Inside `withSpace`. */
async function makeSpace(size: number): Promise<void> {
    const { space } = config().chatFiles;
    while (used + size > space) {
        const [oldest] = await redis().zrange(BY_AGE, '0', '0');
        if (!oldest) { used = 0; return; }
        const meta = parse(await redis().hget(META, oldest));
        await redis().multi().hdel(META, oldest).zrem(BY_AGE, oldest).exec();
        await unlink(pathOf(oldest)).catch(() => undefined);
        used -= meta?.size ?? 0;
    }
}

/** Reads the file's type and size and removes location metadata, in the stored file. */
async function inspect(path: string, size: number): Promise<{ type: string } & Partial<Size>> {
    const handle = await open(path, 'r+');
    try {
        const read = async (position: number, length: number) => {
            const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - position)));
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
            return buffer.subarray(0, bytesRead);
        };
        const head = await read(0, HEAD_BYTES);
        const type = detectType(head);
        if (isPicture(type)) {
            if (size > MAX_PICTURE_EDIT) return { type, ...pictureSize(head, type) };
            const data = await read(0, size);
            const { changed, orientation } = stripPictureLocation(data, type);
            if (changed) await handle.write(data, 0, data.length, 0);
            return { type, ...pictureSize(data, type, orientation) };
        }
        if (type === 'video/mp4' || type === 'video/quicktime' || type === 'audio/mp4') {
            const moov = await findMoov(read, size);
            if (!moov) return { type };
            if (stripVideoLocation(moov.data)) await handle.write(moov.data, 0, moov.data.length, moov.at);
            return { type, ...(type === 'audio/mp4' ? {} : mp4Size(moov.data)) };
        }
        if (type === 'video/webm') return { type, ...webmSize(head) };
        return { type };
    } finally {
        await handle.close();
    }
}

export type UploadResult = { attachment: ChatAttachment } | { error: 'payload_too_large' | 'invalid_input' };

/**
 * Reads what is left of a refused upload before the answer goes out: a server that answers
 * mid-body and closes the connection reaches the client through a proxy as a 502. Past
 * `limit` bytes the connection is cut anyway.
 */
export function drainRequest(req: Request, limit = 64 * 1024 * 1024): Promise<void> {
    return new Promise((done) => {
        if (req.readableEnded) return done();
        let read = 0;
        req.on('data', (chunk: Buffer) => {
            read += chunk.length;
            if (read > limit) { req.destroy(); done(); }
        });
        req.on('end', () => done());
        req.on('error', () => done());
        req.on('close', () => done());
        req.resume();
    });
}

/** Stores the request body as a file waiting for a message. */
export async function storeUpload(req: Request, channel: string, uploader: string, name: string): Promise<UploadResult> {
    const { maxFile } = config().chatFiles;
    const declared = Number(req.header('content-length'));
    if (Number.isFinite(declared) && declared > maxFile) {
        await drainRequest(req);
        return { error: 'payload_too_large' };
    }

    const id = randomBytes(16).toString('hex');
    const temp = join(dir(), `.upload-${id}`);
    let size = 0;
    // Past the limit the rest is read and dropped, so the refusal reaches the client.
    const counter = new Transform({
        transform(chunk: Buffer, _encoding, done) {
            size += chunk.length;
            if (size <= maxFile) done(null, chunk);
            else if (size > maxFile + 64 * 1024 * 1024) done(new Error('too large'));
            else done();
        },
    });
    try {
        await pipeline(req, counter, createWriteStream(temp, { flags: 'wx' }));
    } catch {
        await unlink(temp).catch(() => undefined);
        return { error: size > maxFile ? 'payload_too_large' : 'invalid_input' };
    }
    if (size === 0 || size > maxFile) {
        await unlink(temp).catch(() => undefined);
        return { error: size > maxFile ? 'payload_too_large' : 'invalid_input' };
    }

    try {
        const info = await inspect(temp, size);
        const meta: FileMeta = { name, type: info.type, size, width: info.width, height: info.height, channel, uploader, at: Date.now() };
        await withSpace(async () => {
            await makeSpace(size);
            await rename(temp, pathOf(id));
            await redis().multi().hset(META, id, JSON.stringify(meta)).zadd(BY_AGE, meta.at, id).exec();
            used += size;
        });
        const { name: n, type: t, width, height } = meta;
        return { attachment: { id, name: n, type: t, size, width, height, url: fileUrl(id) } };
    } catch (err) {
        await unlink(temp).catch(() => undefined);
        throw err;
    }
}

export async function fileMetas(ids: string[]): Promise<Map<string, FileMeta>> {
    const valid = [...new Set(ids.filter(isFileId))];
    const result = new Map<string, FileMeta>();
    if (valid.length === 0) return result;
    const raw = await redis().hmget(META, ...valid);
    valid.forEach((id, i) => {
        const meta = parse(raw[i]);
        if (meta) result.set(id, meta);
    });
    return result;
}

/** Ties uploads to the message that names them, so they go when it goes. */
export async function attachFiles(ids: string[], message: string): Promise<void> {
    const metas = await fileMetas(ids);
    if (metas.size === 0) return;
    const tx = redis().multi();
    for (const [id, meta] of metas) tx.hset(META, id, JSON.stringify({ ...meta, message }));
    await tx.exec();
}

/** Uploads no message took within the hour, and files whose message is gone. */
export async function sweepFiles(messageExists: (channel: string, id: string) => Promise<boolean>): Promise<void> {
    const gone: string[] = [];
    for (const [id, raw] of Object.entries(await redis().hgetall(META))) {
        const meta = parse(raw);
        if (!meta) gone.push(id);
        else if (!meta.message) { if (Date.now() - meta.at > PENDING_MS) gone.push(id); }
        else if (!await messageExists(meta.channel, meta.message)) gone.push(id);
    }
    await removeFiles(gone);
}

export async function fileOnDisk(id: string): Promise<{ path: string; meta: FileMeta } | undefined> {
    if (!isFileId(id)) return undefined;
    const meta = parse(await redis().hget(META, id));
    if (!meta) return undefined;
    const path = pathOf(id);
    return (await stat(path).catch(() => undefined)) ? { path, meta } : undefined;
}
