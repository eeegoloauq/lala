import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDismiss } from '../../hooks/useDismiss';
import { avatarColorForIdentity } from '../../lib/avatarUtils';
import { isBotIdentity } from '../../lib/bots';
import { useMeContext } from '../../lib/meContext';
import { openProfile, useOpenProfile } from '../../lib/profileCard';
import { requestChatDraft, useAvatarForIdentity, useBotDetails } from '../../lib/roomStatusStore';
import { BotBadge, ListensMark } from '../../ui/BotBadge';
import { StatusDot } from '../../ui/StatusDot';
import { useMyStatus, usePresence } from '../../lib/presence';
import { Avatar } from '../room/VideoGrid/Avatar';
import { CheckIcon, CrossIcon, EarIcon, OutIcon } from '../room/icons/Icons';
import { removeBot } from '../../lib/api';
import { errorMessage } from '../../lib/errorMessage';
import type { RoomInfo } from '../../lib/types';
import './profile-card.css';

const WIDTH = 288;
const MARGIN = 12;

/** A shortened identity for people; a bot's is short and readable as is. */
const shortIdentity = (identity: string) =>
    isBotIdentity(identity) || identity.length <= 12 ? identity : `${identity.slice(0, 4)}…${identity.slice(-4)}`;

/** The open profile card, if any; mounted once in App. */
export function ProfileCardHost({ rooms }: { rooms: RoomInfo[] }) {
    const open = useOpenProfile();
    if (!open) return null;
    // The room's creator moderates it; shown here rather than as a mark on every row.
    const room = rooms.find(r => r.participants.some(p => p.identity === open.identity));
    return <ProfileCard key={open.identity} {...open} room={room} roomAdmin={!!room && room.adminIdentity === open.identity} />;
}

const formatTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface ProfileCardProps { identity: string; name: string; x: number; y: number; room?: RoomInfo; roomAdmin: boolean }

function ProfileCard({ identity, name, x, y, room, roomAdmin }: ProfileCardProps) {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);
    const me = useMeContext();
    const liveAvatar = useAvatarForIdentity(identity);
    const bot = useBotDetails(identity);
    const isBot = isBotIdentity(identity);
    const isSelf = me?.identity === identity;
    const presence = usePresence();
    const myStatus = useMyStatus();
    // People only; a bot shows its own status line instead.
    const status = isBot || !presence ? undefined : isSelf ? myStatus : presence.get(identity)?.status ?? (room ? 'online' : undefined);
    const color = avatarColorForIdentity(identity);
    const [position, setPosition] = useState({ left: x, top: y });
    const [removing, setRemoving] = useState(false);
    const [removeError, setRemoveError] = useState<string | null>(null);
    // A bot someone added: they and the room's moderators can take it out again.
    const added = isBot ? room?.addedBots?.find(b => b.identity === identity) : undefined;
    const mayRemove = !!room && !!added && (added.addedBy === me?.identity || room.canModerate);

    const close = () => openProfile(null);
    useDismiss(ref, close);

    // Kept on screen once its height is known.
    useLayoutEffect(() => {
        const height = ref.current?.offsetHeight ?? 0;
        setPosition({
            left: Math.max(MARGIN, Math.min(x, window.innerWidth - WIDTH - MARGIN)),
            top: Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN)),
        });
    }, [x, y, bot, mayRemove]);

    const remove = async () => {
        if (!room) return;
        setRemoving(true);
        setRemoveError(null);
        try {
            await removeBot(room.id, identity.slice('bot-'.length));
            close();
        } catch (err) {
            setRemoveError(errorMessage(t, err));
            setRemoving(false);
        }
    };

    const pickCommand = (command: string) => {
        requestChatDraft(`${command} `);
        close();
    };

    const rights = bot && [
        { kind: bot.speaks ? 'yes' : 'no', text: t(bot.speaks ? 'profile.speaks' : 'profile.noSpeak') },
        { kind: bot.chats ? 'yes' : 'no', text: t(bot.chats ? 'profile.chats' : 'profile.noChat') },
        { kind: bot.listens ? 'warn' : 'no', text: t(bot.listens ? 'profile.listens' : 'profile.noListen') },
        { kind: 'no', text: t('profile.noModerate') },
    ];

    return (
        <div className="profile-card" ref={ref} role="dialog" aria-label={t('profile.title', { name })} style={position}>
            <div className="profile-cover" style={{ '--profile-color': color } as React.CSSProperties} />
            <div className="profile-body">
                <div className="profile-avatar">
                    <Avatar name={name} identity={identity} size={64} avatarUrl={liveAvatar} />
                </div>
                <div>
                    <h3 className="profile-name">
                        <span>{name}</span>
                        {isBot && <BotBadge />}
                        {bot?.listens && <ListensMark />}
                    </h3>
                    <div className="profile-identity" title={identity}>{shortIdentity(identity)}</div>
                    {status && (
                        <div className="profile-presence">
                            <StatusDot status={status} labelled={false} />
                            <span>{room ? t('profile.inRoom', { room: room.displayName }) : t(`status.${status}`)}</span>
                        </div>
                    )}
                </div>
                {(isSelf || roomAdmin) && (
                    <p className="profile-about">
                        {[isSelf && t('profile.thisIsYou'), roomAdmin && t('profile.roomAdmin')].filter(Boolean).join(' ')}
                    </p>
                )}
                {(added || bot?.joinedAt) && (
                    <p className="profile-about">
                        {[added && t('profile.addedBy', { name: added.addedByName }), bot?.joinedAt && t('profile.joinedAt', { time: formatTime(bot.joinedAt) })].filter(Boolean).join(' · ')}
                    </p>
                )}
                {bot?.status && <p className="profile-status">{bot.status}</p>}
                {bot && bot.commands.length > 0 && (
                    <div>
                        <h4 className="profile-label">{t('profile.commands')}</h4>
                        <div className="profile-commands">
                            {bot.commands.map(c => (
                                <button key={c.name} className="profile-command" title={c.description || undefined} onClick={() => pickCommand(c.name)}>
                                    {c.name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {rights && (
                    <div className="profile-rights">
                        <h4 className="profile-label">{t('profile.canDo')}</h4>
                        {rights.map(r => (
                            <div key={r.text} className={`profile-right profile-right-${r.kind}`}>
                                {r.kind === 'yes' ? <CheckIcon size={14} strokeWidth={2.2} /> : r.kind === 'warn' ? <EarIcon size={14} strokeWidth={2} /> : <CrossIcon size={14} strokeWidth={2.2} />}
                                <span>{r.text}</span>
                            </div>
                        ))}
                    </div>
                )}
                {mayRemove && (
                    <button className="profile-remove" onClick={remove} disabled={removing}>
                        <OutIcon size={15} strokeWidth={2} />
                        {t('profile.removeBot')}
                    </button>
                )}
                {removeError && <p className="profile-error">{removeError}</p>}
            </div>
        </div>
    );
}
