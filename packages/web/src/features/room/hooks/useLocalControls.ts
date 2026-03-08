import { useTrackToggle } from '@livekit/components-react';
import { Track } from 'livekit-client';

export function useLocalControls() {
    const { enabled: micEnabled, toggle: toggleMic, pending: micPending } =
        useTrackToggle({ source: Track.Source.Microphone });

    const { enabled: camEnabled, toggle: toggleCam, pending: camPending } =
        useTrackToggle({ source: Track.Source.Camera });

    return {
        mic: { enabled: micEnabled, toggle: toggleMic, pending: micPending },
        cam: { enabled: camEnabled, toggle: toggleCam, pending: camPending },
    };
}
