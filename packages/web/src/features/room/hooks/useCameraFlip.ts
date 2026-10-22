import { useCallback } from 'react';
import { Track } from 'livekit-client';
import type { LocalParticipant, LocalVideoTrack } from 'livekit-client';

/**
 * Flips the local camera between front and back (mobile "flip camera" button). The current
 * side is read off the live track, so switching layouts, which remounts the button, can't
 * make the next flip a no-op.
 */
export function useCameraFlip(localParticipant: LocalParticipant): () => Promise<void> {
    return useCallback(async () => {
        const track = localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
        if (!track) return;
        const current = track.mediaStreamTrack.getSettings().facingMode;
        await track.restartTrack({ facingMode: current === 'environment' ? 'user' : 'environment' });
    }, [localParticipant]);
}
