import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReceivedChatMessage } from '@livekit/components-react';
import type { ChatEntry } from '../ChatPanel/MessageList';
import type { FileTransferItem } from '../../../lib/fileTransfer';

/**
 * Interleaves chat messages, system notices and file transfers into one list in the order
 * they arrived here, which senders' clocks can't disturb. `addSystem` appends a notice.
 */
export function useChatEntries(messages: ReceivedChatMessage[], fileTransfers: FileTransferItem[]) {
    const [systemEntries, setSystemEntries] = useState<ChatEntry[]>([]);
    const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);

    // Insertion order shared by notices, messages and files.
    const orderCounterRef = useRef(0);
    const msgOrderRef = useRef(new Map<string, number>());
    const fileOrderRef = useRef(new Map<string, number>());

    const addSystem = useCallback((text: string, id: string) => {
        setSystemEntries(prev => [...prev, {
            kind: 'system' as const,
            id,
            timestamp: Date.now(),
            order: orderCounterRef.current++,
            text,
        }]);
    }, []);

    // Rebuild sorted chat entries whenever messages, system entries, or file transfers change.
    // Must be useEffect (not useMemo) so msgOrderRef/fileOrderRef are always populated before we read them.
    useEffect(() => {
        // Assign insertion order to new messages (sort within batch by server timestamp)
        const newMsgs = messages.filter(m => !msgOrderRef.current.has(m.id));
        if (newMsgs.length > 0) {
            newMsgs.sort((a, b) => a.timestamp - b.timestamp);
            for (const m of newMsgs) {
                msgOrderRef.current.set(m.id, orderCounterRef.current++);
            }
        }

        // Same treatment for file transfers — order assigned once at creation, so
        // later progress/status updates (same id) don't reshuffle their position.
        const newFiles = fileTransfers.filter(f => !fileOrderRef.current.has(f.id));
        if (newFiles.length > 0) {
            newFiles.sort((a, b) => a.timestamp - b.timestamp);
            for (const f of newFiles) {
                fileOrderRef.current.set(f.id, orderCounterRef.current++);
            }
        }

        const all: Array<{ entry: ChatEntry; order: number }> = [
            ...messages.map(m => ({
                entry: { kind: 'chat' as const, msg: m },
                order: msgOrderRef.current.get(m.id) ?? 0,
            })),
            ...systemEntries.map(e => ({
                entry: e,
                order: (e as ChatEntry & { order?: number }).order ?? 0,
            })),
            ...fileTransfers.map(f => ({
                entry: { kind: 'file' as const, id: f.id, timestamp: f.timestamp, item: f },
                order: fileOrderRef.current.get(f.id) ?? 0,
            })),
        ];
        setChatEntries(all.sort((a, b) => a.order - b.order).map(x => x.entry));
    }, [messages, systemEntries, fileTransfers]);

    return { chatEntries, addSystem };
}
