import { Fragment, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReceivedChatMessage } from '@livekit/components-react';
import { avatarColorForIdentity } from '../../../lib/avatarUtils';
import type { FileTransferItem } from '../../../lib/fileTransfer';
import { FileBubble } from './FileBubble';
import { isBotIdentity, parseBotCard } from '../../../lib/bots';
import type { BotCard } from '../../../lib/types';
import { BotCardView } from './BotCardView';
import { BotBadge } from '../../../ui/BotBadge';
import { ImageLightbox } from './ImageLightbox';
import { ChatText } from '../../../ui/ChatText';
import { useAvatarForIdentity } from '../../../lib/roomStatusStore';
import { openProfile } from '../../../lib/profileCard';
import '../../text/text-chat.css';

export type ChatEntry =
    | { kind: 'chat'; msg: ReceivedChatMessage }
    | { kind: 'system'; id: string; timestamp: number; order?: number; text: string }
    | { kind: 'file'; id: string; timestamp: number; order?: number; item: FileTransferItem };

type SystemEntry = Extract<ChatEntry, { kind: 'system' }>;

type GroupChild =
    | { kind: 'text'; id: string; text: string; timestamp: number; card?: BotCard }
    | { kind: 'file'; id: string; timestamp: number; item: FileTransferItem };

interface MessageGroup {
    kind: 'group';
    identity: string;
    displayName: string;
    entries: GroupChild[];
}

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Consecutive messages and files from one sender share a header; a system notice breaks the run. */
function buildGroups(entries: ChatEntry[]): Array<MessageGroup | SystemEntry> {
    const result: Array<MessageGroup | SystemEntry> = [];

    for (const entry of entries) {
        if (entry.kind === 'system') {
            result.push(entry);
            continue;
        }

        const [identity, name, child]: [string, string | undefined, GroupChild] = entry.kind === 'file'
            ? [entry.item.identity || 'Unknown', entry.item.displayName, { kind: 'file', id: entry.id, timestamp: entry.timestamp, item: entry.item }]
            : [entry.msg.from?.identity || 'Unknown', entry.msg.from?.name, {
                kind: 'text', id: entry.msg.id, text: entry.msg.message, timestamp: entry.msg.timestamp,
                card: parseBotCard(entry.msg.from?.identity, entry.msg.attributes),
            }];

        const last = result.at(-1);
        if (last?.kind === 'group' && last.identity === identity) {
            last.entries.push(child);
        } else {
            result.push({ kind: 'group', identity, displayName: name || identity, entries: [child] });
        }
    }

    return result;
}

interface MessageListProps {
    entries: ChatEntry[];
    /** Whose messages are our own. */
    localIdentity: string;
    onCancelFile?: (id: string) => void;
}

export function MessageList({ entries, localIdentity, onCancelFile }: MessageListProps) {
    const { t } = useTranslation();
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

                {buildGroups(entries).map((item) => item.kind === 'system' ? (
                    <div key={item.id} className="cp-system">
                        <span>{item.text}</span>
                        <span className="cp-time">{formatTime(item.timestamp)}</span>
                    </div>
                ) : (
                    <Group key={`${item.identity}-${item.entries[0].id}`} group={item} localIdentity={localIdentity} onCancelFile={onCancelFile} onOpenImage={setLightboxItem} />
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

interface GroupProps {
    group: MessageGroup;
    localIdentity: string;
    onCancelFile?: (id: string) => void;
    onOpenImage: (item: FileTransferItem) => void;
}

/** One sender's run of messages, drawn like a text chat's: avatar, name and time, then each message. */
function Group({ group, localIdentity, onCancelFile, onOpenImage }: GroupProps) {
    const { t } = useTranslation();
    const avatar = useAvatarForIdentity(group.identity);
    const color = avatarColorForIdentity(group.identity);
    const name = group.displayName;
    const showProfile = (e: React.MouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        openProfile({ identity: group.identity, name, x: rect.right + 8, y: rect.top });
    };
    return (
        <div className="tc-msg cp-msg">
            <div className="tc-msg-gutter">
                <button type="button" className="tc-avatar" onClick={showProfile} aria-label={name} style={{ background: avatar ? 'transparent' : color }}>
                    {avatar ? <img src={avatar} alt="" /> : name[0]?.toUpperCase() ?? '?'}
                </button>
            </div>
            <div className="tc-msg-body">
                <div className="tc-msg-head">
                    <button type="button" className="tc-msg-name" style={{ color }} onClick={showProfile}>{name}</button>
                    {isBotIdentity(group.identity) && <BotBadge />}
                    <span className="tc-msg-time">{formatTime(group.entries[0].timestamp)}</span>
                </div>
                {group.entries.map((e) => (
                    e.kind === 'file'
                        ? <FileBubble key={e.id} item={e.item} onCancel={onCancelFile} onOpenImage={onOpenImage} t={t} />
                        : (
                            <Fragment key={e.id}>
                                <div className="tc-msg-text cp-text"><ChatText text={e.text} myIdentity={localIdentity} /></div>
                                {e.card && <BotCardView card={e.card} />}
                            </Fragment>
                        )
                ))}
            </div>
        </div>
    );
}
