import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ByteStreamReader, LocalParticipant, Room } from 'livekit-client';
import {
    FILE_STREAM_TOPIC,
    MAX_FILE_SIZE,
    STALL_TIMEOUT_MS,
    sanitizeFileName,
    type FileTransferItem,
} from '../../../lib/fileTransfer';

export interface SendFileResult {
    ok: boolean;
    error?: 'tooLarge';
}

export interface UseFileTransfersResult {
    /** All transfers (outgoing + incoming), any status, in creation order. */
    fileTransfers: FileTransferItem[];
    sendFile: (file: File) => Promise<SendFileResult>;
    /** Cancels an in-progress or queued outgoing transfer (no-op for incoming/finished ones). */
    cancelSend: (id: string) => void;
}

/**
 * Sends/receives files over a LiveKit byte-stream data channel (topic: 'files').
 * Ephemeral like text chat -- nothing persisted, late joiners see nothing.
 *
 * Outgoing transfers use `localParticipant.streamBytes()` directly (rather than the
 * higher-level `sendFile()` helper) so we can track upload progress ourselves and
 * support cancellation -- neither is wired through in this version of livekit-client.
 *
 * Sends are serialized FIFO (see `sendQueue`/`runSend` below): every `streamBytes()` writer
 * funnels its chunks through the same underlying reliable SCTP data channel, and while each
 * individual writer awaits the SDK's own backpressure (`RTCEngine.sendDataPacket` blocks on
 * `waitForBufferStatusLow` before every `dc.send()`), that wait is a check-then-send race --
 * concurrent writers can all observe "buffer is low" and send in the same tick, bursting past
 * the channel's send buffer. That flood can abort the whole reliable data channel (logged by
 * livekit-client as `publisher data channel 'RELIABLE' closed unexpectedly`), which is why
 * sending several files at once left only one of them ever arriving. Serializing to one active
 * writer at a time removes the concurrent-writer race entirely; the SDK's own per-chunk await
 * still throttles a single big file correctly.
 */
