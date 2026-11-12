import { memo, useEffect, useLayoutEffect, useRef, useState, lazy, Suspense, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ChatAttachment, ChatMessage } from '../../lib/types';
import { jumpTo, loadOlder, markRead, mentionsOf, openChannel, removeMessage, toggleReaction, togglePin, useFocusTarget, useHistory } from '../../lib/textChat';
import { plainText } from '../../lib/chatMarkup';
import { setViewingChannel } from '../../lib/chatNotify';
import { avatarColorForIdentity } from '../../lib/avatarUtils';
import { useAvatarForIdentity } from '../../lib/roomStatusStore';
import { usePresence } from '../../lib/presence';
import { openProfile } from '../../lib/profileCard';
import { isBotIdentity } from '../../lib/bots';
import { useDismiss } from '../../hooks/useDismiss';
import { BotBadge } from '../../ui/BotBadge';
import { ChatText } from '../../ui/ChatText';
import { ImageLightbox } from '../room/ChatPanel/ImageLightbox';
import { Attachment } from './Attachment';
import { MessageMenu } from './ChatMenus';
import { useLongPress } from '../../hooks/useLongPress';

const EmojiPicker = lazy(() => import('../room/ChatPanel/EmojiPicker').then(m => ({ default: m.EmojiPicker })));

/** Messages from one person this close together share one header. */
const GROUP_GAP_MS = 7 * 60_000;
const NEAR_BOTTOM_PX = 80;
const NO_MESSAGES: ChatMessage[] = [];

interface MessageFeedProps {
    channel: string;
    myIdentity?: string;
    /** Admins may delete anyone's message. */
    isAdmin: boolean;
    /** The narrow layout of a call's side panel. */
    compact?: boolean;
    /** Starts an answer to the message; absent where we can't write. */
    onReply?: (message: ChatMessage) => void;
}

/**
 * A text chat's messages, newest at the bottom. Older pages load when the top comes into
 * view, keeping what is on screen in place; at the bottom the list stays there while
 * content changes size (a picture or a font loading).
 */
