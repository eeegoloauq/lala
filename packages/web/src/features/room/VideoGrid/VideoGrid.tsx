import { useCallback, useEffect, useRef } from 'react';
import { useTracks, useParticipants, useLocalParticipant, isTrackReference } from '@livekit/components-react';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { Participant } from 'livekit-client';
import { ParticipantTile } from './ParticipantTile';
import { ParticipantContextMenu } from './ParticipantContextMenu';
import { useParticipantContextMenu } from '../hooks/useParticipantContextMenu';
import { useCameraFlip } from '../hooks/useCameraFlip';
import { setScreenShareSubscribed } from '../lib/screenShare';
import { useRoomUIContext } from '../RoomUIContext';
import './video-grid.css';
import { IS_TOUCH as isTouchDevice } from '../../../lib/env';


interface VideoGridProps {
    onFocusTile?: (identity: string) => void;
    onCamEnabled?: (identity: string) => void;
}

const CAMERA_TRACKS = [Track.Source.Camera];

export function VideoGrid({ onFocusTile, onCamEnabled }: VideoGridProps) {
    const { audioMuted, avatarCache } = useRoomUIContext();
    const rawParticipants = useParticipants();
    // Filter out participants that don't have an identity yet (e.g. local participant right before full connection)
    // This prevents the flickering "?" avatar entirely.
    const participants = rawParticipants.filter(p => p.identity);

    const cameraTracks = useTracks(CAMERA_TRACKS);
    const { localParticipant, isCameraEnabled } = useLocalParticipant();
    const { contextMenuProps, openContextMenu, closeContextMenu } = useParticipantContextMenu();
    const prevCamEnabled = useRef(isCameraEnabled);

    // Auto-focus self when camera is turned on
    useEffect(() => {
        if (isCameraEnabled && !prevCamEnabled.current && onCamEnabled) {
            onCamEnabled(localParticipant.identity);
        }
        prevCamEnabled.current = isCameraEnabled;
    }, [isCameraEnabled, localParticipant.identity, onCamEnabled]);

    const handleFlip = useCameraFlip(localParticipant);

    const openMenu = useCallback((participant: Participant, e: React.MouseEvent) => {
        e.preventDefault();
        openContextMenu(participant, e.clientX, e.clientY);
    }, [openContextMenu]);

    const focusTile = useCallback((participant: Participant) => {
        // A screen share hidden from the menu comes back when its owner is focused.
        setScreenShareSubscribed(participant, true);
        onFocusTile?.(participant.identity);
    }, [onFocusTile]);

    const trackMap = new Map<string, TrackReferenceOrPlaceholder>();
    for (const t of cameraTracks) {
        trackMap.set(t.participant.identity, t);
    }

    const count = Math.max(participants.length, 1);

    return (
        <div className="vg-area">
            <div className="vg-grid" data-count={String(Math.min(count, 9))}>
                {participants.map((p) => {
                    const trackRef = trackMap.get(p.identity);
                    const hasActiveVideo =
                        trackRef &&
                        isTrackReference(trackRef) &&
                        trackRef.publication.isSubscribed &&
                        !trackRef.publication.isMuted;
                    const isLocal = p.identity === localParticipant.identity;
                    const canFocus = onFocusTile && (hasActiveVideo || p.isScreenShareEnabled);

                    return (
                        <ParticipantTile
                            key={p.identity}
                            participant={p}
                            trackRef={trackRef}
                            audioMuted={isLocal ? audioMuted : undefined}
                            avatarUrl={avatarCache?.get(p.identity)}
                            // A tap has no right button, so on touch screens it opens the menu.
                            onClick={isTouchDevice ? openMenu : canFocus ? focusTile : undefined}
                            onFlip={isLocal && isTouchDevice ? handleFlip : undefined}
                            onContextMenu={openMenu}
                        />
                    );
                })}
            </div>

            {contextMenuProps && (
                <ParticipantContextMenu {...contextMenuProps} onClose={closeContextMenu} />
            )}
        </div>
    );
}
