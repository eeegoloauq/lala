import { useState } from 'react';
import { useLocalParticipant, useTracks, isTrackReference } from '@livekit/components-react';
import { Track, AudioPresets } from 'livekit-client';
import type { AudioCaptureOptions, VideoEncoding, VideoResolution } from 'livekit-client';
import { SCREEN_SHARE_FPS_STEPS, SCREEN_SHARE_BITRATE_STEPS } from '../../../lib/constants';
import { IS_ELECTRON as isElectron, IS_LINUX, SCREEN_AUDIO_SUPPORTED } from '../../../lib/env';

/**
 * Audio constraints for screen share — disable all voice processing
 * so system/game/music audio is captured 1:1 without "barrel" effect.
 * restrictOwnAudio keeps the call's own playout out of the capture where the
 * platform supports it, so participants don't hear themselves back.
 */
const screenShareAudioOptions: AudioCaptureOptions = {
    restrictOwnAudio: true,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 2,
    sampleRate: 48000,
};

export interface ScreenShareQuality {
    encoding: VideoEncoding;
    /** Capture limit that goes with the bitrate; none means the source's own size. */
    resolution?: VideoResolution;
}

export function getScreenShareQuality(fpsIdx: number, brIdx: number): ScreenShareQuality {
    const fps = SCREEN_SHARE_FPS_STEPS[fpsIdx] ?? 30;
    const mbps = SCREEN_SHARE_BITRATE_STEPS[brIdx] ?? 5;

    let resolution: VideoResolution | undefined;
    if (mbps <= 1) resolution = { width: 854, height: 480 };
    else if (mbps <= 2) resolution = { width: 1280, height: 720 };
    else if (mbps <= 5) resolution = { width: 1920, height: 1080 };
    else if (mbps <= 8) resolution = { width: 2560, height: 1440 };
    else resolution = undefined; // original / 4K

    return { encoding: { maxBitrate: mbps * 1_000_000, maxFramerate: fps }, resolution };
}

/** What a failed start means for the person sharing; null when they cancelled the picker. */
export type ScreenShareFailure = 'systemDenied' | 'capture' | 'captureLinux' | 'publish';

export function screenShareFailure(err: unknown): ScreenShareFailure | null {
    const name = err instanceof Error ? err.name : '';
    // Cancelling the picker and the browser's own refusal are the same NotAllowedError; only
    // the operating system's refusal (macOS screen recording permission) says so.
    if (name === 'NotAllowedError') return /system/i.test((err as Error).message) ? 'systemDenied' : null;
    if (['AbortError', 'NotReadableError', 'NotFoundError', 'NotSupportedError', 'DeviceUnsupportedError', 'TrackInvalidError'].includes(name)) {
        return IS_LINUX ? 'captureLinux' : 'capture';
    }
    // The capture worked but publishing it did not: the connection to the server.
    return 'publish';
}

export function useScreenShare() {
    const { localParticipant } = useLocalParticipant();
    const screenTracks = useTracks([Track.Source.ScreenShare]);
    const [pending, setPending] = useState(false);

    const enabled = screenTracks.some(
        (t) =>
            t.participant.identity === localParticipant.identity &&
            isTrackReference(t) &&
            !t.publication.isMuted,
    );

    const start = async (quality: ScreenShareQuality, sourceId?: string, audio = true) => {
        setPending(true);
        try {
            // Without a sourceId (Wayland) the XDG portal picks the source itself.
            if (isElectron && sourceId) await window.electronAPI!.setScreenShareSource(sourceId);
            audio &&= SCREEN_AUDIO_SUPPORTED;
            await localParticipant.setScreenShareEnabled(
                true,
                {
                    audio: audio ? screenShareAudioOptions : false,
                    systemAudio: audio ? 'include' : 'exclude',
                    resolution: quality.resolution,
                },
                {
                    videoEncoding: quality.encoding,
                    simulcast: false,
                    dtx: false,
                    red: false,
                    audioPreset: AudioPresets.musicHighQualityStereo,
                    // Keep shared text/UI sharp under bandwidth pressure — drop fps instead
                    // of resolution (the opposite of the browser's camera-oriented default).
                    degradationPreference: 'maintain-resolution',
                },
            );
        } finally {
            setPending(false);
        }
    };

    const stop = async () => {
        setPending(true);
        try {
            await localParticipant.setScreenShareEnabled(false);
        } finally {
            setPending(false);
        }
    };

    return { enabled, pending, start, stop };
}