export function MessageFeed({ channel, myIdentity, isAdmin, compact = false, onReply }: MessageFeedProps) {
    const { t } = useTranslation();
    const history = useHistory(channel);
    const listRef = useRef<HTMLDivElement>(null);
    const itemsRef = useRef<HTMLDivElement>(null);
    const topRef = useRef<HTMLDivElement>(null);
    const nearBottom = useRef(true);
    const [newBelow, setNewBelow] = useState(false);
    const [lightbox, setLightbox] = useState<ChatAttachment | null>(null);
    const [flash, setFlash] = useState<string | null>(null);

    useEffect(() => { if (!history) openChannel(channel); }, [channel, history]);
    // On screen, this chat never notifies.
    useEffect(() => {
        setViewingChannel(channel);
        return () => setViewingChannel(null);
    }, [channel]);

    const messages = history?.messages ?? NO_MESSAGES;
    const lastId = messages.at(-1)?.id;
    const firstId = messages[0]?.id;

    // Reading the newest message marks the chat read; scrolled up, it waits.
    const readIfAtBottom = useCallback(() => {
        if (nearBottom.current && document.visibilityState === 'visible') markRead(channel, lastId);
    }, [channel, lastId]);

    useEffect(() => {
        const el = listRef.current;
        if (!el) return;
        const onScroll = () => {
            nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
            if (nearBottom.current) {
                setNewBelow(false);
                readIfAtBottom();
            }
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        document.addEventListener('visibilitychange', readIfAtBottom);
        return () => {
            el.removeEventListener('scroll', onScroll);
            document.removeEventListener('visibilitychange', readIfAtBottom);
        };
    }, [readIfAtBottom]);

    useEffect(() => {
        const list = listRef.current;
        const items = itemsRef.current;
        if (!list || !items) return;
        const observer = new ResizeObserver(() => {
            if (nearBottom.current) list.scrollTop = list.scrollHeight;
        });
        observer.observe(items);
        observer.observe(list);
        return () => observer.disconnect();
    }, []);

    // A jump to a message (a reply's original, a pin): bring it to the middle and light it up.
    const focus = useFocusTarget();
    useEffect(() => {
        if (!focus || focus.channel !== channel) return;
        const el = listRef.current?.querySelector(`[data-msg-id="${CSS.escape(focus.id)}"]`);
        if (!el) return;
        nearBottom.current = false;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setFlash(focus.id);
        const timer = setTimeout(() => setFlash(null), 2000);
        return () => clearTimeout(timer);
    }, [focus, channel, firstId]);

    // Older messages went in above: keep the ones on screen where they were.
    const heightBefore = useRef<number | null>(null);
    const prevFirst = useRef(firstId);
    useLayoutEffect(() => {
        const el = listRef.current;
        if (el && heightBefore.current !== null && firstId !== prevFirst.current) {
            el.scrollTop += el.scrollHeight - heightBefore.current;
        }
        heightBefore.current = null;
        prevFirst.current = firstId;
    }, [firstId]);

    // A new message: follow it when at the bottom (or when it's ours), otherwise offer a jump.
    const prevLast = useRef<string | undefined>(undefined);
    useLayoutEffect(() => {
        const el = listRef.current;
        if (!el || !lastId || lastId === prevLast.current) return;
        const first = prevLast.current === undefined;
        prevLast.current = lastId;
        const mine = messages.at(-1)?.identity === myIdentity;
        if (first || nearBottom.current || mine) {
            el.scrollTop = el.scrollHeight;
            nearBottom.current = true;
            readIfAtBottom();
        } else {
            setNewBelow(true);
        }
    }, [lastId, messages, myIdentity, readIfAtBottom]);

    // The top of the list in view: the page before it.
    useEffect(() => {
        const el = topRef.current;
        if (!el || !history?.more) return;
        const observer = new IntersectionObserver(([entry]) => {
            if (!entry.isIntersecting) return;
            heightBefore.current = listRef.current?.scrollHeight ?? null;
            loadOlder(channel);
        }, { root: listRef.current, rootMargin: '400px 0px 0px 0px' });
        observer.observe(el);
        return () => observer.disconnect();
    }, [channel, history?.more, firstId]);

    const jump = () => {
        const el = listRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    };

    return (
        <div className={`tc-feed${compact ? ' tc-feed-compact' : ''}`}>
            <div className="tc-list" ref={listRef} role="log" aria-live="polite" aria-relevant="additions">
                <div ref={itemsRef}>
                <div ref={topRef} className="tc-top">
                    {history?.loading && <div className="tc-loading" aria-label={t('chat.loading')} />}
                    {history && !history.more && !history.loading && <div className="tc-start">{t('chat.channelStart')}</div>}
                </div>
                {messages.map((m, i) => {
                    const prev = messages[i - 1];
                    const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
                    // An answer always shows who wrote it, under the line of what it answers.
                    const continued = !newDay && !m.reply && prev.identity === m.identity && m.at - prev.at < GROUP_GAP_MS;
                    return (
                        <div key={m.id} data-msg-id={m.id} className={flash === m.id ? 'tc-flash' : undefined}>
                            {newDay && <DayDivider at={m.at} />}
                            <MessageRow
                                message={m}
                                continued={continued}
                                myIdentity={myIdentity}
                                canDelete={isAdmin || m.identity === myIdentity}
                                canPin={isAdmin}
                                onReply={onReply}
                                onOpenImage={setLightbox}
                            />
                        </div>
                    );
                })}
                </div>
            </div>
            {newBelow && (
                <button className="cp-jump-latest tc-jump" onClick={jump}>{t('chat.newMessages')}</button>
            )}
            {lightbox?.url && <ImageLightbox src={lightbox.url} fileName={lightbox.name} onClose={() => setLightbox(null)} t={t} />}
        </div>
    );
}

function DayDivider({ at }: { at: number }) {
    const { t, i18n } = useTranslation();
    const day = new Date(at);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);
    const label = day.toDateString() === today.toDateString() ? t('chat.today')
        : day.toDateString() === yesterday.toDateString() ? t('chat.yesterday')
            : day.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
    return <div className="tc-day" role="separator"><span>{label}</span></div>;
}

interface MessageRowProps {
    message: ChatMessage;
    continued: boolean;
    myIdentity?: string;
    canDelete: boolean;
    canPin: boolean;
    onReply?: (message: ChatMessage) => void;
    onOpenImage: (file: ChatAttachment) => void;
}