export function useFileTransfers(room: Room, localParticipant: LocalParticipant): UseFileTransfersResult {
    const [entries, setEntries] = useState<Map<string, FileTransferItem>>(new Map());
    const entriesRef = useRef(entries);
    entriesRef.current = entries;

    // Outgoing transfers currently in flight, keyed by stream id — flipped to cancel.
    const cancelFlags = useRef<Map<string, { canceled: boolean }>>(new Map());

    // FIFO of outgoing sends waiting for their turn (excludes whichever one is active).
    const sendQueue = useRef<{ id: string; file: File }[]>([]);
    // Stream id of the transfer currently writing, or null when the channel is idle.
    const activeSendId = useRef<string | null>(null);

    const upsert = useCallback((id: string, patch: FileTransferItem | Partial<FileTransferItem>) => {
        setEntries(prev => {
            const next = new Map(prev);
            const existing = next.get(id);
            next.set(id, existing ? { ...existing, ...patch } : (patch as FileTransferItem));
            return next;
        });
    }, []);

    // Revoke every object URL we ever created when the room view unmounts (leave/navigate away).
    useEffect(() => () => {
        for (const item of entriesRef.current.values()) {
            if (item.blobUrl) URL.revokeObjectURL(item.blobUrl);
        }
    }, []);

    useEffect(() => {
        const handler = (reader: ByteStreamReader, participantInfo: { identity: string }) => {
            const info = reader.info;
            const sender = room.getParticipantByIdentity(participantInfo.identity);
            const displayName = sender?.name || participantInfo.identity;
            const mimeType = info.mimeType || 'application/octet-stream';
            const isImage = mimeType.startsWith('image/');
            const fileName = sanitizeFileName(info.name || 'file');
            const timestamp = info.timestamp || Date.now();

            if (info.size && info.size > MAX_FILE_SIZE) {
                upsert(info.id, {
                    id: info.id, direction: 'in', identity: participantInfo.identity, displayName,
                    fileName, size: info.size, mimeType, timestamp, status: 'error', errorReason: 'tooLarge', isImage,
                });
                // Tear the reader down immediately instead of buffering it into a Blob we'd
                // just discard — the pre-aborted signal makes readAll() reject on its first
                // pull, releasing our reader lock right away.
                const ac = new AbortController();
                ac.abort();
                reader.readAll({ signal: ac.signal }).catch(() => {});
                return;
            }

            upsert(info.id, {
                id: info.id, direction: 'in', identity: participantInfo.identity, displayName,
                fileName, size: info.size, mimeType, timestamp, progress: 0, status: 'active', isImage,
            });

            // A sender that vanishes mid-stream (crashed tab, dropped connection) or a stalled
            // reliable channel otherwise leaves this reader awaiting chunks that never arrive --
            // no error, no completion, just a spinner forever. Fail it out after a period of no
            // progress at all, releasing the reader the same way the oversize path does above.
            const stallAbort = new AbortController();
            let stallTimer: ReturnType<typeof setTimeout>;
            const resetStallTimer = () => {
                clearTimeout(stallTimer);
                stallTimer = setTimeout(() => {
                    stallAbort.abort(new Error('file receive stalled: no progress'));
                }, STALL_TIMEOUT_MS);
            };
            resetStallTimer();

            reader.onProgress = (p) => {
                resetStallTimer();
                upsert(info.id, { progress: p ?? 0 });
            };
            reader.readAll({ signal: stallAbort.signal }).then((chunks) => {
                clearTimeout(stallTimer);
                const blob = new Blob(chunks as BlobPart[], { type: mimeType });
                const blobUrl = URL.createObjectURL(blob);
                upsert(info.id, { status: 'done', progress: 1, blobUrl });
            }).catch((err) => {
                clearTimeout(stallTimer);
                console.warn('[Lala] file receive failed:', err);
                upsert(info.id, { status: 'error' });
            });
        };

        room.registerByteStreamHandler(FILE_STREAM_TOPIC, handler);
        return () => room.unregisterByteStreamHandler(FILE_STREAM_TOPIC);
    }, [room, upsert]);

    // Performs one outgoing transfer end to end, then hands the reliable channel to whatever's
    // next in `sendQueue` -- this is what keeps only a single `streamBytes()` writer active at
    // a time (see the hook-level doc comment for why that matters).
    const runSend = useCallback(async (id: string, file: File) => {
        activeSendId.current = id;
        upsert(id, { status: 'active', progress: 0 });

        const cancelFlag = { canceled: false };
        cancelFlags.current.set(id, cancelFlag);

        try {
            const writer = await localParticipant.streamBytes({
                streamId: id,
                name: sanitizeFileName(file.name),
                mimeType: file.type || 'application/octet-stream',
                totalSize: file.size,
                topic: FILE_STREAM_TOPIC,
            });
            const reader = file.stream().getReader();
            let sent = 0;
            for (;;) {
                if (cancelFlag.canceled) {
                    await writer.close();
                    upsert(id, { status: 'canceled' });
                    break;
                }
                const { done, value } = await reader.read();
                if (done) {
                    await writer.close();
                    upsert(id, { status: 'done', progress: 1 });
                    break;
                }
                await writer.write(value);
                sent += value.byteLength;
                upsert(id, { progress: file.size ? sent / file.size : undefined });
            }
        } catch (err) {
            console.warn('[Lala] file send failed:', err);
            upsert(id, { status: 'error' });
        } finally {
            cancelFlags.current.delete(id);
            activeSendId.current = null;
            // Hand off to the next queued send, if any -- fire-and-forget is safe since this
            // function never rethrows (all failure paths above resolve to an 'error' upsert).
            const next = sendQueue.current.shift();
            if (next) void runSend(next.id, next.file);
        }
    }, [localParticipant, upsert]);

    const sendFile = useCallback(async (file: File): Promise<SendFileResult> => {
        if (file.size > MAX_FILE_SIZE) {
            return { ok: false, error: 'tooLarge' };
        }

        const id = crypto.randomUUID();
        const fileName = sanitizeFileName(file.name);
        const mimeType = file.type || 'application/octet-stream';
        const isImage = mimeType.startsWith('image/');
        const blobUrl = isImage ? URL.createObjectURL(file) : undefined;
        // A transfer is already writing to the channel -- queue behind it instead of starting
        // a second concurrent writer (that's the flood that used to abort the channel).
        const mustQueue = activeSendId.current !== null;

        upsert(id, {
            id, direction: 'out', identity: localParticipant.identity,
            displayName: localParticipant.name || localParticipant.identity,
            fileName, size: file.size, mimeType, timestamp: Date.now(),
            progress: 0, status: mustQueue ? 'queued' : 'active', blobUrl, isImage,
        });

        if (mustQueue) {
            sendQueue.current.push({ id, file });
        } else {
            void runSend(id, file);
        }

        return { ok: true };
    }, [localParticipant, upsert, runSend]);

    const cancelSend = useCallback((id: string) => {
        // Queued items haven't opened a writer yet -- just drop them from the queue.
        const queuedIdx = sendQueue.current.findIndex((job) => job.id === id);
        if (queuedIdx !== -1) {
            sendQueue.current.splice(queuedIdx, 1);
            upsert(id, { status: 'canceled' });
            return;
        }
        // Active transfer -- flip the flag; runSend's loop notices it on its next iteration.
        const flag = cancelFlags.current.get(id);
        if (flag) flag.canceled = true;
    }, [upsert]);

    const fileTransfers = useMemo(() => Array.from(entries.values()), [entries]);

    return { fileTransfers, sendFile, cancelSend };
}
