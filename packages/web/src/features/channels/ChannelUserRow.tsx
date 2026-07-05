import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { AvatarBadge } from '../../ui/AvatarBadge';
import { getCachedAvatar, avatarColorForIdentity } from '../../lib/avatarUtils';
import { MicOffIcon, SpeakerOffIcon, ScreenShareStatusIcon } from '../room/icons/Icons';
import { useIsSpeaking, useIsMutedInRoom, useIsDeafenedInRoom, useAvatarForIdentity } from '../../lib/roomStatusStore';

export interface ChannelUserRowProps {
    identity: string;
    name: string;
    roomId: string;
    /** Whether `roomId` is the room this client is currently connected to — gates
     *  whether we trust the live (store-backed) mute/deafen state or fall back to
     *  the last known SSE snapshot for a room we're not in. */
    isActiveRoom: boolean;
    isSelf: boolean;
    isRoomAdmin: boolean;
    /** Server-side (admin) mic mute — always from the SSE room snapshot, not store. */
    serverMuted: boolean;
    /** Fallback mute/deafen state from the SSE room snapshot (used for rooms we
     *  aren't currently connected to, where the live store has nothing for us). */
    staticMuted: boolean;
    staticDeafened: boolean;
    isScreenSharing: boolean;
    onContextMenu: (e: React.MouseEvent) => void;
}

/**
 * A single participant row in ChannelSidebar's room list. Split out from the parent
 * so each row can subscribe individually to the room-status store's per-identity
 * selectors (lib/roomStatusStore.ts) — a speaking/mute/deafen change for ONE
 * participant now only re-renders THEIR row, not the whole sidebar (previously an
 * ActiveSpeakersChanged event re-rendered all of App -> ChannelSidebar -> RoomView
 * -> RoomShell for a single avatar dot).
 */
export const ChannelUserRow = memo(function ChannelUserRow({
    identity,
    name,
    roomId,
    isActiveRoom,
    isSelf,
    isRoomAdmin,
    serverMuted,
    staticMuted,
    staticDeafened,
    isScreenSharing,
    onContextMenu,
}: ChannelUserRowProps) {
    const { t } = useTranslation();
    const speaking = useIsSpeaking(identity);
    const liveMuted = useIsMutedInRoom(identity);
    const liveDeafened = useIsDeafenedInRoom(identity);
    const liveAvatar = useAvatarForIdentity(identity);

    const isMuted = isActiveRoom ? liveMuted : staticMuted;
    const isDeafened = isActiveRoom ? liveDeafened : staticDeafened;
    const avatarUrl = liveAvatar || getCachedAvatar(identity, name) || undefined;

    return (
        <div
            className="channel-user-card"
            data-participant-identity={identity}
            data-participant-name={name}
            data-participant-room={roomId}
            onContextMenu={onContextMenu}
        >
            <AvatarBadge
                topCrown={isRoomAdmin ? (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="#f59e0b" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,1))' }}>
                        <path d="M2 19l2-9 5 4 3-8 3 8 5-4 2 9H2z" />
                    </svg>
                ) : undefined}
            >
                <div
                    className={`channel-user-avatar${speaking ? ' speaking' : ''}`}
                    style={{ background: avatarUrl ? 'transparent' : avatarColorForIdentity(identity) }}
                >
                    {avatarUrl ? (
                        <img src={avatarUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} draggable={false} />
                    ) : (
                        name[0]?.toUpperCase() ?? '?'
                    )}
                </div>
            </AvatarBadge>
            <span className="channel-user-name">{name}</span>
            {isSelf && (
                <span className="channel-user-you">{t('sidebar.you')}</span>
            )}
            <span className="channel-user-indicators">
                {(isMuted || serverMuted) ? (
                    <span className={`channel-user-indicator${serverMuted ? ' server-muted' : ''}`} title={serverMuted ? t('tile.serverMuted') : t('sidebar.micOff')}><MicOffIcon /></span>
                ) : null}
                {isDeafened && (
                    <span className="channel-user-indicator" title={t('sidebar.soundOff')}><SpeakerOffIcon /></span>
                )}
            </span>
            {isScreenSharing && (
                <span className="channel-user-stream" title={t('sidebar.streaming')}>
                    <ScreenShareStatusIcon size={11} />
                </span>
            )}
        </div>
    );
});
