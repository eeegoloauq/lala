import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useDismiss } from '../../../hooks/useDismiss';
import { useTimedValue } from '../../../hooks/useTimedValue';
import { requestChatDraft, useBotsInRoom, useChatDraft } from '../../../lib/roomStatusStore';
import { CommandSuggestions } from './CommandSuggestions';
import { matchCommands, SUGGESTIONS_ID, suggestionId, type Suggestion } from './commandSuggestions';
import { FormatBar, MentionSuggestions, StagedFiles } from './ComposerParts';
import {
    applyFormat, formatForShortcut, matchMentions, mentionOptionId, mentionQuery, MENTIONS_ID, withMentionTokens,
    type MentionCandidate, type StagedFile,
} from './composerTools';
import type { StagedFilesController } from './useStagedFiles';

const EmojiPicker = lazy(() => import('./EmojiPicker').then(m => ({ default: m.EmojiPicker })));

/** Client-side chat rate limiter: max messages per sliding window */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 3000;
const RATE_LIMIT_COOLDOWN_MS = 2000;
/** What the server takes; the box stops there. */
export const MAX_MESSAGE_LENGTH = 4000;

interface ChatComposerProps {
    /** Sends the text (mentions as `<@identity>`) with the files from the tray. */
    send: (text: string, files: StagedFile[]) => Promise<unknown>;
    isSending: boolean;
    /** Whether we may write here (the server config sets who may). */
    mayChat: boolean;
    /** The tray of files waiting for the message; without it the composer offers no attachments. */
    staged?: StagedFilesController;
    /** Whether a file can be marked as a spoiler. */
    allowSpoiler?: boolean;
    /** Who `@` offers; without it there is no picker. */
    mentions?: MentionCandidate[];
    /** The call's chat: bots' `!` commands and drafts from a bot's profile. */
    botCommands?: boolean;
    placeholder?: string;
    /** Shown instead of the usual "chat is off" line when writing isn't allowed. */
    notAllowedText?: string;
    /** The message being answered: a bar above the box, Escape or ✕ drops it. */
    replyingTo?: { name: string; onCancel: () => void };
    /**
     * Typing while nothing else takes the keys (after clicking a message, say) writes here.
     * Not in a call, where single keys are shortcuts.
     */
    focusOnType?: boolean;
}

/** Open over the page: what has the keys then, even if nothing in it is focused. */
const OVERLAY = '.modal-overlay, .settings-overlay, .ctx-menu, [role="dialog"], .emoji-picker, .cp-lightbox-backdrop';

/** Whether the key goes to whatever is focused: a field, or a button that Space and Enter press. */
function keyBelongsElsewhere(e: KeyboardEvent): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (el?.isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
    if ((e.key === ' ' || e.key === 'Enter') && el && el !== document.body) return true;
    return document.querySelector(OVERLAY) !== null;
}

