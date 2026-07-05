import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ByteStreamReader, LocalParticipant, Room } from 'livekit-client';
import {
    FILE_STREAM_TOPIC,
    MAX_FILE_SIZE,
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
    /** Cancels an in-progress outgoing transfer (no-op for incoming/finished ones). */
    cancelSend: (id: string) => void;
}

/**
 * Sends/receives files over a LiveKit byte-stream data channel (topic: 'files').
 * Ephemeral like text chat -- nothing persisted, late joiners see nothing.
 *
 * Outgoing transfers use `localParticipant.streamBytes()` directly (rather than the
 * higher-level `sendFile()` helper) so we can track upload progress ourselves and
 * support cancellation -- neither is wired through in this version of livekit-client.
 */
export function useFileTransfers(room: Room, localParticipant: LocalParticipant): UseFileTransfersResult {
    const [entries, setEntries] = useState<Map<string, FileTransferItem>>(new Map());
    const entriesRef = useRef(entries);
    entriesRef.current = entries;

    // Outgoing transfers currently in flight, keyed by stream id — flipped to cancel.
    const cancelFlags = useRef<Map<string, { canceled: boolean }>>(new Map());

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

            reader.onProgress = (p) => upsert(info.id, { progress: p ?? 0 });
            reader.readAll().then((chunks) => {
                const blob = new Blob(chunks as BlobPart[], { type: mimeType });
                const blobUrl = URL.createObjectURL(blob);
                upsert(info.id, { status: 'done', progress: 1, blobUrl });
            }).catch((err) => {
                console.warn('[Lala] file receive failed:', err);
                upsert(info.id, { status: 'error' });
            });
        };

        room.registerByteStreamHandler(FILE_STREAM_TOPIC, handler);
        return () => room.unregisterByteStreamHandler(FILE_STREAM_TOPIC);
    }, [room, upsert]);

    const sendFile = useCallback(async (file: File): Promise<SendFileResult> => {
        if (file.size > MAX_FILE_SIZE) {
            return { ok: false, error: 'tooLarge' };
        }

        const id = crypto.randomUUID();
        const fileName = sanitizeFileName(file.name);
        const mimeType = file.type || 'application/octet-stream';
        const isImage = mimeType.startsWith('image/');
        const blobUrl = isImage ? URL.createObjectURL(file) : undefined;

        upsert(id, {
            id, direction: 'out', identity: localParticipant.identity,
            displayName: localParticipant.name || localParticipant.identity,
            fileName, size: file.size, mimeType, timestamp: Date.now(),
            progress: 0, status: 'active', blobUrl, isImage,
        });

        const cancelFlag = { canceled: false };
        cancelFlags.current.set(id, cancelFlag);

        try {
            const writer = await localParticipant.streamBytes({
                streamId: id,
                name: fileName,
                mimeType,
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
        }

        return { ok: true };
    }, [localParticipant, upsert]);

    const cancelSend = useCallback((id: string) => {
        const flag = cancelFlags.current.get(id);
        if (flag) flag.canceled = true;
    }, []);

    const fileTransfers = useMemo(() => Array.from(entries.values()), [entries]);

    return { fileTransfers, sendFile, cancelSend };
}
