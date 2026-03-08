import { useState, useCallback, useEffect, useRef } from 'react';
import { useTracks, useParticipants, useLocalParticipant, isTrackReference } from '@livekit/components-react';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { Track, RemoteParticipant } from 'livekit-client';
import type { LocalVideoTrack, Participant, RemoteTrackPublication } from 'livekit-client';
import { ParticipantTile } from './ParticipantTile';
import { ParticipantContextMenu } from './ParticipantContextMenu';
import type { AdminActions } from './ParticipantContextMenu';
import './video-grid.css';

const isTouchDevice = typeof window !== 'undefined' && navigator.maxTouchPoints > 0;

/** Walk up the DOM from target to find the nearest element with data-identity. */
function findTileIdentity(target: EventTarget | null, container: HTMLElement | null): string | null {
    let el = target as HTMLElement | null;
    while (el && el !== container) {
        if (el.dataset.identity) return el.dataset.identity;
        el = el.parentElement;
    }
    return null;
}

interface VideoGridProps {
    onFocusTile?: (identity: string) => void;
    onCamEnabled?: (identity: string) => void;
    audioMuted?: boolean;
    avatarCache?: Map<string, string>;
    volumes: Map<string, number>;
    onVolumeChange: (identity: string, vol: number) => void;
    screenVolumes: Map<string, number>;
    onScreenVolumeChange: (identity: string, vol: number) => void;
    onOpenSettings?: () => void;
    admin?: Omit<AdminActions, 'serverMuted' | 'onKick' | 'onBan' | 'onToggleMute'> & {
        onKick: (identity: string) => void;
        onBan: (identity: string) => void;
        onToggleMute: (identity: string, serverMuted: boolean) => void;
    };
}

interface ContextMenuState {
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

const CAMERA_TRACKS = [Track.Source.Camera];
const SCREEN_AUDIO_TRACKS = [Track.Source.ScreenShareAudio];

export function VideoGrid({ onFocusTile, onCamEnabled, audioMuted, avatarCache, volumes, onVolumeChange, screenVolumes, onScreenVolumeChange, admin, onOpenSettings }: VideoGridProps) {
    const rawParticipants = useParticipants();
    // Filter out participants that don't have an identity yet (e.g. local participant right before full connection)
    // This prevents the flickering "?" avatar entirely.
    const participants = rawParticipants.filter(p => p.identity);

    const cameraTracks = useTracks(CAMERA_TRACKS);
    const screenAudioTracks = useTracks(SCREEN_AUDIO_TRACKS);
    const { localParticipant, isCameraEnabled } = useLocalParticipant();
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
    const prevCamEnabled = useRef(isCameraEnabled);
    const gridRef = useRef<HTMLDivElement>(null);

    // Auto-focus self when camera is turned on
    useEffect(() => {
        if (isCameraEnabled && !prevCamEnabled.current && onCamEnabled) {
            onCamEnabled(localParticipant.identity);
        }
        prevCamEnabled.current = isCameraEnabled;
    }, [isCameraEnabled, localParticipant.identity, onCamEnabled]);

    const handleFlip = useCallback(async () => {
        const next: 'user' | 'environment' = facingMode === 'user' ? 'environment' : 'user';
        setFacingMode(next);
        const pub = localParticipant.getTrackPublication(Track.Source.Camera);
        const track = pub?.track as LocalVideoTrack | undefined;
        if (track) await track.restartTrack({ facingMode: next });
    }, [facingMode, localParticipant]);

    /** Opens context menu for a participant at given coordinates. */
    const openContextMenu = useCallback((participant: Participant, x: number, y: number) => {
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
    }, []);

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

            {contextMenu && (
                <ParticipantContextMenu
                    identity={contextMenu.identity}
                    name={contextMenu.name}
                    isRemote={contextMenu.isRemote}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    volume={volumes.get(contextMenu.identity) ?? 50}
                    onVolumeChange={(vol) => onVolumeChange(contextMenu.identity, vol)}
                    screenVolume={contextMenu.hasScreenAudio ? (screenVolumes.get(contextMenu.identity) ?? 100) : undefined}
                    onScreenVolumeChange={contextMenu.hasScreenAudio ? (vol) => onScreenVolumeChange(contextMenu.identity, vol) : undefined}
                    admin={admin && contextMenu.isRemote ? {
                        adminSecret: admin.adminSecret,
                        roomId: admin.roomId,
                        serverMuted: contextMenu.serverMuted,
                        onKick: () => admin.onKick(contextMenu.identity),
                        onBan: () => admin.onBan(contextMenu.identity),
                        onToggleMute: () => admin.onToggleMute(contextMenu.identity, contextMenu.serverMuted),
                    } : undefined}
                    screenShareHidden={contextMenu.screenShareHidden}
                    onToggleScreenShare={contextMenu.hasScreenSharePub ? () => {
                        const p = participants.find(p => p.identity === contextMenu.identity);
                        if (!(p instanceof RemoteParticipant)) return;
                        const pub = p.getTrackPublication(Track.Source.ScreenShare) as RemoteTrackPublication | undefined;
                        const audioPub = p.getTrackPublication(Track.Source.ScreenShareAudio) as RemoteTrackPublication | undefined;
                        const newSub = !pub?.isSubscribed;
                        if (pub) pub.setSubscribed(newSub);
                        if (audioPub) audioPub.setSubscribed(newSub);
                    } : undefined}
                    onOpenSettings={onOpenSettings}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}
