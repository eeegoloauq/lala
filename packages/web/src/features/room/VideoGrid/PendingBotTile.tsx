import { useTranslation } from 'react-i18next';
import { Avatar } from './Avatar';
import { BotBadge } from '../../../ui/BotBadge';
import { dismissBot, retryBot, type PendingBot } from '../../../lib/pendingBots';

/** A bot this client added that hasn't joined yet, or didn't. */
export function PendingBotTile({ bot }: { bot: PendingBot }) {
    const { t } = useTranslation();
    if (bot.state === 'failed') {
        return (
            <div className="p-tile p-tile-pending p-tile-failed" role="status">
                <strong>{t('addBot.didntJoin', { name: bot.name })}</strong>
                <div className="p-tile-pending-actions">
                    <button className="btn btn-ghost" onClick={() => retryBot(bot)}>{t('addBot.retry')}</button>
                    <button className="btn btn-ghost" onClick={() => dismissBot(bot)}>{t('addBot.dismiss')}</button>
                </div>
            </div>
        );
    }
    return (
        <div className="p-tile p-tile-pending" aria-label={t('addBot.joining', { name: bot.name })}>
            <div className="p-tile-avatar">
                <Avatar name={bot.name} identity={bot.identity} size="fluid" avatarUrl={bot.avatar} />
            </div>
            <div className="p-tile-meta">
                <span className="p-tile-name">
                    <span className="p-tile-spinner" aria-hidden="true" />
                    <span className="p-tile-name-text">{bot.name}</span>
                    <BotBadge />
                </span>
            </div>
        </div>
    );
}
