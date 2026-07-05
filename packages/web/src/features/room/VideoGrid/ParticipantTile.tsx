import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { VideoTrack, useIsSpeaking } from '@livekit/components-react';
import type { TrackReference, TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { isTrackReference } from '@livekit/components-react';
import { RemoteParticipant } from 'livekit-client';
import type { Participant } from 'livekit-client';
import { ConnectionQuality, ParticipantEvent } from 'livekit-client';
import { Avatar } from './Avatar';
import { MicOffIcon, SpeakerOffIcon, ScreenShareStatusIcon } from '../icons/Icons';
import { useConnectionQuality } from '../hooks/useConnectionQuality';
import { useParticipantState } from '../hooks/useParticipantState';
import { readDeafened } from '../lib/participantMeta';

interface ParticipantTileProps {
    participant: Participant;
    trackRef?: TrackReferenceOrPlaceholder;
    audioMuted?: boolean;  // local deafen state (only meaningful for local participant)
    avatarUrl?: string;
    onClick?: (identity: string) => void;
    onFlip?: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
}

const QUALITY_LABEL_KEY: Record<string, string> = {
    excellent: 'tile.qualityExcellent',
    good: 'tile.qualityGood',
    poor: 'tile.qualityPoor',
};

const MIC_MUTED_EVENTS = [
    ParticipantEvent.TrackMuted,
    ParticipantEvent.TrackUnmuted,
    ParticipantEvent.TrackPublished,
    ParticipantEvent.TrackUnpublished,
    ParticipantEvent.LocalTrackPublished,
    ParticipantEvent.LocalTrackUnpublished,
];

/** Reactively tracks mic mute state by subscribing to participant events. */
function useMicMuted(participant: Participant): boolean {
    return useParticipantState(participant, MIC_MUTED_EVENTS, (p) => !p.isMicrophoneEnabled);
}

/** Reads deafen state from participant metadata, reactively. */
function useIsDeafenedFromMeta(participant: Participant): boolean {
    return useParticipantState(
        participant,
        [ParticipantEvent.ParticipantMetadataChanged],
        (p) => readDeafened(p.metadata),
    );
}

/** Detects server-muted state (admin mute = canPublish revoked). */
function useIsServerMuted(participant: Participant): boolean {
    return useParticipantState(
        participant,
        [ParticipantEvent.ParticipantPermissionsChanged],
        (p) => p.permissions?.canPublish === false,
    );
}

/** Reactively tracks screen share state. */
function useIsScreenSharing(participant: Participant): boolean {
    const events = participant instanceof RemoteParticipant
        ? [ParticipantEvent.TrackPublished, ParticipantEvent.TrackUnpublished]
        : [ParticipantEvent.LocalTrackPublished, ParticipantEvent.LocalTrackUnpublished];
    return useParticipantState(participant, events, (p) => p.isScreenShareEnabled);
}

export const ParticipantTile = memo(function ParticipantTile({ participant, trackRef, audioMuted, avatarUrl, onClick, onFlip, onContextMenu }: ParticipantTileProps) {
    const { t } = useTranslation();
    const isSpeaking = useIsSpeaking(participant);
    const quality = useConnectionQuality(participant);
    const micMuted = useMicMuted(participant);
    const deafenedFromMeta = useIsDeafenedFromMeta(participant);
    const isScreenSharing = useIsScreenSharing(participant);
    const isServerMuted = useIsServerMuted(participant);
    // For local participant use the prop (immediate, no SSE delay); for remote read metadata
    const isDeafened = audioMuted !== undefined ? audioMuted : deafenedFromMeta;

    const activeTrack: TrackReference | null =
        trackRef &&
            isTrackReference(trackRef) &&
            trackRef.publication.isSubscribed &&
            !trackRef.publication.isMuted
            ? trackRef
            : null;

    const qualityStr =
        quality === ConnectionQuality.Excellent ? 'excellent' :
            quality === ConnectionQuality.Good ? 'good' :
                quality === ConnectionQuality.Poor ? 'poor' : null;

    return (
        <div
            className={`p-tile${isSpeaking ? ' speaking' : ''}${onClick ? ' p-tile-clickable' : ''}`}
            data-identity={participant.identity}
            onClick={onClick ? () => onClick(participant.identity) : undefined}
            onContextMenu={onContextMenu}
        >
            {activeTrack ? (
                <VideoTrack trackRef={activeTrack} />
            ) : (
                <div className="p-tile-avatar">
                    <Avatar name={participant.name || participant.identity} identity={participant.identity} size={80} avatarUrl={avatarUrl} />
                </div>
            )}

            {isScreenSharing && (
                <div className="p-tile-screen-badge" title={t('tile.screenSharing')}>
                    <ScreenShareStatusIcon size={12} />
                </div>
            )}

            <div className="p-tile-meta">
                <span className="p-tile-name">{participant.name || participant.identity}</span>
                <div className="p-tile-status">
                    {micMuted && <span className={`p-tile-status-icon${isServerMuted ? ' server-muted' : ''}`} title={isServerMuted ? t('tile.serverMuted') : t('tile.micOff')}><MicOffIcon /></span>}
                    {isDeafened && <span className="p-tile-status-icon" title={t('tile.soundOff')}><SpeakerOffIcon /></span>}
                    {qualityStr && (
                        <div
                            className="cq-bars"
                            data-quality={qualityStr}
                            title={t(QUALITY_LABEL_KEY[qualityStr])}
                        >
                            <div className="cq-bar" />
                            <div className="cq-bar" />
                            <div className="cq-bar" />
                        </div>
                    )}
                </div>
            </div>

            {onFlip && activeTrack && (
                <button
                    className="p-tile-flip"
                    onClick={(e) => { e.stopPropagation(); onFlip(); }}
                    title={t('tile.flipCamera')}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 7h-3.5l-1.5-2h-6L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z" />
                        <circle cx="12" cy="13" r="3.5" />
                        <path d="M17 4l2 3-2 3" />
                    </svg>
                </button>
            )}
        </div>
    );
});
