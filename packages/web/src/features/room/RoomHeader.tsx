import { useTranslation } from 'react-i18next';
import type { RoomInfo } from '../../lib/types';
import { useLiveParticipants } from '../../lib/roomStatusStore';
import { useCopyInvite } from '../channels/useCopyInvite';
import { EarIcon, LinkIcon, LockIcon } from './icons/Icons';
import './room-header.css';

/**
 * Above the call: the room, how many are in it, whether it is encrypted and which bots
 * can hear it, and the invite link. From the server's room list and the live participants,
 * so the demo gets the same header.
 */
export function RoomHeader({ room }: { room: RoomInfo | undefined }) {
    const { t } = useTranslation();
    const live = useLiveParticipants();
    const { copy, copied } = useCopyInvite();
    if (!room) return <div className="room-header" />;

    const count = live.size > 0 ? live.size : room.numParticipants;
    const listening = room.listeningParticipants
        .map(id => room.participants.find(p => p.identity === id)?.name ?? id);

    return (
        <div className="room-header">
            <h1 className="room-header-name">{room.displayName}</h1>
            <span className="room-header-meta">
                <span>{t('roomHeader.inCall', { count })}</span>
                {room.passwordSalt && (
                    <span className="room-header-flag" title={t('sidebar.passwordProtected')}>
                        <LockIcon size={12} strokeWidth={2.2} />{t('roomHeader.encrypted')}
                    </span>
                )}
                {listening.length > 0 && (
                    <span className="room-header-flag room-header-listens">
                        <EarIcon size={13} strokeWidth={2} />
                        {t('roomHeader.canHear', { names: listening.join(', '), count: listening.length })}
                    </span>
                )}
            </span>
            <button
                className={`room-header-invite${copied === room.id ? ' copied' : ''}`}
                onClick={() => copy(room.id, !!room.passwordSalt)}
            >
                <LinkIcon size={14} strokeWidth={2} />
                <span>{copied === room.id ? t('roomHeader.copied') : t('roomHeader.copyInvite')}</span>
            </button>
        </div>
    );
}
