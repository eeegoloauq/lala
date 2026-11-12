import { memo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { VideoTrack, useIsSpeaking, useConnectionQualityIndicator } from '@livekit/components-react';
import type { TrackReference, TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { isTrackReference } from '@livekit/components-react';
import { RemoteParticipant } from 'livekit-client';
import type { Participant } from 'livekit-client';
import { ConnectionQuality, ParticipantEvent } from 'livekit-client';
import { Avatar } from './Avatar';
import { MicOffIcon, SpeakerOffIcon, ScreenShareStatusIcon, FlipCameraIcon } from '../icons/Icons';
import { useParticipantState } from '../hooks/useParticipantState';
import { hasAttribute } from '../lib/permissions';
import { useIsServerMutedInRoom } from '../../../lib/roomStatusStore';
import { readDeafened } from '../lib/participantMeta';
import { botListens, isBotIdentity } from '../../../lib/bots';
import { BotBadge, ListensMark } from '../../../ui/BotBadge';
import { LevelMeter } from '../../../ui/LevelMeter';
import { useBotDetails } from '../../../lib/roomStatusStore';

interface ParticipantTileProps {
    participant: Participant;
    trackRef?: TrackReferenceOrPlaceholder;
    audioMuted?: boolean;  // local deafen state (only meaningful for local participant)
    avatarUrl?: string;
    onClick?: (participant: Participant, e: React.MouseEvent) => void;
    onFlip?: () => void;
    onContextMenu?: (participant: Participant, e: React.MouseEvent) => void;
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

function useHandRaised(participant: Participant): boolean {
    return useParticipantState(participant, [ParticipantEvent.AttributesChanged], (p) => hasAttribute(p, 'lala.hand'));
}

function useListens(participant: Participant): boolean {
    return useParticipantState(participant, [ParticipantEvent.ParticipantPermissionsChanged], botListens);
}

/** Reactively tracks screen share state. */
function useIsScreenSharing(participant: Participant): boolean {
    const events = participant instanceof RemoteParticipant
        ? [ParticipantEvent.TrackPublished, ParticipantEvent.TrackUnpublished]
        : [ParticipantEvent.LocalTrackPublished, ParticipantEvent.LocalTrackUnpublished];
    return useParticipantState(participant, events, (p) => p.isScreenShareEnabled);
}

export const ParticipantTile = memo(function ParticipantTile({ participant, trackRef, audioMuted, avatarUrl, onClick, onFlip, onContextMenu }: ParticipantTileProps) {
    const isSpeaking = useIsSpeaking(participant);
    const { quality } = useConnectionQualityIndicator({ participant });
    const micMuted = useMicMuted(participant);
    const deafenedFromMeta = useIsDeafenedFromMeta(participant);
    const isScreenSharing = useIsScreenSharing(participant);
    const isServerMuted = useIsServerMutedInRoom(participant.identity);
    const handRaised = useHandRaised(participant);
    const listens = useListens(participant);
    const botStatus = useBotDetails(participant.identity)?.status;
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
        <ParticipantTileView
            name={participant.name || participant.identity}
            identity={participant.identity}
            avatarUrl={avatarUrl}
            video={activeTrack ? <VideoTrack trackRef={activeTrack} /> : undefined}
            speaking={isSpeaking}
            screenSharing={isScreenSharing}
            micMuted={micMuted}
            serverMuted={isServerMuted}
            deafened={isDeafened}
            handRaised={handRaised}
            listens={listens}
            botStatus={botStatus}
            quality={qualityStr}
            onClick={onClick && ((e) => onClick(participant, e))}
            onContextMenu={onContextMenu && ((e) => onContextMenu(participant, e))}
            onFlip={onFlip}
        />
    );
});

interface ParticipantTileViewProps {
    name: string;
    identity: string;
    avatarUrl?: string;
    /** The video to show instead of the avatar. */
    video?: ReactNode;
    speaking: boolean;
    screenSharing: boolean;
    micMuted: boolean;
    serverMuted: boolean;
    deafened: boolean;
    handRaised: boolean;
    /** A bot that receives the call's audio and video. */
    listens?: boolean;
    /** A bot's status line, set by the server from what the bot sent. */
    botStatus?: string;
    quality: 'excellent' | 'good' | 'poor' | null;
    onClick?: (e: React.MouseEvent) => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    /** Shown over a video only. */
    onFlip?: () => void;
}

/** How a participant looks on the stage, from plain state; ParticipantTile reads it from LiveKit. */
export function ParticipantTileView({ name, identity, avatarUrl, video, speaking, screenSharing, micMuted, serverMuted, deafened, handRaised, listens, botStatus, quality, onClick, onContextMenu, onFlip }: ParticipantTileViewProps) {
    const { t } = useTranslation();
    // A bot playing audio gets a level meter; the speaking ring stays for people.
    const isBot = isBotIdentity(identity);
    const playing = isBot && speaking;
    return (
        <div
            className={`p-tile${speaking && !isBot ? ' speaking' : ''}${onClick ? ' p-tile-clickable' : ''}`}
            onClick={onClick}
            onContextMenu={onContextMenu}
        >
            {video ?? (
                <div className="p-tile-avatar">
                    <Avatar name={name} identity={identity} size="fluid" avatarUrl={avatarUrl} />
                </div>
            )}

            {isBot && (botStatus || playing) && (
                <div className="p-tile-bot-status">
                    {botStatus && <span>{botStatus}</span>}
                    {playing && <LevelMeter />}
                </div>
            )}

            {screenSharing && (
                <div className="p-tile-screen-badge" title={t('tile.screenSharing')}>
                    <ScreenShareStatusIcon size={12} />
                </div>
            )}

            <div className="p-tile-meta">
                <span className="p-tile-name">
                    <span className="p-tile-name-text">{name}</span>
                    {isBot && <BotBadge />}
                </span>
                <div className="p-tile-status">
                    {listens && <span className="p-tile-status-icon"><ListensMark /></span>}
                    {handRaised && <span className="p-tile-status-icon p-tile-hand" title={t('tile.handRaised')}>✋</span>}
                    {/* A bot plays audio or doesn't; the level meter shows which, so no mic icon. */}
                    {micMuted && !isBot && <span className={`p-tile-status-icon${serverMuted ? ' server-muted' : ''}`} title={serverMuted ? t('tile.serverMuted') : t('tile.micOff')}><MicOffIcon /></span>}
                    {deafened && <span className="p-tile-status-icon" title={t('tile.soundOff')}><SpeakerOffIcon /></span>}
                    {quality && (
                        <div
                            className="cq-bars"
                            data-quality={quality}
                            title={t(QUALITY_LABEL_KEY[quality])}
                        >
                            <div className="cq-bar" />
                            <div className="cq-bar" />
                            <div className="cq-bar" />
                        </div>
                    )}
                </div>
            </div>

            {onFlip && video && (
                <button
                    className="p-tile-flip"
                    onClick={(e) => { e.stopPropagation(); onFlip(); }}
                    title={t('tile.flipCamera')}
                >
                    <FlipCameraIcon size={16} strokeWidth={2} />
                </button>
            )}
        </div>
    );
}
