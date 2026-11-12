import { useCallback, useState } from 'react';
import { RemoteParticipant, Track } from 'livekit-client';
import type { Participant, RemoteTrackPublication } from 'livekit-client';
import type { ParticipantContextMenuProps } from '../VideoGrid/ParticipantContextMenu';
import { useRoomUIContext } from '../RoomUIContext';
import { canSpeak, hasAttribute } from '../lib/permissions';
import { isServerMutedInRoom } from '../../../lib/roomStatusStore';
import { setScreenShareSubscribed } from '../lib/screenShare';
import { isBotIdentity } from '../../../lib/bots';
import { openProfile } from '../../../lib/profileCard';

/**
 * Admin-action wiring shared by VideoGrid and FocusLayout: both accept identity-scoped
 * kick/ban/mute callbacks and let this hook bind them to the currently open menu's identity.
 */
export interface ParticipantAdminActions {
    roomId: string;
    onKick: (identity: string) => Promise<void>;
    onBan: (identity: string) => Promise<void>;
    onToggleMute: (identity: string, serverMuted: boolean) => Promise<void>;
    onToggleVoice: (identity: string, voiced: boolean) => Promise<void>;
    /** Server admins only. */
    onServerBan?: (identity: string) => Promise<void>;
}

interface ContextMenuState {
    participant: Participant;
    hasScreenAudio: boolean;
    screenSharePub?: RemoteTrackPublication;
    serverMuted: boolean;
    voiced: boolean;
    canBeVoiced: boolean;
    x: number;
    y: number;
}

/**
 * Owns context-menu state and builds the props for `<ParticipantContextMenu>` (volumes,
 * hide screen share, admin actions bound to the participant), so VideoGrid and FocusLayout
 * behave the same. `openContextMenu` is stable, so tiles can take it without re-rendering.
 */
export function useParticipantContextMenu() {
    const { volumes, onVolumeChange, screenVolumes, onScreenVolumeChange, admin, onOpenSettings } = useRoomUIContext();
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    const openContextMenu = useCallback((participant: Participant, x: number, y: number) => {
        const screenAudio = participant.getTrackPublication(Track.Source.ScreenShareAudio);
        setContextMenu({
            participant,
            hasScreenAudio: !!screenAudio?.isSubscribed && !screenAudio.isMuted,
            screenSharePub: participant instanceof RemoteParticipant
                ? participant.getTrackPublication(Track.Source.ScreenShare)
                : undefined,
            serverMuted: isServerMutedInRoom(participant.identity),
            voiced: hasAttribute(participant, 'lala.voice'),
            // Someone who may not speak by right, and hasn't been muted, can be given the floor.
            // Not a bot: the server config decides whether it speaks.
            canBeVoiced: !isBotIdentity(participant.identity) && !canSpeak(participant) && !isServerMutedInRoom(participant.identity),
            x,
            y,
        });
    }, []);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    let contextMenuProps: Omit<ParticipantContextMenuProps, 'onClose'> | null = null;
    if (contextMenu) {
        const { participant, screenSharePub } = contextMenu;
        const identity = participant.identity;
        const isRemote = participant instanceof RemoteParticipant;
        contextMenuProps = {
            identity,
            name: participant.name || identity,
            isRemote,
            x: contextMenu.x,
            y: contextMenu.y,
            volume: volumes.get(identity) ?? 50,
            onVolumeChange: (vol) => onVolumeChange(identity, vol),
            screenVolume: contextMenu.hasScreenAudio ? (screenVolumes.get(identity) ?? 100) : undefined,
            onScreenVolumeChange: contextMenu.hasScreenAudio ? (vol) => onScreenVolumeChange(identity, vol) : undefined,
            admin: admin && isRemote ? {
                roomId: admin.roomId,
                serverMuted: contextMenu.serverMuted,
                onKick: () => admin.onKick(identity),
                onBan: () => admin.onBan(identity),
                onToggleMute: () => admin.onToggleMute(identity, contextMenu.serverMuted),
                onServerBan: admin.onServerBan && (() => admin.onServerBan!(identity)),
                voice: contextMenu.voiced ? 'take' : contextMenu.canBeVoiced ? 'give' : undefined,
                onToggleVoice: () => admin.onToggleVoice(identity, contextMenu.voiced),
            } : undefined,
            screenShareHidden: !!screenSharePub && !screenSharePub.isSubscribed,
            onToggleScreenShare: screenSharePub && (() => setScreenShareSubscribed(participant, !screenSharePub.isSubscribed)),
            onOpenSettings,
            onOpenProfile: () => openProfile({ identity, name: participant.name || identity, x: contextMenu.x, y: contextMenu.y }),
        };
    }

    return { openContextMenu, closeContextMenu, contextMenuProps };
}
