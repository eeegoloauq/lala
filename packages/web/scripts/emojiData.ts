import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { fetchPinned, type PinnedFile } from './pinned.ts';

/**
 * The emoji picker's list and names, generated at build time from Unicode's own data:
 * the emoji list of Emoji 15.1 (what current systems' emoji fonts draw; newer ones would
 * show as empty boxes) and CLDR's names and search words for each UI language. The app
 * draws them with the system's emoji font, so nothing but text ships.
 *
 * - `virtual:lala-emoji` — the groups, each a list of emoji, and `loadNames(language)`.
 * - `virtual:lala-emoji-names/<language>` — "name\tsearch words" per emoji, loaded with
 *   the picker. A UI language without pinned CLDR files below gets English names.
 *
 * Skin tone variants are left out; the default (yellow) one stands for each.
 */
const CLDR = 'https://raw.githubusercontent.com/unicode-org/cldr-json/44.1.0/cldr-json';
const LIST: PinnedFile = {
    url: 'https://unicode.org/Public/emoji/15.1/emoji-test.txt',
    sha256: 'd876ee249aa28eaa76cfa6dfaa702847a8d13b062aa488d465d0395ee8137ed9',
    cache: 'emoji/emoji-test-15.1.txt',
};
/** Per language: CLDR's annotations (names and words) and derived ones (flags, keycaps, sequences). */
const NAMES: Record<string, [PinnedFile, PinnedFile]> = {
    en: [
        { url: `${CLDR}/cldr-annotations-full/annotations/en/annotations.json`, sha256: 'bfd8b9556a286dee0566f43f2f09c118c3080eae3b4386331528b08fbef119c2', cache: 'emoji/cldr-44.1-en.json' },
        { url: `${CLDR}/cldr-annotations-derived-full/annotationsDerived/en/annotations.json`, sha256: 'df3d0ab1060bca116be8a9f7592942d8f0ffe09f0267074bdaefc1bac9bf9811', cache: 'emoji/cldr-44.1-en-derived.json' },
    ],
    ru: [
        { url: `${CLDR}/cldr-annotations-full/annotations/ru/annotations.json`, sha256: 'b0d588a61b6a0cdc657ffc7daa8a457b41db24d94d03e3d701f8f01e902ef548', cache: 'emoji/cldr-44.1-ru.json' },
        { url: `${CLDR}/cldr-annotations-derived-full/annotationsDerived/ru/annotations.json`, sha256: '3c6e814c4e2986d234b62400647070d468d21ba4475d854c7aedd149595a9f04', cache: 'emoji/cldr-44.1-ru-derived.json' },
    ],
};

/** Unicode's groups, by the id the app's strings use (`emoji.groups.<id>`). */
const GROUPS: Record<string, string> = {
    'Smileys & Emotion': 'smileys',
    'People & Body': 'people',
    'Animals & Nature': 'nature',
    'Food & Drink': 'food',
    'Travel & Places': 'travel',
    'Activities': 'activities',
    'Objects': 'objects',
    'Symbols': 'symbols',
    'Flags': 'flags',
};

const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/u;
const LOCALES = fileURLToPath(new URL('../src/locales/', import.meta.url));
const MAIN_ID = 'virtual:lala-emoji';
const NAMES_ID = 'virtual:lala-emoji-names/';

async function emojiGroups(): Promise<Array<{ id: string; emoji: string[] }>> {
    const groups: Array<{ id: string; emoji: string[] }> = [];
    let current: { id: string; emoji: string[] } | undefined;
    for (const line of (await fetchPinned(LIST)).toString('utf8').split('\n')) {
        const group = /^# group: (.+)$/.exec(line);
        if (group) {
            const id = GROUPS[group[1].trim()];
            current = id ? { id, emoji: [] } : undefined;
            if (current) groups.push(current);
            continue;
        }
        const m = /^[0-9A-F ]+;\s*fully-qualified\s*#\s*(\S+)/.exec(line);
        if (m && current && !SKIN_TONE.test(m[1])) current.emoji.push(m[1]);
    }
    return groups;
}

type Annotations = Record<string, { default?: string[]; tts?: string[] }>;

async function emojiNames(language: string, emoji: string[]): Promise<Record<string, string>> {
    const [main, derived] = await Promise.all(NAMES[language].map(fetchPinned));
    const merged: Annotations = {
        ...JSON.parse(main.toString('utf8')).annotations.annotations,
        ...JSON.parse(derived.toString('utf8')).annotationsDerived.annotations,
    };
    const names: Record<string, string> = {};
    for (const e of emoji) {
        // CLDR mostly writes emoji without the variation selector (U+FE0F).
        const entry = merged[e] ?? merged[e.replace(/\uFE0F/g, '')];
        if (!entry) continue;
        const name = entry.tts?.[0] ?? entry.default?.[0] ?? '';
        const words = (entry.default ?? []).filter(w => w !== name).join(' ');
        names[e] = words ? `${name}\t${words}` : name;
    }
    return names;
}

export function emojiData(): Plugin {
    let groups: ReturnType<typeof emojiGroups> | undefined;
    const getGroups = () => (groups ??= emojiGroups());
    return {
        name: 'lala-emoji-data',
        enforce: 'pre',
        resolveId(source) {
            return source === MAIN_ID || source.startsWith(NAMES_ID) ? `\0${source}` : null;
        },
        async load(id) {
            if (id === `\0${MAIN_ID}`) {
                const uiLanguages = (await readdir(LOCALES) as string[]).filter((f: string) => f.endsWith('.json')).map((f: string) => f.slice(0, -5));
                const withNames = uiLanguages.filter((l: string) => NAMES[l]);
                const cases = withNames.map((l: string) => `        case ${JSON.stringify(l)}: return import(${JSON.stringify(NAMES_ID + l)}).then(m => m.default);`).join('\n');
                return [
                    `export const GROUPS = ${JSON.stringify(await getGroups())};`,
                    'export function loadNames(language) {',
                    '    switch (language) {',
                    cases,
                    `        default: return import(${JSON.stringify(NAMES_ID + 'en')}).then(m => m.default);`,
                    '    }',
                    '}',
                ].join('\n');
            }
            if (id.startsWith(`\0${NAMES_ID}`)) {
                const language = id.slice(NAMES_ID.length + 1);
                if (!NAMES[language]) return 'export default {};';
                const all = (await getGroups()).flatMap(g => g.emoji);
                return `export default ${JSON.stringify(await emojiNames(language, all))};`;
            }
            return null;
        },
    };
}
