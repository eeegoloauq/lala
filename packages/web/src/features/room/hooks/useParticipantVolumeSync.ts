import { useEffect } from 'react';
import { RemoteParticipant, Track } from 'livekit-client';
import type { Participant, RemoteAudioTrack } from 'livekit-client';

const DEFAULT_VOLUME = 50;

export interface UseParticipantVolumeSyncOptions {
    participants: Participant[];
    volumes: Map<string, number>;
    onVolumeChange: (identity: string, vol: number) => void;
    screenVolumes: Map<string, number>;
}

/**
 * Keeps LiveKit's per-participant audio volume (mic + screen-share audio) in sync with
 * the persisted volume maps, and seeds newly-joined remote participants with the
 * default mic volume the first time they're seen.
 */
export function useParticipantVolumeSync({
    participants,
    volumes,
    onVolumeChange,
    screenVolumes,
}: UseParticipantVolumeSyncOptions): void {
    // Initialize new remote participants with default volume
    useEffect(() => {
        participants.forEach(p => {
            if (!(p instanceof RemoteParticipant)) return;
            if (!volumes.has(p.identity)) {
                p.setVolume(DEFAULT_VOLUME / 100);
                onVolumeChange(p.identity, DEFAULT_VOLUME);
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [participants]);

    // Sync mic volumes to LiveKit when they change
    useEffect(() => {
        participants.forEach(p => {
            if (!(p instanceof RemoteParticipant)) return;
            const vol = volumes.get(p.identity);
            if (vol !== undefined) p.setVolume(vol / 100);
        });
    }, [volumes, participants]);

    // Sync screen audio volumes to LiveKit when they change
    useEffect(() => {
        participants.forEach(p => {
            if (!(p instanceof RemoteParticipant)) return;
            const vol = screenVolumes.get(p.identity);
            if (vol !== undefined) {
                const pub = p.getTrackPublication(Track.Source.ScreenShareAudio);
                const track = pub?.audioTrack as RemoteAudioTrack | undefined;
                if (track) track.setVolume(vol / 100);
            }
        });
    }, [screenVolumes, participants]);
}
