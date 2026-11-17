import type { ComponentType } from 'react';
import type { BotCard, BotCardIcon } from '../../../lib/types';
import { ActivityRow } from '../../../ui/ActivityRow';
import { BotIcon, CheckIcon, DiceIcon, NoteIcon, StarIcon } from '../icons/Icons';

const ICONS: Record<Exclude<BotCardIcon, 'music'>, ComponentType<{ size?: number; strokeWidth?: number }>> = {
    bot: BotIcon, note: NoteIcon, star: StarIcon, dice: DiceIcon, check: CheckIcon,
};

/** A bot's reply to a command: an icon from Lala's set, a title and a line. Never edited. */
export function BotCardView({ card }: { card: BotCard }) {
    if (card.icon === 'music') {
        return (
            <div className="cp-card">
                <ActivityRow title={card.title} music>
                    {card.text && <span>{card.text}</span>}
                </ActivityRow>
            </div>
        );
    }
    const Icon = ICONS[card.icon ?? 'bot'];
    return (
        <div className="cp-card">
            <span className="cp-card-icon"><Icon size={18} strokeWidth={2} /></span>
            <span className="cp-card-body">
                <strong>{card.title}</strong>
                {card.text && <small>{card.text}</small>}
            </span>
        </div>
    );
}
