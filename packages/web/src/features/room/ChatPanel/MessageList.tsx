import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { useTranslation } from 'react-i18next';
import type { ReceivedChatMessage } from '@livekit/components-react';
import { avatarColorForIdentity } from '../../../lib/avatarUtils';
import type { FileTransferItem } from '../../../lib/fileTransfer';
import { FileBubble } from './FileBubble';
import { ImageLightbox } from './ImageLightbox';

export type ChatEntry =
    | { kind: 'chat'; msg: ReceivedChatMessage }
    | { kind: 'system'; id: string; timestamp: number; order?: number; text: string }
    | { kind: 'file'; id: string; timestamp: number; order?: number; item: FileTransferItem };

type SystemEntry = Extract<ChatEntry, { kind: 'system' }>;

type GroupChild =
    | { kind: 'text'; id: string; text: string; timestamp: number }
    | { kind: 'file'; id: string; timestamp: number; item: FileTransferItem };

interface MessageGroup {
    kind: 'group';
    identity: string;
    displayName: string;
    isOwn: boolean;
    entries: GroupChild[];
}

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Consecutive messages and files from one sender share a header; a system notice breaks the run. */
function buildGroups(entries: ChatEntry[], localIdentity: string): Array<MessageGroup | SystemEntry> {
    const result: Array<MessageGroup | SystemEntry> = [];

    for (const entry of entries) {
        if (entry.kind === 'system') {
            result.push(entry);
            continue;
        }

        const [identity, name, child]: [string, string | undefined, GroupChild] = entry.kind === 'file'
            ? [entry.item.identity || 'Unknown', entry.item.displayName, { kind: 'file', id: entry.id, timestamp: entry.timestamp, item: entry.item }]
            : [entry.msg.from?.identity || 'Unknown', entry.msg.from?.name, { kind: 'text', id: entry.msg.id, text: entry.msg.message, timestamp: entry.msg.timestamp }];

        const last = result.at(-1);
        if (last?.kind === 'group' && last.identity === identity) {
            last.entries.push(child);
        } else {
            result.push({ kind: 'group', identity, displayName: name || identity, isOwn: identity === localIdentity, entries: [child] });
        }
    }

    return result;
}

interface MessageListProps {
    entries: ChatEntry[];
    onCancelFile?: (id: string) => void;
}

export function MessageList({ entries, onCancelFile }: MessageListProps) {
    const { t } = useTranslation();
    const { localParticipant } = useLocalParticipant();
    const [jumpToLatest, setJumpToLatest] = useState(false);
    const [lightboxItem, setLightboxItem] = useState<FileTransferItem | null>(null);
    const messagesRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const isNearBottomRef = useRef(true);

    // Track scroll position; clear the "jump to latest" pill once the user scrolls back down themselves
    useEffect(() => {
        const el = messagesRef.current;
        if (!el) return;
        const onScroll = () => {
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            isNearBottomRef.current = nearBottom;
            if (nearBottom) setJumpToLatest(false);
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, []);

    // The list mounts fresh every time the chat opens, with the backlog already in place.
    // Jump straight to the bottom before paint so opening never animates through the history;
    // smooth scrolling is reserved for messages arriving after that.
    const skipNextAutoScrollRef = useRef(true);
    useLayoutEffect(() => {
        const el = messagesRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, []);

    // Auto-scroll only when already near the bottom; otherwise surface a "jump to latest" pill
    // instead of yanking the view out from under someone reading scrollback.
    useEffect(() => {
        if (skipNextAutoScrollRef.current) {
            skipNextAutoScrollRef.current = false;
            return;
        }
        if (isNearBottomRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        } else if (entries.length > 0) {
            setJumpToLatest(true);
        }
    }, [entries]);

    const scrollToLatest = () => {
        isNearBottomRef.current = true;
        setJumpToLatest(false);
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    return (
        <>
            <div className="cp-messages" ref={messagesRef}>
                {entries.length === 0 && <span className="cp-empty">{t('chat.noMessages')}</span>}

                {buildGroups(entries, localParticipant.identity).map((item) => item.kind === 'system' ? (
                    <div key={item.id} className="cp-system">
                        <span>{item.text}</span>
                        <span className="cp-time">{formatTime(item.timestamp)}</span>
                    </div>
                ) : (
                    <div key={`${item.identity}-${item.entries[0].id}`} className={`cp-group${item.isOwn ? ' cp-group-own' : ''}`}>
                        <div className="cp-group-header">
                            <span className="cp-sender" style={{ color: avatarColorForIdentity(item.identity) }}>
                                {item.displayName}
                            </span>
                            <span className="cp-time">{formatTime(item.entries[0].timestamp)}</span>
                        </div>
                        {item.entries.map((e) => (
                            e.kind === 'file'
                                ? <FileBubble key={e.id} item={e.item} onCancel={onCancelFile} onOpenImage={setLightboxItem} t={t} />
                                : <div key={e.id} className="cp-bubble">{e.text}</div>
                        ))}
                    </div>
                ))}
                <div ref={bottomRef} />

                {jumpToLatest && (
                    <button className="cp-jump-latest" onClick={scrollToLatest}>
                        {t('chat.jumpToLatest')}
                    </button>
                )}
            </div>

            {lightboxItem?.blobUrl && (
                <ImageLightbox
                    src={lightboxItem.blobUrl}
                    fileName={lightboxItem.fileName}
                    onClose={() => setLightboxItem(null)}
                    t={t}
                />
            )}
        </>
    );
}
