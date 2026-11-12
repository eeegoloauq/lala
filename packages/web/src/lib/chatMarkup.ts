/**
 * The formatting chat messages may carry: the part of Markdown that fits chat, as Discord
 * has it. Inline: **bold**, *italic* (or _italic_), __underline__, ~~strikethrough~~,
 * `code`, ||spoilers||, [text](https://link), bare links and `<@identity>` mentions.
 * Lines: `#`/`##`/`###` headings, `-` or `*` and `1.` lists, `> ` quotes and ```code
 * blocks```. Parsed into a tree that ChatText renders as React elements, never as HTML, so
 * a message can't inject markup. Hand-written rather than a Markdown library: those bring
 * images, tables and raw HTML we would have to turn off again, and this set is fixed.
 */

export type MarkupNode =
    | { kind: 'text'; text: string }
    | { kind: 'br' }
    | { kind: 'code'; text: string }
    | { kind: 'codeblock'; text: string }
    | { kind: 'quote'; children: MarkupNode[] }
    | { kind: 'heading'; level: 1 | 2 | 3; children: MarkupNode[] }
    | { kind: 'list'; ordered: boolean; start: number; items: MarkupNode[][] }
    | { kind: 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler'; children: MarkupNode[] }
    | { kind: 'mention'; identity: string }
    | { kind: 'link'; href: string; children?: MarkupNode[] };

type Wrapper = 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler';

const URL_SOURCE = /https?:\/\/[^\s<>]+[^\s<>.,:;"')\]!?]/.source;

// One alternative per inline form; the earliest match wins, longer markers before shorter ones.
const INLINE = new RegExp([
    `\\[(?<label>[^\\]\\n]{1,200})\\]\\((?<target>https?:\\/\\/[^\\s)]+)\\)`,
    /`(?<code>[^`\n]+)`/.source,
    /\*\*(?<bold>.+?)\*\*(?!\*)/.source,
    /__(?<underline>.+?)__(?!_)/.source,
    /~~(?<strike>.+?)~~/.source,
    /\|\|(?<spoiler>.+?)\|\|/.source,
    /\*(?![\s*])(?<italic>.+?)(?<![\s*])\*/.source,
    // Not inside snake_case.
    /(?<![\p{L}\p{N}_])_(?![\s_])(?<italic2>.+?)(?<![\s_])_(?![\p{L}\p{N}_])/u.source,
    /<@(?<mention>[A-Za-z0-9_-]{1,64})>/.source,
    `(?<url>${URL_SOURCE})`,
    /(?<br>\n)/.source,
].join('|'), 'gsu');

const WRAPPERS: Array<[string, Wrapper]> = [['bold', 'bold'], ['underline', 'underline'], ['strike', 'strike'], ['spoiler', 'spoiler'], ['italic', 'italic'], ['italic2', 'italic']];
/** Deeper nesting stays text: nobody formats like that, and it keeps the work bounded. */
const MAX_DEPTH = 6;

function parseInline(text: string, depth = 0): MarkupNode[] {
    if (depth >= MAX_DEPTH) return text ? [{ kind: 'text', text }] : [];
    const nodes: MarkupNode[] = [];
    let last = 0;
    for (const m of text.matchAll(new RegExp(INLINE))) {
        const g = m.groups!;
        if (m.index > last) nodes.push({ kind: 'text', text: text.slice(last, m.index) });
        last = m.index + m[0].length;
        if (g.target !== undefined) nodes.push({ kind: 'link', href: g.target, children: parseInline(g.label, depth + 1) });
        else if (g.code !== undefined) nodes.push({ kind: 'code', text: g.code });
        else if (g.mention !== undefined) nodes.push({ kind: 'mention', identity: g.mention });
        else if (g.url !== undefined) nodes.push({ kind: 'link', href: g.url });
        else if (g.br !== undefined) nodes.push({ kind: 'br' });
        else {
            const [group, kind] = WRAPPERS.find(([name]) => g[name] !== undefined)!;
            nodes.push({ kind, children: parseInline(g[group], depth + 1) });
        }
    }
    if (last < text.length) nodes.push({ kind: 'text', text: text.slice(last) });
    return nodes;
}

type LineKind = 'text' | 'quote' | 'heading' | 'bullet' | 'ordered';

function classify(line: string): { kind: LineKind; body: string; level?: number; number?: number } {
    let m: RegExpExecArray | null;
    if (line === '>' || line.startsWith('> ')) return { kind: 'quote', body: line.slice(2) };
    if ((m = /^(#{1,3}) (.+)$/.exec(line))) return { kind: 'heading', body: m[2], level: m[1].length };
    if ((m = /^\s{0,3}[-*] (.+)$/.exec(line))) return { kind: 'bullet', body: m[1] };
    if ((m = /^\s{0,3}(\d{1,9})[.)] (.+)$/.exec(line))) return { kind: 'ordered', body: m[2], number: Number(m[1]) };
    return { kind: 'text', body: line };
}

/** Each line is text, a quote, a heading or a list item; neighbours of one kind form a block. */
function parseLines(text: string): MarkupNode[] {
    const nodes: MarkupNode[] = [];
    const lines = text.split('\n').map(classify);
    let i = 0;
    while (i < lines.length) {
        const { kind } = lines[i];
        if (kind === 'heading') {
            nodes.push({ kind: 'heading', level: lines[i].level as 1 | 2 | 3, children: parseInline(lines[i].body) });
            i++;
            continue;
        }
        const start = i;
        while (i < lines.length && lines[i].kind === kind) i++;
        const run = lines.slice(start, i);
        if (kind === 'quote') nodes.push({ kind: 'quote', children: parseInline(run.map(l => l.body).join('\n')) });
        else if (kind === 'bullet' || kind === 'ordered') {
            nodes.push({ kind: 'list', ordered: kind === 'ordered', start: run[0].number ?? 1, items: run.map(l => parseInline(l.body)) });
        } else {
            // Blank lines next to a block are its spacing, which the block's own margin gives.
            const bodies = run.map(l => l.body);
            while (bodies.length && !bodies[0].trim() && nodes.length) bodies.shift();
            while (bodies.length && !bodies.at(-1)!.trim() && i < lines.length) bodies.pop();
            if (bodies.length) nodes.push(...parseInline(bodies.join('\n')));
        }
    }
    return nodes;
}

export function parseMarkup(text: string): MarkupNode[] {
    const nodes: MarkupNode[] = [];
    let last = 0;
    for (const m of text.matchAll(/```(?:[\w+-]*\n)?([\s\S]*?)```/g)) {
        const before = text.slice(last, m.index).replace(/\n$/, '');
        if (before) nodes.push(...parseLines(before));
        nodes.push({ kind: 'codeblock', text: m[1].replace(/\n$/, '') });
        last = m.index + m[0].length;
        if (text[last] === '\n') last++;
    }
    const rest = text.slice(last);
    if (rest) nodes.push(...parseLines(rest));
    return nodes;
}

/** The message as one plain line, for a reply's preview: marks removed, mentions by name. */
export function plainText(text: string, nameOf: (identity: string) => string): string {
    const flatten = (nodes: MarkupNode[]): string => nodes.map(n => {
        switch (n.kind) {
            case 'text': case 'code': return n.text;
            case 'codeblock': return ` ${n.text} `;
            case 'br': return ' ';
            case 'mention': return `@${nameOf(n.identity)}`;
            case 'link': return n.children ? flatten(n.children) : n.href;
            case 'list': return ` ${n.items.map(flatten).join(', ')} `;
            case 'heading': case 'quote': return ` ${flatten(n.children)} `;
            case 'spoiler': return '▒▒▒';
            default: return flatten(n.children);
        }
    }).join('');
    return flatten(parseMarkup(text)).replace(/\s+/g, ' ').trim();
}

/** Marks the formatting bar and shortcuts put around a selection. */
export const FORMAT_MARKS = {
    bold: '**',
    italic: '*',
    underline: '__',
    strike: '~~',
    code: '`',
    spoiler: '||',
} as const;

export type FormatKind = keyof typeof FORMAT_MARKS | 'quote';
