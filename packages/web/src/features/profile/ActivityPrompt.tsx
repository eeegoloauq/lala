import { useTranslation } from 'react-i18next';
import { useDetectedActivity } from '../../lib/activity';
import { CrossIcon, GamepadIcon, MusicIcon } from '../room/icons/Icons';
import './activity-prompt.css';

/**
 * The one question before anything the desktop app sees leaves the computer: shown the first
 * time it sees a game or a song, answered once (Settings, Profile changes it later).
 */
export function ActivityPrompt({ onAnswer }: { onAnswer: (choice: 'on' | 'off') => void }) {
    const { t } = useTranslation();
    const detected = useDetectedActivity();
    if (!detected) return null;
    const game = detected.kind === 'playing';
    const what = game ? detected.name : [detected.title, detected.artist].filter(Boolean).join(' · ');
    return (
        <div className="activity-prompt" role="dialog" aria-labelledby="activity-prompt-title">
            <div className="activity-prompt-image">
                {detected.image
                    ? <img src={detected.image} alt="" />
                    : game ? <GamepadIcon size={18} strokeWidth={2} /> : <MusicIcon size={18} strokeWidth={2} />}
            </div>
            <div className="activity-prompt-text">
                <strong id="activity-prompt-title">{t('activityPrompt.title')}</strong>
                <span title={what}>{what}</span>
            </div>
            <button className="activity-prompt-show" onClick={() => onAnswer('on')}>{t('activityPrompt.yes')}</button>
            <button className="activity-prompt-close" onClick={() => onAnswer('off')} title={t('activityPrompt.no')} aria-label={t('activityPrompt.no')}>
                <CrossIcon size={14} strokeWidth={2.2} />
            </button>
        </div>
    );
}
