import { useTranslation } from 'react-i18next';
import { BotBadge } from '../../../ui/BotBadge';
import { SUGGESTIONS_ID, suggestionId, type Suggestion } from './commandSuggestions';

/**
 * The list under the chat box. The textarea keeps focus and drives it as a combobox
 * (arrows, Enter, Tab, Escape in ChatComposer); a native <datalist> can't attach to a
 * textarea or show descriptions, so this one is ours.
 */
export function CommandSuggestions({ items, active, onPick }: { items: Suggestion[]; active: number; onPick: (s: Suggestion) => void }) {
    const { t } = useTranslation();
    return (
        <div className="cp-suggest">
            <div className="cp-suggest-head"><BotBadge />{t('chat.botCommands')}</div>
            <div id={SUGGESTIONS_ID} role="listbox" aria-label={t('chat.botCommands')}>
                {items.map((s, i) => (
                    <div
                        key={`${s.bot}-${s.name}`}
                        id={suggestionId(i)}
                        role="option"
                        aria-selected={i === active}
                        className={`cp-suggest-item${i === active ? ' active' : ''}`}
                        // mousedown keeps the textarea focused.
                        onMouseDown={(e) => { e.preventDefault(); onPick(s); }}
                    >
                        <code>{s.name}</code>
                        <span>{s.description || s.bot}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
