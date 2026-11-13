import { useTranslation } from 'react-i18next';
import { useDetectedActivity } from '../../lib/activity';
import { GamepadIcon, MusicIcon } from '../room/icons/Icons';
import './activity-prompt.css';

/**
 * The one question before anything the desktop app sees leaves the computer: shown the first
 * time it sees a game or a song, answered once (Settings, Profile changes it later).
 */
export function ActivityPrompt({ onAnswer }: { onAnswer: (choice: 'on' | 'off') => void }) {
    const { t } = useTranslation();
    const detected = useDetectedActivity();
    if (!detected) return null;
    const what = detected.kind === 'playing' ? detected.name : detected.title;
    return (
        <div className="activity-prompt" role="dialog" aria-labelledby="activity-prompt-title">
            <div className="activity-prompt-head">
                <span className="activity-prompt-icon">
                    {detected.kind === 'playing' ? <GamepadIcon size={18} strokeWidth={2} /> : <MusicIcon size={17} strokeWidth={2} />}
                </span>
                <h3 id="activity-prompt-title">{t('activityPrompt.title')}</h3>
            </div>
            <p>{t(detected.kind === 'playing' ? 'activityPrompt.seenGame' : 'activityPrompt.seenSong', { what })}</p>
            <p className="activity-prompt-note">{t('activityPrompt.note')}</p>
            <div className="activity-prompt-actions">
                <button className="btn" onClick={() => onAnswer('off')}>{t('activityPrompt.no')}</button>
                <button className="btn btn-primary" onClick={() => onAnswer('on')} autoFocus>{t('activityPrompt.yes')}</button>
            </div>
        </div>
    );
}