export function ChatComposer({ send, isSending, mayChat, staged, allowSpoiler = false, mentions, botCommands = true, placeholder, notAllowedText, replyingTo, focusOnType = false }: ChatComposerProps) {
    const { t } = useTranslation();
    const [text, setText] = useState('');
    const [showEmoji, setShowEmoji] = useState(false);
    const [rateLimited, showRateLimited] = useTimedValue<true>(RATE_LIMIT_COOLDOWN_MS);
    const [sendFailed, setSendFailed] = useState(false);
    const [caret, setCaret] = useState(0);
    const [hasSelection, setHasSelection] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const emojiWrapRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const sendTimestamps = useRef<number[]>([]);
    // "@Name" shown in the box -> the identity it was picked for.
    const picked = useRef(new Map<string, string>());

    useEffect(() => { inputRef.current?.focus(); }, []);
    // Answering a message: the box is where the answer goes.
    const replyName = replyingTo?.name;
    useEffect(() => { if (replyName) inputRef.current?.focus(); }, [replyName]);

    // Focused on keydown, the box gets the character (or the paste) that follows.
    useEffect(() => {
        if (!focusOnType || !mayChat) return;
        const onKey = (e: KeyboardEvent) => {
            const paste = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'v';
            const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
            if (e.defaultPrevented || e.isComposing || !(printable || paste) || keyBelongsElsewhere(e)) return;
            inputRef.current?.focus();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [focusOnType, mayChat]);

    // A command picked on a bot's profile lands here, unsent.
    const draft = useChatDraft();
    useEffect(() => {
        if (!botCommands || draft === null) return;
        setText(draft);
        requestChatDraft(null);
        requestAnimationFrame(() => {
            const ta = inputRef.current;
            ta?.focus();
            ta?.setSelectionRange(draft.length, draft.length);
        });
    }, [draft, botCommands]);

    const bots = useBotsInRoom();
    const [activeSuggestion, setActiveSuggestion] = useState(0);
    const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
    const commands = suggestionsDismissed || !botCommands ? [] : matchCommands(text, bots.values());
    const mention = mentions && !suggestionsDismissed ? mentionQuery(text, caret) : null;
    const people = mention ? matchMentions(mention.query, mentions!) : [];
    const listLength = commands.length || people.length;
    const active = Math.min(activeSuggestion, Math.max(listLength - 1, 0));

    const trackCaret = () => {
        const ta = inputRef.current;
        if (!ta) return;
        setCaret(ta.selectionEnd);
        setHasSelection(ta.selectionEnd > ta.selectionStart && document.activeElement === ta);
    };

    const pickCommand = (s: Suggestion) => {
        setText(`${s.name} `);
        setActiveSuggestion(0);
    };

    const pickMention = (p: MentionCandidate) => {
        if (!mention) return;
        const label = `@${p.name}`;
        picked.current.set(label, p.identity);
        const next = `${text.slice(0, mention.start)}${label} ${text.slice(caret)}`;
        const at = mention.start + label.length + 1;
        setText(next);
        setActiveSuggestion(0);
        requestAnimationFrame(() => {
            inputRef.current?.setSelectionRange(at, at);
            setCaret(at);
        });
    };

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
        const hasFiles = !!staged?.files.length;
        if ((!trimmed && !hasFiles) || isSending || rateLimited) return;

        const now = Date.now();
        sendTimestamps.current = sendTimestamps.current.filter(ts => ts > now - RATE_LIMIT_WINDOW_MS);
        if (sendTimestamps.current.length >= RATE_LIMIT_MAX) {
            showRateLimited(true);
            return;
        }

        sendTimestamps.current.push(now);
        const wire = withMentionTokens(trimmed, picked.current);
        const taken = staged?.take();
        setText('');
        setSendFailed(false);
        try {
            await send(wire, taken?.files ?? []);
            taken?.done(true);
            picked.current.clear();
        } catch (err) {
            // Put the message back rather than lose it.
            console.warn('[ChatComposer] Sending failed:', err instanceof Error ? err.message : err);
            setText(current => current || trimmed);
            taken?.done(false);
            setSendFailed(true);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (listLength > 0) {
            const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
            if (step) {
                e.preventDefault();
                setActiveSuggestion((active + step + listLength) % listLength);
                return;
            }
            if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                e.preventDefault();
                if (commands.length) pickCommand(commands[active]);
                else pickMention(people[active]);
                return;
            }
            if (e.key === 'Escape') { setSuggestionsDismissed(true); return; }
        }
        const format = formatForShortcut(e);
        if (format) {
            e.preventDefault();
            applyFormat(e.currentTarget, format);
            return;
        }
        if (e.key === 'Escape') {
            if (replyingTo) replyingTo.onCancel();
            else e.currentTarget.blur();
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(e.clipboardData.items)
            .filter(item => item.kind === 'file')
            .map(item => item.getAsFile())
            .filter((file): file is File => file !== null);
        if (files.length > 0 && staged) {
            e.preventDefault();
            staged.add(files);
        }
    };

    const listOpen = listLength > 0;
    const canSend = mayChat && (!!text.trim() || !!staged?.files.length) && !isSending && !rateLimited;

    return (
        <>
            {rateLimited && <div className="cp-rate-limit">{t('chat.tooFast')}</div>}
            {sendFailed && <div className="cp-rate-limit">{t('chat.sendFailed')}</div>}

            {commands.length > 0 && <CommandSuggestions items={commands} active={active} onPick={pickCommand} />}
            {people.length > 0 && mention && <MentionSuggestions items={people} active={active} query={mention.query} onPick={pickMention} />}

            {replyingTo && (
                <div className="cp-replying">
                    <span>{t('chat.replyingTo')} <strong>{replyingTo.name}</strong></span>
                    <button type="button" className="cp-replying-cancel" onMouseDown={(e) => e.preventDefault()} onClick={replyingTo.onCancel} title={t('chat.cancelReply')} aria-label={t('chat.cancelReply')}>✕</button>
                </div>
            )}

            {staged && staged.files.length > 0 && (
                <StagedFiles files={staged.files} allowSpoiler={allowSpoiler} onRemove={staged.remove} onToggleSpoiler={staged.toggleSpoiler} />
            )}

            <div className="cp-input-area">
                {hasSelection && mayChat && (
                    <FormatBar onFormat={(kind) => { if (inputRef.current) { applyFormat(inputRef.current, kind); trackCaret(); } }} />
                )}
                <textarea
                    ref={inputRef}
                    id="chat-input"
                    name="chat-input"
                    className="cp-input"
                    placeholder={!mayChat ? (notAllowedText ?? t('chat.notAllowed')) : rateLimited ? t('chat.tooFast') : (placeholder ?? t('chat.placeholder'))}
                    disabled={!mayChat}
                    value={text}
                    maxLength={MAX_MESSAGE_LENGTH}
                    onChange={(e) => { setText(e.target.value); setSuggestionsDismissed(false); trackCaret(); }}
                    onSelect={trackCaret}
                    onBlur={() => setHasSelection(false)}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={listOpen}
                    aria-controls={commands.length ? SUGGESTIONS_ID : MENTIONS_ID}
                    aria-activedescendant={!listOpen ? undefined : commands.length ? suggestionId(active) : mentionOptionId(active)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    rows={1}
                />
                {staged && mayChat && (
                    <>
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="cp-file-input-hidden"
                            onChange={(e) => {
                                staged.add(e.target.files ?? []);
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
                        disabled={!mayChat}
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
                    disabled={!canSend}
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
