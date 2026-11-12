import { memo, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { parseMarkup, type MarkupNode } from '../lib/chatMarkup';
import { usePresence } from '../lib/presence';
import { openProfile } from '../lib/profileCard';
import './chat-text.css';

interface ChatTextProps {
    text: string;
    /** Whose mentions are highlighted as "you". */
    myIdentity?: string;
}

/**
 * One emoji, however it is built (skin tones, joined families, flags, keycaps). The `v` flag
 * knows the full set; a browser without it gets a close approximation.
 */
const EMOJI = (() => {
    try {
        return new RegExp('\\p{RGI_Emoji}', 'gv');
    } catch {
        return /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;
    }
})();
/** A message of only emoji, up to this many, shows them large, as chat apps do. */
const JUMBO_MAX = 27;

function isJumbo(text: string): boolean {
    const emoji = text.match(EMOJI);
    return !!emoji && emoji.length <= JUMBO_MAX && !text.replace(EMOJI, '').trim();
}

/** Emoji in running text, a little larger than the letters around them. */
function withEmoji(text: string, key: number): ReactNode {
    const parts: ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(EMOJI)) {
        if (m.index > last) parts.push(text.slice(last, m.index));
        parts.push(<span key={`${key}-${m.index}`} className="md-emoji">{m[0]}</span>);
        last = m.index + m[0].length;
    }
    if (!parts.length) return text;
    if (last < text.length) parts.push(text.slice(last));
    return parts;
}

/** A chat message with its formatting; see lib/chatMarkup.ts for what it understands. */
export const ChatText = memo(function ChatText({ text, myIdentity }: ChatTextProps) {
    const nodes = useMemo(() => parseMarkup(text), [text]);
    const jumbo = useMemo(() => isJumbo(text), [text]);
    return jumbo ? <span className="md-jumbo">{text.trim()}</span> : <>{render(nodes, myIdentity)}</>;
});

function render(nodes: MarkupNode[], me: string | undefined): ReactNode[] {
    return nodes.map((node, i) => {
        switch (node.kind) {
            case 'text': return withEmoji(node.text, i);
            case 'br': return <br key={i} />;
            case 'code': return <code key={i} className="md-code">{node.text}</code>;
            case 'codeblock': return <pre key={i} className="md-codeblock"><code>{node.text}</code></pre>;
            case 'quote': return <blockquote key={i} className="md-quote">{render(node.children, me)}</blockquote>;
            case 'heading': {
                const Tag = (['h3', 'h4', 'h5'] as const)[node.level - 1];
                return <Tag key={i} className={`md-heading md-h${node.level}`}>{render(node.children, me)}</Tag>;
            }
            case 'list': {
                const items = node.items.map((item, j) => <li key={j}>{render(item, me)}</li>);
                return node.ordered
                    ? <ol key={i} className="md-list" start={node.start}>{items}</ol>
                    : <ul key={i} className="md-list">{items}</ul>;
            }
            case 'bold': return <strong key={i}>{render(node.children, me)}</strong>;
            case 'italic': return <em key={i}>{render(node.children, me)}</em>;
            case 'underline': return <u key={i}>{render(node.children, me)}</u>;
            case 'strike': return <s key={i}>{render(node.children, me)}</s>;
            case 'spoiler': return <Spoiler key={i}>{render(node.children, me)}</Spoiler>;
            case 'mention': return <Mention key={i} identity={node.identity} isMe={node.identity === me} />;
            // A link with its own text shows where it really goes on hover, so the text can't pass for another address.
            case 'link': return (
                <a key={i} className="md-link" href={node.href} title={node.children ? node.href : undefined} target="_blank" rel="noopener noreferrer nofollow">
                    {node.children ? render(node.children, me) : node.href}
                </a>
            );
        }
    });
}

function Spoiler({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    const [shown, setShown] = useState(false);
    return shown
        ? <span className="md-spoiler md-spoiler-shown">{children}</span>
        : (
            <span
                className="md-spoiler"
                role="button"
                tabIndex={0}
                aria-label={t('chat.spoiler')}
                onClick={() => setShown(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShown(true); } }}
            >
                {children}
            </span>
        );
}

/** The person's current name; a mention outlives a rename because it carries the identity. */
function Mention({ identity, isMe }: { identity: string; isMe: boolean }) {
    const { t } = useTranslation();
    const name = usePresence()?.get(identity)?.name;
    return (
        <button
            type="button"
            className={`md-mention${isMe ? ' md-mention-me' : ''}`}
            onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                openProfile({ identity, name: name ?? identity, x: rect.left, y: rect.bottom + 4 });
            }}
        >
            @{name ?? t('chat.unknownPerson')}
        </button>
    );
}
