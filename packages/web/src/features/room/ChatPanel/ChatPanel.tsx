import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { useTranslation } from 'react-i18next';

const EmojiPicker = lazy(() => import('./EmojiPicker').then(m => ({ default: m.EmojiPicker })));
import type { ReceivedChatMessage } from '@livekit/components-react';
import { colorForName } from '../../../lib/participantColor';
import './chat-panel.css';

export type ChatEntry =
    | { kind: 'chat'; msg: ReceivedChatMessage }
    | { kind: 'system'; id: string; timestamp: number; order?: number; text: string };

interface ChatPanelProps {
    entries: ChatEntry[];
    send: (msg: string) => Promise<unknown>;
    isSending: boolean;
    onClose?: () => void;
    inline?: boolean;
    overlay?: boolean;
}

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface MessageGroup {
    identity: string;
    displayName: string;
    isOwn: boolean;
    entries: Array<{ id: string; text: string; timestamp: number }>;
}

function buildGroups(entries: ChatEntry[], localIdentity: string): Array<MessageGroup | { kind: 'system'; id: string; timestamp: number; text: string }> {
    const result: Array<MessageGroup | { kind: 'system'; id: string; timestamp: number; text: string }> = [];
    let currentGroup: MessageGroup | null = null;

    for (const entry of entries) {
        if (entry.kind === 'system') {
            currentGroup = null;
            result.push(entry);
            continue;
        }

        const identity = entry.msg.from?.identity || 'Unknown';
        const displayName = entry.msg.from?.name || identity;
        const isOwn = identity === localIdentity;

        if (currentGroup && currentGroup.identity === identity) {
            currentGroup.entries.push({ id: entry.msg.id, text: entry.msg.message, timestamp: entry.msg.timestamp });
        } else {
            currentGroup = { identity, displayName, isOwn, entries: [{ id: entry.msg.id, text: entry.msg.message, timestamp: entry.msg.timestamp }] };
            result.push(currentGroup);
        }
    }

    return result;
}

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_W = 200, MAX_W = 640, MIN_H = 160;

/** Directly apply position/size to panel DOM — bypasses React reconciliation during drag */
function applyPanelStyle(panel: HTMLElement, top: number, left: number, w: number, h: number) {
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.width = `${w}px`;
    panel.style.height = `${h}px`;
}

function getPanelRect(panel: HTMLElement): { top: number; left: number; w: number; h: number } {
    const pr = panel.getBoundingClientRect();
    const cr = panel.parentElement!.getBoundingClientRect();
    return { top: pr.top - cr.top, left: pr.left - cr.left, w: pr.width, h: pr.height };
}

/** Client-side chat rate limiter: max messages per sliding window */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 3000;
const RATE_LIMIT_COOLDOWN_MS = 2000;

