import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GROUPS, loadNames } from 'virtual:lala-emoji';
import { getRecentEmoji, addRecentEmoji } from '../../../lib/emoji';
import './emoji-picker.css';

interface EmojiPickerProps {
    onPick: (emoji: string) => void;
}

/** The group's button in the bar: a clear example, not just its first emoji (glasses for objects). */
const GROUP_ICON: Record<string, string> = {
    smileys: '😀', people: '👋', nature: '🐶', food: '🍕', travel: '🚗',
    activities: '⚽', objects: '💡', symbols: '❤️', flags: '🏁',
};

/** Search shows this many at most: enough to pick from, few enough to draw at once. */
const MAX_RESULTS = 160;

/**
 * Windows' emoji font has no flags: it draws the two letters instead. Drawn once to a
 * canvas to see whether a flag comes out in colour; where it doesn't, the group is left out.
 */
let flagsDrawable: boolean | undefined;
function canDrawFlags(): boolean {
    if (flagsDrawable !== undefined) return flagsDrawable;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 24;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return (flagsDrawable = true);
    g.font = '20px sans-serif';
    g.textBaseline = 'top';
    g.fillText('🇩🇪', 0, 0);
    const px = g.getImageData(0, 0, 24, 24).data;
    flagsDrawable = false;
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] > 0 && Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) > 60) {
            flagsDrawable = true;
            break;
        }
    }
    return flagsDrawable;
}

/** Names come with the picker, in the app's language, with English beside it so search always finds something. */
function useEmojiNames(language: string) {
    const [names, setNames] = useState<{ local: Record<string, string>; en: Record<string, string> } | null>(null);
    useEffect(() => {
        let active = true;
        Promise.all([loadNames(language), language === 'en' ? null : loadNames('en')]).then(([local, en]) => {
            if (active) setNames({ local, en: en ?? local });
        });
        return () => { active = false; };
    }, [language]);
    return names;
}

/**
 * Every emoji of Unicode's list, drawn with the system's emoji font, in Unicode's groups,
 * with search by name in the app's language (and English). See scripts/emojiData.ts.
 */
export function EmojiPicker({ onPick }: EmojiPickerProps) {
    const { t, i18n } = useTranslation();
    // Read at open; the list on screen stays put while picking, so it doesn't shift under the pointer.
    const [recent] = useState(getRecentEmoji);
    const [query, setQuery] = useState('');
    const names = useEmojiNames(i18n.resolvedLanguage ?? 'en');
    const scrollRef = useRef<HTMLDivElement>(null);
    const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const groups = useMemo(() => GROUPS.filter(g => g.id !== 'flags' || canDrawFlags()), []);

    const nameOf = (emoji: string) => (names?.local[emoji] ?? names?.en[emoji])?.split('\t')[0];

    const results = useMemo(() => {
        const q = query.trim().toLocaleLowerCase();
        if (!q || !names) return null;
        const out: string[] = [];
        for (const g of groups) {
            for (const e of g.emoji) {
                if (names.local[e]?.toLocaleLowerCase().includes(q) || names.en[e]?.toLowerCase().includes(q)) out.push(e);
                if (out.length >= MAX_RESULTS) return out;
            }
        }
        return out;
    }, [query, names, groups]);

    const handlePick = (emoji: string) => {
        addRecentEmoji(emoji);
        onPick(emoji);
    };

    const setSectionRef = (id: string) => (el: HTMLDivElement | null) => {
        if (el) sectionRefs.current.set(id, el);
    };

    const scrollTo = (id: string) => {
        const el = sectionRefs.current.get(id);
        if (el && scrollRef.current) scrollRef.current.scrollTo({ top: el.offsetTop - 2, behavior: 'smooth' });
    };

    const button = (emoji: string) => {
        const name = nameOf(emoji);
        return (
            <button key={emoji} type="button" className="emoji-btn" onClick={() => handlePick(emoji)} title={name} aria-label={name ?? emoji}>
                {emoji}
            </button>
        );
    };

    return (
        <div className="emoji-picker">
            <div className="emoji-search">
                <input
                    className="emoji-search-input"
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder={t('emoji.search')}
                    aria-label={t('emoji.search')}
                    autoFocus
                />
            </div>
            <div className="emoji-scroll" ref={scrollRef}>
                {results ? (
                    results.length
                        ? <div className="emoji-grid emoji-results">{results.map(button)}</div>
                        : <p className="emoji-none">{t('emoji.none')}</p>
                ) : (<>
                    {recent.length > 0 && (
                        <div className="emoji-section" ref={setSectionRef('recent')}>
                            <div className="emoji-section-header">{t('emoji.recent')}</div>
                            <div className="emoji-grid">{recent.map(button)}</div>
                        </div>
                    )}
                    {groups.map(g => (
                        <div key={g.id} className="emoji-section" ref={setSectionRef(g.id)}>
                            <div className="emoji-section-header">{t(`emoji.groups.${g.id}`)}</div>
                            <div className="emoji-grid">{g.emoji.map(button)}</div>
                        </div>
                    ))}
                </>)}
            </div>

            {!results && (
                <div className="emoji-nav">
                    {recent.length > 0 && (
                        <button type="button" className="emoji-nav-btn" onClick={() => scrollTo('recent')} title={t('emoji.recent')} aria-label={t('emoji.recent')}>
                            🕐
                        </button>
                    )}
                    {groups.map(g => (
                        <button key={g.id} type="button" className="emoji-nav-btn" onClick={() => scrollTo(g.id)} title={t(`emoji.groups.${g.id}`)} aria-label={t(`emoji.groups.${g.id}`)}>
                            {GROUP_ICON[g.id] ?? g.emoji[0]}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
