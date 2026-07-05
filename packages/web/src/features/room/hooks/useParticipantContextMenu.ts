import { useCallback, useState } from 'react';
import { isTrackReference } from '@livekit/components-react';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { RemoteParticipant, Track } from 'livekit-client';
import type { Participant, RemoteTrackPublication } from 'livekit-client';
import type { AdminActions, ParticipantContextMenuProps } from '../VideoGrid/ParticipantContextMenu';

/**
 * Admin-action wiring shared by VideoGrid and FocusLayout: both accept identity-scoped
 * kick/ban/mute callbacks and let this hook bind them to the currently open menu's identity.
 */
export type ParticipantAdminActions = Omit<AdminActions, 'serverMuted' | 'onKick' | 'onBan' | 'onToggleMute'> & {
    onKick: (identity: string) => void;
    onBan: (identity: string) => void;
    onToggleMute: (identity: string, serverMuted: boolean) => void;
};

export interface ContextMenuState {
    identity: string;
    name: string;
    isRemote: boolean;
    hasScreenAudio: boolean;
    hasScreenSharePub: boolean;
    screenShareHidden: boolean;
    serverMuted: boolean;
    x: number;
    y: number;
}

export interface UseParticipantContextMenuOptions {
    /** Current participant list, used to resolve an identity string to a Participant. */
    participants: Participant[];
    /** Screen-share-audio track refs (from `useTracks([Track.Source.ScreenShareAudio])`). */
    screenAudioTracks: TrackReferenceOrPlaceholder[];
    volumes: Map<string, number>;
    onVolumeChange: (identity: string, vol: number) => void;
    screenVolumes: Map<string, number>;
    onScreenVolumeChange: (identity: string, vol: number) => void;
    admin?: ParticipantAdminActions;
    onOpenSettings?: () => void;
}

export interface UseParticipantContextMenuResult {
    contextMenu: ContextMenuState | null;
    /** Opens the context menu for a participant (object or identity string) at the given screen coordinates. */
    openContextMenu: (participantOrIdentity: Participant | string, x: number, y: number) => void;
    closeContextMenu: () => void;
    /** Fully resolved props ready to spread onto `<ParticipantContextMenu>`; null while closed. */
    contextMenuProps: Omit<ParticipantContextMenuProps, 'onClose'> | null;
}

/**
 * Owns context-menu state plus the participant/track lookups needed to populate it
 * (screen-audio detection, screen-share-pub visibility, server-mute, admin action binding).
 * Shared between VideoGrid and FocusLayout so both layouts render `<ParticipantContextMenu>`
 * with identical placement/volume/admin/hide-screen-share behavior.
 */
export function useParticipantContextMenu({
    participants,
    screenAudioTracks,
    volumes,
    onVolumeChange,
    screenVolumes,
    onScreenVolumeChange,
    admin,
    onOpenSettings,
}: UseParticipantContextMenuOptions): UseParticipantContextMenuResult {
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    const openContextMenu = useCallback((participantOrIdentity: Participant | string, x: number, y: number) => {
        const participant = typeof participantOrIdentity === 'string'
            ? participants.find((p) => p.identity === participantOrIdentity)
            : participantOrIdentity;
        if (!participant) return;

        const hasScreenAudio = screenAudioTracks.some(
            (t: TrackReferenceOrPlaceholder) => isTrackReference(t) && t.participant.identity === participant.identity && t.publication.isSubscribed && !t.publication.isMuted
        );
        const screenPub = participant instanceof RemoteParticipant
            ? participant.getTrackPublication(Track.Source.ScreenShare) as RemoteTrackPublication | undefined
            : undefined;

        setContextMenu({
            identity: participant.identity,
            name: participant.name || participant.identity,
            isRemote: participant instanceof RemoteParticipant,
            hasScreenAudio,
            hasScreenSharePub: !!screenPub,
            screenShareHidden: !!screenPub && !screenPub.isSubscribed,
            serverMuted: participant.permissions?.canPublish === false,
            x,
            y,
        });
    }, [participants, screenAudioTracks]);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    let contextMenuProps: Omit<ParticipantContextMenuProps, 'onClose'> | null = null;
    if (contextMenu) {
        const identity = contextMenu.identity;
        contextMenuProps = {
            identity,
            name: contextMenu.name,
            isRemote: contextMenu.isRemote,
            x: contextMenu.x,
            y: contextMenu.y,
            volume: volumes.get(identity) ?? 50,
            onVolumeChange: (vol) => onVolumeChange(identity, vol),
            screenVolume: contextMenu.hasScreenAudio ? (screenVolumes.get(identity) ?? 100) : undefined,
            onScreenVolumeChange: contextMenu.hasScreenAudio ? (vol) => onScreenVolumeChange(identity, vol) : undefined,
            admin: admin && contextMenu.isRemote ? {
                adminSecret: admin.adminSecret,
                roomId: admin.roomId,
                serverMuted: contextMenu.serverMuted,
                onKick: () => admin.onKick(identity),
                onBan: () => admin.onBan(identity),
                onToggleMute: () => admin.onToggleMute(identity, contextMenu.serverMuted),
            } : undefined,
            screenShareHidden: contextMenu.screenShareHidden,
            onToggleScreenShare: contextMenu.hasScreenSharePub ? () => {
                const p = participants.find((p) => p.identity === identity);
                if (!(p instanceof RemoteParticipant)) return;
                const pub = p.getTrackPublication(Track.Source.ScreenShare) as RemoteTrackPublication | undefined;
                const audioPub = p.getTrackPublication(Track.Source.ScreenShareAudio) as RemoteTrackPublication | undefined;
                const newSub = !pub?.isSubscribed;
                if (pub) pub.setSubscribed(newSub);
                if (audioPub) audioPub.setSubscribed(newSub);
            } : undefined,
            onOpenSettings,
        };
    }

    return { contextMenu, openContextMenu, closeContextMenu, contextMenuProps };
}