const MessageRow = memo(function MessageRow({ message, continued, myIdentity, canDelete, canPin, onReply, onOpenImage }: MessageRowProps) {
    const { t } = useTranslation();
    const avatar = useAvatarForIdentity(message.identity);
    // The name they have now; the one they sent with if they're no longer known.
    const name = usePresence()?.get(message.identity)?.name ?? message.name;
    const [picker, setPicker] = useState<DOMRect | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const longPress = useLongPress();
    const mentionsMe = !!myIdentity && mentionsOf(message.text).has(myIdentity);
    const time = new Date(message.at);
    const react = (emoji: string) => { toggleReaction(message.channel, message, emoji).catch(() => {}); };

    useEffect(() => {
        if (!confirmDelete) return;
        const timer = setTimeout(() => setConfirmDelete(false), 4000);
        return () => clearTimeout(timer);
    }, [confirmDelete]);

    const showProfile = (e: React.MouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        openProfile({ identity: message.identity, name, x: rect.right + 8, y: rect.top });
    };

    return (
        <div
            className={`tc-msg${continued ? ' tc-msg-continued' : ''}${mentionsMe ? ' tc-msg-mention' : ''}${picker || confirmDelete || menu ? ' tc-msg-active' : ''}`}
            onContextMenu={(e) => {
                // A link, or text someone selected to copy, keeps the browser's own menu.
                if ((e.target as HTMLElement).closest('a') || window.getSelection()?.toString()) return;
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY });
            }}
            {...longPress((x, y) => setMenu({ x, y }))}
        >
            {message.reply && <ReplyLine channel={message.channel} reply={message.reply} />}
            <div className="tc-msg-gutter">
                {continued
                    ? <time className="tc-msg-time-inline" dateTime={time.toISOString()}>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                    : (
                        <button type="button" className="tc-avatar" onClick={showProfile} aria-label={name} style={{ background: avatar ? 'transparent' : avatarColorForIdentity(message.identity) }}>
                            {avatar ? <img src={avatar} alt="" /> : name[0]?.toUpperCase() ?? '?'}
                        </button>
                    )}
            </div>
            <div className="tc-msg-body">
                {!continued && (
                    <div className="tc-msg-head">
                        <button type="button" className="tc-msg-name" style={{ color: avatarColorForIdentity(message.identity) }} onClick={showProfile}>{name}</button>
                        {isBotIdentity(message.identity) && <BotBadge />}
                        <time className="tc-msg-time" dateTime={time.toISOString()} title={time.toLocaleString()}>
                            {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </time>
                        {message.pinned && <span className="tc-pinned-mark" title={t('chat.pinned')} aria-label={t('chat.pinned')}><PinGlyph size={12} /></span>}
                    </div>
                )}
                {message.text && <div className="tc-msg-text"><ChatText text={message.text} myIdentity={myIdentity} /></div>}
                {message.attachments?.map(a => <Attachment key={a.id} file={a} onOpenImage={onOpenImage} />)}
                <Reactions message={message} myIdentity={myIdentity} onToggle={react} onAdd={(rect) => setPicker(rect)} />
            </div>

            <div className="tc-msg-actions" role="toolbar" aria-label={t('chat.messageActions')}>
                {onReply && (
                    <button type="button" className="tc-action" title={t('chat.reply')} aria-label={t('chat.reply')} onClick={() => onReply(message)}>
                        <ReplyGlyph />
                    </button>
                )}
                {canPin && (
                    <button
                        type="button"
                        className={`tc-action${message.pinned ? ' active' : ''}`}
                        title={t(message.pinned ? 'chat.unpin' : 'chat.pin')}
                        aria-label={t(message.pinned ? 'chat.unpin' : 'chat.pin')}
                        aria-pressed={!!message.pinned}
                        onClick={() => { togglePin(message.channel, message).catch(() => {}); }}
                    >
                        <PinGlyph />
                    </button>
                )}
                <button type="button" className="tc-action" title={t('chat.addReaction')} aria-label={t('chat.addReaction')} onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}>
                    <SmilePlus />
                </button>
                {canDelete && (
                    confirmDelete
                        ? <button type="button" className="tc-action tc-action-danger tc-action-confirm" onClick={() => removeMessage(message.channel, message.id).catch(() => setConfirmDelete(false))}>{t('chat.deleteConfirm')}</button>
                        : (
                            <button type="button" className="tc-action tc-action-danger" title={t('chat.delete')} aria-label={t('chat.delete')} onClick={() => setConfirmDelete(true)}>
                                <TrashGlyph />
                            </button>
                        )
                )}
            </div>

            {menu && (
                <MessageMenu
                    message={message}
                    x={menu.x}
                    y={menu.y}
                    myIdentity={myIdentity}
                    canDelete={canDelete}
                    canPin={canPin}
                    onReply={onReply}
                    onMoreReactions={() => setPicker(DOMRect.fromRect({ x: menu.x, y: menu.y, width: 0, height: 0 }))}
                    onClose={() => setMenu(null)}
                />
            )}
            {picker && <ReactionPicker anchor={picker} onPick={(emoji) => { react(emoji); setPicker(null); }} onClose={() => setPicker(null)} />}
        </div>
    );
});

