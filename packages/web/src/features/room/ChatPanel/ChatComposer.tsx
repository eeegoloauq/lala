import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { useLocalParticipantPermissions } from '@livekit/components-react';
import { useTranslation } from 'react-i18next';
import { useDismiss } from '../../../hooks/useDismiss';
import { useTimedValue } from '../../../hooks/useTimedValue';

const EmojiPicker = lazy(() => import('./EmojiPicker').then(m => ({ default: m.EmojiPicker })));

/** Client-side chat rate limiter: max messages per sliding window */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 3000;
const RATE_LIMIT_COOLDOWN_MS = 2000;

interface ChatComposerProps {
    send: (msg: string) => Promise<unknown>;
    isSending: boolean;
    /** Takes attached or pasted files; without it the composer offers no attachments. */
    onFiles?: (files: Iterable<File>) => void;
}

export function ChatComposer({ send, isSending, onFiles }: ChatComposerProps) {
    const { t } = useTranslation();
    const [text, setText] = useState('');
    const [showEmoji, setShowEmoji] = useState(false);
    const [rateLimited, showRateLimited] = useTimedValue<true>(RATE_LIMIT_COOLDOWN_MS);
    const [sendFailed, setSendFailed] = useState(false);
    // The room may not let us chat (the server config sets who may).
    const mayChat = useLocalParticipantPermissions()?.canPublishData ?? true;
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const emojiWrapRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const sendTimestamps = useRef<number[]>([]);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const closeEmoji = useCallback(() => setShowEmoji(false), []);
    useDismiss(emojiWrapRef, closeEmoji, showEmoji);

    const insertEmoji = (emoji: string) => {
        const ta = inputRef.current;
        if (!ta) { setText(prev => prev + emoji); return; }
        const start = ta.selectionStart ?? text.length;
        const end = ta.selectionEnd ?? text.length;
        setText(text.slice(0, start) + emoji + text.slice(end));
        requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(start + emoji.length, start + emoji.length);
        });
    };

    const handleSend = async () => {
        const trimmed = text.trim();
        if (!trimmed || isSending || rateLimited) return;

        const now = Date.now();
        sendTimestamps.current = sendTimestamps.current.filter(ts => ts > now - RATE_LIMIT_WINDOW_MS);
        if (sendTimestamps.current.length >= RATE_LIMIT_MAX) {
            showRateLimited(true);
            return;
        }

        sendTimestamps.current.push(now);
        setText('');
        setSendFailed(false);
        try {
            await send(trimmed);
        } catch (err) {
            // Put the message back rather than lose it.
            console.warn('[ChatComposer] Sending failed:', err instanceof Error ? err.message : err);
            setText(current => current || trimmed);
            setSendFailed(true);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Escape') { e.currentTarget.blur(); return; }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(e.clipboardData.items)
            .filter(item => item.kind === 'file')
            .map(item => item.getAsFile())
            .filter((file): file is File => file !== null);
        if (files.length > 0 && onFiles) {
            e.preventDefault();
            onFiles(files);
        }
    };

    return (
        <>
            {rateLimited && <div className="cp-rate-limit">{t('chat.tooFast')}</div>}
            {sendFailed && <div className="cp-rate-limit">{t('chat.sendFailed')}</div>}

            <div className="cp-input-area">
                <textarea
                    ref={inputRef}
                    id="chat-input"
                    name="chat-input"
                    className="cp-input"
                    placeholder={!mayChat ? t('chat.notAllowed') : rateLimited ? t('chat.tooFast') : t('chat.placeholder')}
                    disabled={!mayChat}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    rows={1}
                />
                {onFiles && mayChat && (
                    <>
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="cp-file-input-hidden"
                            onChange={(e) => {
                                onFiles(e.target.files ?? []);
                                e.target.value = ''; // allow re-selecting the same file
                            }}
                            tabIndex={-1}
                        />
                        <button
                            className="cp-attach-btn"
                            onClick={() => fileInputRef.current?.click()}
                            title={t('chat.attach')}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                            </svg>
                        </button>
                    </>
                )}
                <div className="cp-emoji-wrap" ref={emojiWrapRef}>
                    {showEmoji && (
                        <Suspense fallback={null}>
                            <EmojiPicker onPick={insertEmoji} />
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
                    disabled={!mayChat || !text.trim() || isSending || !!rateLimited}
                    title={t('chat.send')}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                </button>
            </div>
        </>
    );
}
