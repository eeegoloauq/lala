import { useTranslation } from 'react-i18next';
import { EarIcon } from '../features/room/icons/Icons';
import './bot-badge.css';

/** The BOT marker next to a bot's name, everywhere its name is shown. */
export function BotBadge() {
    const { t } = useTranslation();
    return <span className="bot-badge" title={t('bot.badgeTitle')}>{t('bot.badge')}</span>;
}

/** The ear next to a bot that can hear the call. */
export function ListensMark({ size = 12 }: { size?: number }) {
    const { t } = useTranslation();
    return (
        <span className="bot-listens" title={t('bot.listens')} aria-label={t('bot.listens')} role="img">
            <EarIcon size={size} strokeWidth={2} />
        </span>
    );
}
