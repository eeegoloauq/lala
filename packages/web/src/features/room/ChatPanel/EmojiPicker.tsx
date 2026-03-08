import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { EMOJI_CATEGORIES, getRecentEmoji, addRecentEmoji } from '../../../lib/emoji';
import './emoji-picker.css';

interface EmojiPickerProps {
    onPick: (emoji: string) => void;
}

export function EmojiPicker({ onPick }: EmojiPickerProps) {
    const { t } = useTranslation();
    const recent = getRecentEmoji();
    const hasRecent = recent.length > 0;
    const scrollRef = useRef<HTMLDivElement>(null);
    const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    const handlePick = (emoji: string) => {
        addRecentEmoji(emoji);
        onPick(emoji);
    };

    const setSectionRef = (id: string) => (el: HTMLDivElement | null) => {
        if (el) sectionRefs.current.set(id, el);
    };

    const scrollTo = (id: string) => {
        const el = sectionRefs.current.get(id);
        if (el && scrollRef.current) {
            scrollRef.current.scrollTo({ top: el.offsetTop - 2, behavior: 'smooth' });
        }
    };

    return (
        <div className="emoji-picker">
            <div className="emoji-scroll" ref={scrollRef}>
                {hasRecent && (
                    <div className="emoji-section" ref={setSectionRef('recent')}>
                        <div className="emoji-section-header">{t('emoji.recent')}</div>
                        <div className="emoji-grid">
                            {recent.map(emoji => (
                                <button key={emoji} className="emoji-btn" onClick={() => handlePick(emoji)}>
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {EMOJI_CATEGORIES.map(cat => (
                    <div key={cat.id} className="emoji-section" ref={setSectionRef(cat.id)}>
                        <div className="emoji-section-header">{cat.label} {cat.id}</div>
                        <div className="emoji-grid">
                            {cat.emoji.map(emoji => (
                                <button key={emoji} className="emoji-btn" onClick={() => handlePick(emoji)}>
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="emoji-nav">
                {hasRecent && (
                    <button className="emoji-nav-btn" onClick={() => scrollTo('recent')} title={t('emoji.recent')}>
                        🕐
                    </button>
                )}
                {EMOJI_CATEGORIES.map(cat => (
                    <button
                        key={cat.id}
                        className="emoji-nav-btn"
                        onClick={() => scrollTo(cat.id)}
                        title={cat.id}
                    >
                        {cat.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
