/**
 * Shared constants/types/helpers for LiveKit byte-stream file transfers in chat.
 *
 * Security note: byte streams ride the reliable data channel -- DTLS-encrypted in
 * transit (and additionally GCM-encrypted when the room has E2EE enabled, same as
 * media), but this is the same trust boundary as existing chat text (also a data
 * channel message): server-side/SFU-side visibility rules are unchanged. There is
 * no additional persistence -- like chat, transfers are ephemeral and late joiners
 * never see them.
 */

/** Topic used to route file byte-streams, kept distinct from chat text streams. */
export const FILE_STREAM_TOPIC = 'files';

/** Hard cap on file size we'll attempt to send or accept. */
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

/**
 * Outgoing transfers are sent one at a time over the shared reliable data channel (see
 * useFileTransfers' send queue) -- all `streamBytes()` writers otherwise funnel through the
 * same underlying SCTP channel, and running several concurrently floods its send buffer.
 * 'queued' is the wait state for files added while another transfer is still active.
 */
export type FileTransferStatus = 'queued' | 'active' | 'done' | 'error' | 'canceled';
export type FileTransferErrorReason = 'tooLarge' | 'other';

/** No incoming-transfer progress for this long -> treat the stream as stalled and fail it. */
export const STALL_TIMEOUT_MS = 30_000;

export interface FileTransferItem {
    /** LiveKit stream id -- unique per transfer, stable across progress updates. */
    id: string;
    direction: 'in' | 'out';
    /** Sender's LiveKit identity (local identity for outgoing transfers). */
    identity: string;
    displayName: string;
    fileName: string;
    /** Total size in bytes, when known upfront. */
    size?: number;
    mimeType: string;
    timestamp: number;
    /** 0..1, undefined while unknown. */
    progress?: number;
    status: FileTransferStatus;
    errorReason?: FileTransferErrorReason;
    /** Object URL -- set once available (instantly for outgoing image previews, on completion for downloads). Caller must revoke. */
    blobUrl?: string;
    isImage: boolean;
}

const CONTROL_CHARS_RE = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']', 'g');

/** Human-readable file size, e.g. "1.4 MB". */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unitIdx = 0;
    while (value >= 1024 && unitIdx < units.length - 1) {
        value /= 1024;
        unitIdx++;
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIdx]}`;
}

/** Strip path separators/control characters and cap length -- never trust a peer-supplied filename verbatim. */
export function sanitizeFileName(name: string): string {
    const stripped = name.replace(/[\\/]/g, '').replace(CONTROL_CHARS_RE, '').trim();
    const safe = stripped || 'file';
    return safe.length > 150 ? `${safe.slice(0, 147)}...` : safe;
}
