import { useTranslation } from 'react-i18next';
import type { FormatKind } from '../../../lib/chatMarkup';
import { avatarColorForIdentity } from '../../../lib/avatarUtils';
import { useAvatarForIdentity } from '../../../lib/roomStatusStore';
import { WithStatus } from '../../../ui/StatusDot';
import { formatFileSize } from '../../../lib/fileTransfer';
import '../../../ui/panel.css';
import { MENTIONS_ID, mentionOptionId, type MentionCandidate, type StagedFile } from './composerTools';

/**
 * The `@` list above the chat box, like the command list: the textarea keeps focus and
 * drives it as a combobox (arrows, Enter, Tab, Escape in ChatComposer).
 */
export function MentionSuggestions({ items, active, query, onPick }: { items: MentionCandidate[]; active: number; query: string; onPick: (p: MentionCandidate) => void }) {
    const { t } = useTranslation();
    return (
        <div className="cp-suggest">
            <div className="cp-suggest-head">{t('chat.mentionMatching', { query: `@${query}` })}</div>
            <div id={MENTIONS_ID} role="listbox" aria-label={t('chat.mentionList')}>
                {items.map((p, i) => (
                    <div
                        key={p.identity}
                        id={mentionOptionId(i)}
                        role="option"
                        aria-selected={i === active}
                        className={`cp-suggest-item cp-mention-item${i === active ? ' active' : ''}`}
                        onMouseDown={(e) => { e.preventDefault(); onPick(p); }}
                    >
                        <MentionAvatar person={p} />
                        <span className="cp-mention-name">{p.name}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function MentionAvatar({ person }: { person: MentionCandidate }) {
    const avatar = useAvatarForIdentity(person.identity);
    return (
        <WithStatus status={person.status}>
            <span className="person-avatar cp-mention-avatar" style={{ background: avatar ? 'transparent' : avatarColorForIdentity(person.identity) }}>
                {avatar ? <img src={avatar} alt="" /> : person.name[0]?.toUpperCase() ?? '?'}
            </span>
        </WithStatus>
    );
}

const FORMATS: Array<{ kind: FormatKind; label: string; glyph: React.ReactNode }> = [
    { kind: 'bold', label: 'chat.format.bold', glyph: <b>B</b> },
    { kind: 'italic', label: 'chat.format.italic', glyph: <i>I</i> },
    { kind: 'underline', label: 'chat.format.underline', glyph: <u>U</u> },
    { kind: 'strike', label: 'chat.format.strike', glyph: <s>S</s> },
    { kind: 'code', label: 'chat.format.code', glyph: <code>{'<>'}</code> },
    { kind: 'spoiler', label: 'chat.format.spoiler', glyph: <EyeOffGlyph /> },
    { kind: 'quote', label: 'chat.format.quote', glyph: <QuoteGlyph /> },
];

/** Shown while text in the box is selected; buttons don't take focus, so the selection stays. */
export function FormatBar({ onFormat }: { onFormat: (kind: FormatKind) => void }) {
    const { t } = useTranslation();
    return (
        <div className="cp-format-bar" role="toolbar" aria-label={t('chat.format.title')}>
            {FORMATS.map(f => (
                <button
                    key={f.kind}
                    type="button"
                    className="cp-format-btn"
                    title={t(f.label)}
                    aria-label={t(f.label)}
                    onMouseDown={(e) => { e.preventDefault(); onFormat(f.kind); }}
                >
                    {f.glyph}
                </button>
            ))}
        </div>
    );
}

/** Files waiting for the message: a preview or a file card, with spoiler and remove. */
export function StagedFiles({ files, allowSpoiler, onRemove, onToggleSpoiler }: {
    files: StagedFile[];
    allowSpoiler: boolean;
    onRemove: (id: string) => void;
    onToggleSpoiler: (id: string) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="cp-staged" aria-label={t('chat.attachments')}>
            {files.map(f => (
                <div key={f.id} className={`cp-staged-item${f.spoiler ? ' cp-staged-spoiler' : ''}`}>
                    {f.preview
                        ? <img className="cp-staged-thumb" src={f.preview} alt={f.file.name} />
                        : <span className="cp-staged-file"><FileGlyph /><span>{f.file.name}</span><span className="cp-staged-size">{formatFileSize(f.file.size)}</span></span>}
                    {f.spoiler && <span className="cp-staged-badge">{t('chat.spoiler')}</span>}
                    <div className="cp-staged-actions">
                        {allowSpoiler && (
                            <button
                                type="button"
                                className={`cp-staged-btn${f.spoiler ? ' active' : ''}`}
                                // Keeps the text box focused, so Enter still sends.
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => onToggleSpoiler(f.id)}
                                title={t(f.spoiler ? 'chat.unmarkSpoiler' : 'chat.markSpoiler')}
                                aria-label={t(f.spoiler ? 'chat.unmarkSpoiler' : 'chat.markSpoiler')}
                                aria-pressed={f.spoiler}
                            >
                                <EyeOffGlyph />
                            </button>
                        )}
                        <button type="button" className="cp-staged-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => onRemove(f.id)} title={t('chat.removeAttachment')} aria-label={t('chat.removeAttachment')}>
                            ✕
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}

function EyeOffGlyph() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
    );
}

function QuoteGlyph() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <line x1="4" y1="5" x2="4" y2="19" />
            <line x1="9" y1="8" x2="20" y2="8" />
            <line x1="9" y1="16" x2="17" y2="16" />
        </svg>
    );
}

function FileGlyph() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    );
}
