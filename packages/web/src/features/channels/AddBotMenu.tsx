import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getRoomBots } from '../../lib/api';
import { errorMessage } from '../../lib/errorMessage';
import { addBotToRoom } from '../../lib/pendingBots';
import type { RoomBot } from '../../lib/types';
import { useDismiss } from '../../hooks/useDismiss';
import { ListensMark } from '../../ui/BotBadge';
import { Avatar } from '../room/VideoGrid/Avatar';
import { avatarUrl } from '../../lib/avatarUtils';
import { CheckIcon, EarIcon, LockIcon } from '../room/icons/Icons';
// The same themed menu as the room and participant menus; a bottom sheet on phones.
import '../room/VideoGrid/participant-context-menu.css';
import './add-bot-menu.css';

interface AddBotMenuProps {
    roomId: string;
    /** Password rooms can't have bots yet: a bot would need the media key. */
    locked: boolean;
    x: number;
    y: number;
    onClose: () => void;
}

/** The bots this room may have, from "Add bot" under the room's people. */
export function AddBotMenu({ roomId, locked, x, y, onClose }: AddBotMenuProps) {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);
    const [bots, setBots] = useState<RoomBot[] | null>(null);
    const [confirming, setConfirming] = useState<RoomBot | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useDismiss(ref, onClose);

    useEffect(() => {
        let live = true;
        getRoomBots(roomId).then(b => live && setBots(b), err => live && setError(errorMessage(t, err)));
        return () => { live = false; };
    }, [roomId, t]);

    const add = async (bot: RoomBot) => {
        setBusy(true);
        setError(null);
        try {
            await addBotToRoom(roomId, bot);
            onClose();
        } catch (err) {
            setError(errorMessage(t, err));
            setConfirming(null);
            setBusy(false);
        }
    };

    // One that will hear the call asks first.
    const choose = (bot: RoomBot) => (bot.listens ? setConfirming(bot) : add(bot));

    const style: React.CSSProperties = {
        position: 'fixed',
        top: Math.max(8, Math.min(y, window.innerHeight - 280)),
        left: Math.max(8, Math.min(x, window.innerWidth - 260)),
    };

    if (confirming) {
        return (
            <div className="ctx-menu add-bot-menu" style={style} ref={ref} role="dialog" aria-label={t('addBot.confirmTitle', { name: confirming.name })}>
                <div className="add-bot-confirm">
                    <div className="add-bot-confirm-who">
                        <Avatar name={confirming.name} identity={confirming.identity} size={32} avatarUrl={avatarUrl(confirming.identity, confirming.avatar)} />
                        <strong>{t('addBot.confirmTitle', { name: confirming.name })}</strong>
                    </div>
                    <p className="add-bot-warn"><EarIcon size={15} strokeWidth={2} /><span>{t('addBot.confirmListens')}</span></p>
                    <div className="add-bot-actions">
                        <button className="btn btn-ghost" onClick={() => setConfirming(null)} disabled={busy}>{t('addBot.cancel')}</button>
                        <button className="btn btn-primary" onClick={() => add(confirming)} disabled={busy}>{t('addBot.add')}</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="ctx-menu add-bot-menu" style={style} ref={ref} role="dialog" aria-label={t('addBot.title')}>
            <div className="ctx-menu-name">{t('addBot.title')}</div>
            {locked && (
                <div className="add-bot-locked"><LockIcon size={13} strokeWidth={2.2} />{t('addBot.passwordRoom')}</div>
            )}
            {bots === null && !error && <div className="ctx-menu-local-note">{t('addBot.loading')}</div>}
            {bots?.length === 0 && <div className="ctx-menu-local-note">{t('addBot.none')}</div>}
            {bots?.map(bot => {
                const disabled = locked || bot.added || !bot.online || busy;
                return (
                    <button key={bot.key} className="ctx-menu-item add-bot-item" disabled={disabled} onClick={() => choose(bot)}>
                        <Avatar name={bot.name} identity={bot.identity} size={24} avatarUrl={avatarUrl(bot.identity, bot.avatar)} />
                        <span className="add-bot-name">{bot.name}</span>
                        {bot.listens && <ListensMark size={12} />}
                        {bot.added
                            ? <span className="add-bot-state" title={t('addBot.added')}><CheckIcon size={14} strokeWidth={2.2} /></span>
                            : !bot.online && <span className="add-bot-state">{t('addBot.offline')}</span>}
                    </button>
                );
            })}
            {error && <div className="ctx-menu-error">{error}</div>}
        </div>
    );
}
