import { FORMAT_MARKS, type FormatKind } from '../../../lib/chatMarkup';
import type { PresenceStatus } from '../../../lib/types';

/** Someone the `@` picker offers. */
export interface MentionCandidate {
    identity: string;
    name: string;
    status?: PresenceStatus;
}

/** A file waiting in the composer for its message. */
export interface StagedFile {
    id: string;
    file: File;
    spoiler: boolean;
    /** Images only: a local preview, revoked when the file leaves the tray. */
    preview?: string;
}

export const MENTIONS_ID = 'cp-mention-suggestions';
export const mentionOptionId = (i: number) => `${MENTIONS_ID}-${i}`;

/** The `@word` the caret is at the end of, with where it starts; null when there is none. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
    const m = /(?:^|\s)@([^\s@<>]{0,32})$/u.exec(text.slice(0, caret));
    return m ? { start: caret - m[1].length - 1, query: m[1] } : null;
}

const STATUS_ORDER: Record<PresenceStatus, number> = { online: 0, idle: 1, dnd: 2, offline: 3 };

/** Names starting with the query first, then names containing it; online people before others. */
export function matchMentions(query: string, people: MentionCandidate[], limit = 8): MentionCandidate[] {
    const q = query.toLocaleLowerCase();
    const scored = people
        .map(p => ({ p, at: p.name.toLocaleLowerCase().indexOf(q) }))
        .filter(x => x.at >= 0);
    scored.sort((a, b) => (a.at === 0 ? 0 : 1) - (b.at === 0 ? 0 : 1)
        || STATUS_ORDER[a.p.status ?? 'offline'] - STATUS_ORDER[b.p.status ?? 'offline']
        || a.p.name.localeCompare(b.p.name));
    return scored.slice(0, limit).map(x => x.p);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The text as sent: each `@Name` picked from the list becomes `<@identity>`. Names aren't
 * unique, so only picks count; an `@Name` typed by hand stays text. Longer names go first,
 * so "@Ana Maria" isn't taken for "@Ana".
 */
export function withMentionTokens(text: string, picked: Map<string, string>): string {
    let out = text;
    for (const [label, identity] of [...picked].sort((a, b) => b[0].length - a[0].length)) {
        out = out.replace(new RegExp(`${escape(label)}(?![\\p{L}\\p{N}_])`, 'gu'), `<@${identity}>`);
    }
    return out;
}

/**
 * Puts formatting around the selection, or takes it off when it is already there, through
 * the browser's own editing so Ctrl+Z undoes it. `execCommand('insertText')` is deprecated
 * but is still the only way to edit a textarea that keeps the undo history (Chromium,
 * Firefox, Safari all support it); without it the value is set directly and undo skips it.
 */
export function applyFormat(ta: HTMLTextAreaElement, kind: FormatKind): void {
    const { selectionStart: start, selectionEnd: end, value } = ta;
    const selected = value.slice(start, end);
    let replacement: string;
    let from = start;
    let to = end;
    let select: [number, number];

    if (kind === 'quote') {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        from = lineStart;
        const lines = value.slice(lineStart, end).split('\n');
        const quoted = lines.every(l => l.startsWith('> '));
        replacement = lines.map(l => quoted ? l.slice(2) : `> ${l}`).join('\n');
        select = [lineStart, lineStart + replacement.length];
    } else {
        const mark = FORMAT_MARKS[kind];
        const wrapped = value.slice(start - mark.length, start) === mark && value.slice(end, end + mark.length) === mark;
        if (wrapped) {
            from = start - mark.length;
            to = end + mark.length;
            replacement = selected;
            select = [from, from + selected.length];
        } else {
            replacement = `${mark}${selected}${mark}`;
            select = [start + mark.length, start + mark.length + selected.length];
        }
    }

    ta.focus();
    ta.setSelectionRange(from, to);
    if (!document.execCommand('insertText', false, replacement)) {
        ta.setRangeText(replacement, from, to, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ta.setSelectionRange(select[0], select[1]);
}

/** Ctrl/Cmd + B, I, U format the selection, as in every editor. */
export function formatForShortcut(e: React.KeyboardEvent): FormatKind | null {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null;
    return ({ b: 'bold', i: 'italic', u: 'underline' } as const)[e.key.toLowerCase() as 'b' | 'i' | 'u'] ?? null;
}