/** The line above an answer: what it answers. A click goes there, loading back to it if needed. */
function ReplyLine({ channel, reply }: { channel: string; reply: NonNullable<ChatMessage['reply']> }) {
    const { t } = useTranslation();
    const presence = usePresence();
    const avatar = useAvatarForIdentity(reply.identity);
    const [gone, setGone] = useState(false);
    const name = presence?.get(reply.identity)?.name ?? reply.name;
    const text = plainText(reply.text, id => presence?.get(id)?.name ?? t('chat.unknownPerson'));
    return (
        <button
            type="button"
            className="tc-reply"
            onClick={async () => setGone(!(await jumpTo(channel, reply.id)))}
            title={t('chat.jumpToOriginal')}
        >
            <span className="tc-reply-avatar" style={{ background: avatar ? 'transparent' : avatarColorForIdentity(reply.identity) }}>
                {avatar ? <img src={avatar} alt="" /> : name[0]?.toUpperCase() ?? '?'}
            </span>
            <span className="tc-reply-name" style={{ color: avatarColorForIdentity(reply.identity) }}>{name}</span>
            <span className="tc-reply-text">{gone ? t('chat.originalGone') : text || t('chat.attachmentOnly')}</span>
        </button>
    );
}

function Reactions({ message, myIdentity, onToggle, onAdd }: { message: ChatMessage; myIdentity?: string; onToggle: (emoji: string) => void; onAdd: (rect: DOMRect) => void }) {
    const { t } = useTranslation();
    const presence = usePresence();
    const entries = Object.entries(message.reactions ?? {}).filter(([, who]) => who.length > 0);
    if (!entries.length) return null;
    return (
        <div className="tc-reactions">
            {entries.map(([emoji, who]) => {
                const mine = !!myIdentity && who.includes(myIdentity);
                const names = who.map(id => id === myIdentity ? t('sidebar.you') : presence?.get(id)?.name ?? '?').join(', ');
                return (
                    <button
                        key={emoji}
                        type="button"
                        className={`tc-reaction${mine ? ' mine' : ''}`}
                        aria-pressed={mine}
                        title={t('chat.reactedBy', { names, emoji })}
                        onClick={() => onToggle(emoji)}
                    >
                        <span className="tc-reaction-emoji">{emoji}</span>
                        <span className="tc-reaction-count">{who.length}</span>
                    </button>
                );
            })}
            <button type="button" className="tc-reaction tc-reaction-add" title={t('chat.addReaction')} aria-label={t('chat.addReaction')} onClick={(e) => onAdd(e.currentTarget.getBoundingClientRect())}>
                <SmilePlus />
            </button>
        </div>
    );
}

const PICKER_W = 320;
const PICKER_H = 300;

/** The emoji picker beside the button that opened it, above or below wherever it fits. */
function ReactionPicker({ anchor, onPick, onClose }: { anchor: DOMRect; onPick: (emoji: string) => void; onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    useDismiss(ref, onClose);
    const below = anchor.bottom + PICKER_H + 8 < window.innerHeight;
    const left = Math.max(8, Math.min(anchor.right - PICKER_W, window.innerWidth - PICKER_W - 8));
    const style = below ? { top: anchor.bottom + 6, left } : { top: Math.max(8, anchor.top - PICKER_H - 6), left };
    return createPortal(
        <div ref={ref} className="tc-react-pop" style={style}>
            <Suspense fallback={null}>
                <EmojiPicker onPick={onPick} />
            </Suspense>
        </div>,
        document.body,
    );
}

function SmilePlus() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 11.5a9 9 0 11-8.5-8.5" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
            <line x1="19" y1="2" x2="19" y2="8" />
            <line x1="16" y1="5" x2="22" y2="5" />
        </svg>
    );
}

function ReplyGlyph() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 00-4-4H4" />
        </svg>
    );
}

/** A pushpin, tilted as if stuck in a board. */
export function PinGlyph({ size = 15 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14.5 3.5l6 6" />
            <path d="M16.5 5.5l-4 4-4.5-.5-2 2 7 7 2-2-.5-4.5 4-4" />
            <path d="M9.5 14.5L4 20" />
        </svg>
    );
}

function TrashGlyph() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
    );
}
