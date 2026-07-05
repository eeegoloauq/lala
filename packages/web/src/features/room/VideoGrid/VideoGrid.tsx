import { useCallback, useEffect, useRef } from 'react';
import { useTracks, useParticipants, useLocalParticipant, isTrackReference } from '@livekit/components-react';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { Track, RemoteParticipant } from 'livekit-client';
import type { Participant, RemoteTrackPublication } from 'livekit-client';
import { ParticipantTile } from './ParticipantTile';
import { ParticipantContextMenu } from './ParticipantContextMenu';
import { useParticipantContextMenu } from '../hooks/useParticipantContextMenu';
import { useCameraFlip } from '../hooks/useCameraFlip';
import { findTileIdentity } from '../lib/findTileIdentity';
import { useRoomUIContext } from '../RoomUIContext';
import './video-grid.css';
import { IS_TOUCH as isTouchDevice } from '../../../lib/env';


interface VideoGridProps {
    onFocusTile?: (identity: string) => void;
    onCamEnabled?: (identity: string) => void;
}

const CAMERA_TRACKS = [Track.Source.Camera];
const SCREEN_AUDIO_TRACKS = [Track.Source.ScreenShareAudio];

export function VideoGrid({ onFocusTile, onCamEnabled }: VideoGridProps) {
    const { audioMuted, avatarCache } = useRoomUIContext();
    const rawParticipants = useParticipants();
    // Filter out participants that don't have an identity yet (e.g. local participant right before full connection)
    // This prevents the flickering "?" avatar entirely.
    const participants = rawParticipants.filter(p => p.identity);

    const cameraTracks = useTracks(CAMERA_TRACKS);
    const screenAudioTracks = useTracks(SCREEN_AUDIO_TRACKS);
    const { localParticipant, isCameraEnabled } = useLocalParticipant();
    const { contextMenuProps, openContextMenu, closeContextMenu } = useParticipantContextMenu({
        participants,
        screenAudioTracks,
    });
    const prevCamEnabled = useRef(isCameraEnabled);
    const gridRef = useRef<HTMLDivElement>(null);

    // Auto-focus self when camera is turned on
    useEffect(() => {
        if (isCameraEnabled && !prevCamEnabled.current && onCamEnabled) {
            onCamEnabled(localParticipant.identity);
        }
        prevCamEnabled.current = isCameraEnabled;
    }, [isCameraEnabled, localParticipant.identity, onCamEnabled]);

    const handleFlip = useCameraFlip(localParticipant);

    const handleContextMenu = useCallback((e: React.MouseEvent, participant: Participant) => {
        e.preventDefault();
        openContextMenu(participant, e.clientX, e.clientY);
    }, [openContextMenu]);

    // Touch devices: tap opens context menu via event delegation on grid
    const handleGridTap = useCallback((e: React.MouseEvent) => {
        if (!isTouchDevice) return;
        const identity = findTileIdentity(e.target, gridRef.current);
        if (!identity) return;
        const p = participants.find(p => p.identity === identity);
        if (p) openContextMenu(p, e.clientX, e.clientY);
    }, [participants, openContextMenu]);

    const handleTileClick = useCallback((identity: string) => {
        const p = participants.find(p => p.identity === identity);
        if (!p || !onFocusTile) return;
        if (p instanceof RemoteParticipant) {
            const screenPub = p.getTrackPublication(Track.Source.ScreenShare) as RemoteTrackPublication | undefined;
            const audioPub = p.getTrackPublication(Track.Source.ScreenShareAudio) as RemoteTrackPublication | undefined;
            if (screenPub && !screenPub.isSubscribed) screenPub.setSubscribed(true);
            if (audioPub && !audioPub.isSubscribed) audioPub.setSubscribed(true);
        }
        onFocusTile(identity);
    }, [participants, onFocusTile]);

    const trackMap = new Map<string, TrackReferenceOrPlaceholder>();
    for (const t of cameraTracks) {
        trackMap.set(t.participant.identity, t);
    }

    const count = Math.max(participants.length, 1);

    return (
        <div className="vg-area">
            <div
                className="vg-grid"
                data-count={String(Math.min(count, 9))}
                ref={gridRef}
                onClick={isTouchDevice ? handleGridTap : undefined}
            >
                {participants.map((p) => {
                    const trackRef = trackMap.get(p.identity);
                    const hasActiveVideo =
                        trackRef &&
                        isTrackReference(trackRef) &&
                        trackRef.publication.isSubscribed &&
                        !trackRef.publication.isMuted;

                    const hasScreenPub = p.isScreenShareEnabled;
                    const isLocal = p.identity === localParticipant.identity;

                    return (
                        <ParticipantTile
                            key={p.identity}
                            participant={p}
                            trackRef={trackRef}
                            audioMuted={isLocal ? audioMuted : undefined}
                            avatarUrl={avatarCache?.get(p.identity)}
                            onClick={!isTouchDevice && onFocusTile && (hasActiveVideo || hasScreenPub) ? handleTileClick : undefined}
                            onFlip={isLocal && isTouchDevice ? handleFlip : undefined}
                            onContextMenu={(e) => handleContextMenu(e, p)}
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
