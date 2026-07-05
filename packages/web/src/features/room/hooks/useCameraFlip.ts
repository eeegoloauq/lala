import { useCallback, useState } from 'react';
import { Track } from 'livekit-client';
import type { LocalParticipant, LocalVideoTrack } from 'livekit-client';

/**
 * Flips the local camera between front/back facing modes (mobile "flip camera" button).
 * Shared by VideoGrid and FocusLayout — the facing-mode state is self-contained since neither
 * layout renders it, only the resulting `handleFlip` callback.
 */
export function useCameraFlip(localParticipant: LocalParticipant): () => Promise<void> {
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

    return useCallback(async () => {
        const next: 'user' | 'environment' = facingMode === 'user' ? 'environment' : 'user';
        setFacingMode(next);
        const pub = localParticipant.getTrackPublication(Track.Source.Camera);
        const track = pub?.track as LocalVideoTrack | undefined;
        if (track) await track.restartTrack({ facingMode: next });
    }, [facingMode, localParticipant]);
}