export function ChatPanel({ entries, send, isSending, onClose, inline = false, overlay = false }: ChatPanelProps) {
    const { t } = useTranslation();
    const { localParticipant } = useLocalParticipant();
    const [text, setText] = useState('');
    const [showEmoji, setShowEmoji] = useState(false);
    const [rateLimited, setRateLimited] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const messagesRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const emojiWrapRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const isNearBottomRef = useRef(true);
    const isFloating = useRef(false); // true after first drag/resize
    const sendTimestamps = useRef<number[]>([]);
    const rateLimitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const dragRef = useRef<{ startMX: number; startMY: number; startTop: number; startLeft: number } | null>(null);
    const resizeRef = useRef<{ startMX: number; startMY: number; startTop: number; startLeft: number; startW: number; startH: number; dir: ResizeDir } | null>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    // Drag / resize — direct DOM manipulation, no React state during interaction
    useEffect(() => {
        if (!overlay) return;

        const onMove = (e: MouseEvent) => {
            const panel = panelRef.current;
            if (!panel) return;

            const drag = dragRef.current;
            if (drag) {
                const top = drag.startTop + (e.clientY - drag.startMY);
                const left = drag.startLeft + (e.clientX - drag.startMX);
                panel.style.top = `${top}px`;
                panel.style.left = `${left}px`;
                return;
            }

            const r = resizeRef.current;
            if (!r) return;
            const dx = e.clientX - r.startMX;
            const dy = e.clientY - r.startMY;
            let top = r.startTop, left = r.startLeft, w = r.startW, h = r.startH;

            if (r.dir.includes('e')) w = Math.max(MIN_W, Math.min(MAX_W, r.startW + dx));
            if (r.dir.includes('w')) {
                w = Math.max(MIN_W, Math.min(MAX_W, r.startW - dx));
                left = r.startLeft + (r.startW - w);
            }
            if (r.dir.includes('s')) h = Math.max(MIN_H, r.startH + dy);
            if (r.dir.includes('n')) {
                h = Math.max(MIN_H, r.startH - dy);
                top = r.startTop + (r.startH - h);
            }
            applyPanelStyle(panel, top, left, w, h);
        };

        const onUp = () => {
            dragRef.current = null;
            resizeRef.current = null;
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
    }, [overlay]);

    /** Lock panel to absolute coords before starting interaction */
    const lockPanel = () => {
        const panel = panelRef.current;
        if (!panel) return null;
        if (!isFloating.current) {
            const { top, left, w, h } = getPanelRect(panel);
            applyPanelStyle(panel, top, left, w, h);
            isFloating.current = true;
        }
        return panel;
    };

    const startDrag = (e: React.MouseEvent) => {
        if (!overlay) return;
        e.preventDefault();
        const panel = lockPanel();
        if (!panel) return;
        const { top, left } = getPanelRect(panel);
        dragRef.current = { startMX: e.clientX, startMY: e.clientY, startTop: top, startLeft: left };
    };

    const startResize = (e: React.MouseEvent, dir: ResizeDir) => {
        if (!overlay) return;
        e.preventDefault();
        e.stopPropagation();
        const panel = lockPanel();
        if (!panel) return;
        const { top, left, w, h } = getPanelRect(panel);
        resizeRef.current = { startMX: e.clientX, startMY: e.clientY, startTop: top, startLeft: left, startW: w, startH: h, dir };
    };

    // Close emoji picker on outside click
    useEffect(() => {
        if (!showEmoji) return;
        const onDown = (e: MouseEvent) => {
            if (emojiWrapRef.current && !emojiWrapRef.current.contains(e.target as Node)) {
                setShowEmoji(false);
            }
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [showEmoji]);

    // Track scroll position
    useEffect(() => {
        const el = messagesRef.current;
        if (!el) return;
        const onScroll = () => {
            isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, []);

    // Auto-scroll only when near bottom
    useEffect(() => {
        if (isNearBottomRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [entries]);

    const insertEmoji = useCallback((emoji: string) => {
        const ta = inputRef.current;
        if (!ta) { setText(prev => prev + emoji); return; }
        const start = ta.selectionStart ?? text.length;
        const end = ta.selectionEnd ?? text.length;
        setText(text.slice(0, start) + emoji + text.slice(end));
        requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(start + emoji.length, start + emoji.length);
        });
    }, [text]);

    // Clean up rate limit timer on unmount
    useEffect(() => {
        return () => {
            if (rateLimitTimer.current) clearTimeout(rateLimitTimer.current);
        };
    }, []);

    const handleSend = useCallback(async () => {
        const trimmed = text.trim();
        if (!trimmed || isSending || rateLimited) return;

        // Sliding window rate limit
        const now = Date.now();
        const cutoff = now - RATE_LIMIT_WINDOW_MS;
        sendTimestamps.current = sendTimestamps.current.filter(ts => ts > cutoff);

        if (sendTimestamps.current.length >= RATE_LIMIT_MAX) {
            setRateLimited(true);
            if (rateLimitTimer.current) clearTimeout(rateLimitTimer.current);
            rateLimitTimer.current = setTimeout(() => {
                setRateLimited(false);
                rateLimitTimer.current = null;
            }, RATE_LIMIT_COOLDOWN_MS);
            return;
        }

        sendTimestamps.current.push(now);
        setText('');
        await send(trimmed);
    }, [text, isSending, rateLimited, send]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Escape') { e.currentTarget.blur(); return; }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    const groups = buildGroups(entries, localParticipant.identity);

    return (
        <div
            ref={panelRef}
            className={`cp-panel${inline ? ' cp-inline' : ''}${overlay ? ' cp-overlay' : ''}`}
        >
            {overlay && <>
                <div className="cp-resize cp-resize-n" onMouseDown={e => startResize(e, 'n')} />
                <div className="cp-resize cp-resize-s" onMouseDown={e => startResize(e, 's')} />
                <div className="cp-resize cp-resize-w" onMouseDown={e => startResize(e, 'w')} />
                <div className="cp-resize cp-resize-e" onMouseDown={e => startResize(e, 'e')} />
                <div className="cp-resize cp-resize-nw" onMouseDown={e => startResize(e, 'nw')} />
                <div className="cp-resize cp-resize-ne" onMouseDown={e => startResize(e, 'ne')} />
                <div className="cp-resize cp-resize-sw" onMouseDown={e => startResize(e, 'sw')} />
                <div className="cp-resize cp-resize-se" onMouseDown={e => startResize(e, 'se')} />
            </>}

            {!inline && (
                <div className="cp-header" onMouseDown={overlay ? startDrag : undefined}>
                    <span>{t('chat.title')}</span>
                    {onClose && (
                        <button className="cp-close" onMouseDown={e => e.stopPropagation()} onClick={onClose} title={t('chat.close')}>✕</button>
                    )}
                </div>
            )}

            <div className="cp-messages" ref={messagesRef}>
                {entries.length === 0 && <span className="cp-empty">{t('chat.noMessages')}</span>}

                {groups.map((item) => {
                    if ('kind' in item && item.kind === 'system') {
                        return (
                            <div key={item.id} className="cp-system">
                                <span>{item.text}</span>
                                <span className="cp-time">{formatTime(item.timestamp)}</span>
                            </div>
                        );
                    }
                    const group = item as MessageGroup;
                    return (
                        <div key={`${group.identity}-${group.entries[0].id}`} className={`cp-group${group.isOwn ? ' cp-group-own' : ''}`}>
                            <div className="cp-group-header">
                                <span className="cp-sender" style={{ color: colorForName(group.displayName) }}>
                                    {group.displayName}
                                </span>
                                <span className="cp-time">{formatTime(group.entries[0].timestamp)}</span>
                            </div>
                            {group.entries.map((e) => (
                                <div key={e.id} className="cp-bubble">{e.text}</div>
                            ))}
                        </div>
                    );
                })}
                <div ref={bottomRef} />
            </div>

            {rateLimited && (
                <div className="cp-rate-limit">{t('chat.tooFast')}</div>
            )}

            <div className="cp-input-area">
                <textarea
                    ref={inputRef}
                    id="chat-input"
                    name="chat-input"
                    className="cp-input"
                    placeholder={rateLimited ? t('chat.tooFast') : t('chat.placeholder')}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                />
                <div className="cp-emoji-wrap" ref={emojiWrapRef}>
                    {showEmoji && (
                        <Suspense fallback={null}>
                            <EmojiPicker onPick={(e) => { insertEmoji(e); }} />
                        </Suspense>
                    )}
                    <button
                        className={`cp-emoji-btn${showEmoji ? ' active' : ''}`}
                        onClick={() => setShowEmoji(s => !s)}
                        title={t('chat.emoji')}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                            <line x1="9" y1="9" x2="9.01" y2="9" />
                            <line x1="15" y1="9" x2="15.01" y2="9" />
                        </svg>
                    </button>
                </div>
                <button
                    className="cp-send"
                    onClick={handleSend}
                    disabled={!text.trim() || isSending || rateLimited}
                    title={t('chat.send')}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
