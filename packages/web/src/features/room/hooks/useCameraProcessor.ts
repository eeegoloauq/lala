import { useEffect } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { Track, ParticipantEvent } from 'livekit-client';
import type { LocalVideoTrack, LocalTrackPublication } from 'livekit-client';
import type { CameraEffect } from '../../settings/types';

/**
 * Applies (or removes) a camera background processor (currently: blur only)
 * to the local camera track. Modeled closely on `useAudioProcessor`: watches
 * `ParticipantEvent.LocalTrackPublished` so a camera-off -> camera-on cycle
 * (which republishes a fresh, unprocessed track) reapplies the effect instead
 * of silently no-op'ing.
 *
 * Only touches the track while the camera source is actually publishing —
 * no processor work happens while the camera is off.
 */
// MediaPipe is large, so it loads only once someone turns blur on. Its files are
// served by the app (see vite.config.ts), not a CDN.
const loadBackgroundProcessor = () => import('@livekit/track-processors').then(m => m.BackgroundProcessor);
const ASSET_PATHS = { tasksVisionFileSet: '/mediapipe', modelAssetPath: '/mediapipe/selfie_segmenter.tflite' };

export function useCameraProcessor(effect: CameraEffect) {
    const { localParticipant } = useLocalParticipant();

    useEffect(() => {
        const getCameraTrack = (): LocalVideoTrack | undefined => {
            const pub = localParticipant.getTrackPublication(Track.Source.Camera);
            return pub?.videoTrack as LocalVideoTrack | undefined;
        };

        // Asks the track, not a remembered processor: a republished camera track starts bare.
        const applyProcessor = async (track: LocalVideoTrack | undefined) => {
            if (!track) return;
            if (effect === 'none') {
                if (track.getProcessor()) await track.stopProcessor();
                return;
            }
            if (track.getProcessor()) return;
            const BackgroundProcessor = await loadBackgroundProcessor();
            await track.setProcessor(BackgroundProcessor({ mode: 'background-blur', assetPaths: ASSET_PATHS }));
        };

        const run = () => {
            applyProcessor(getCameraTrack()).catch(err => {
                // Never let a processor failure break/unpublish the camera — just
                // fall back to unprocessed video.
                console.warn('[useCameraProcessor] failed to apply:', err instanceof Error ? err.message : err);
            });
        };

        // Apply immediately in case a camera track is already publishing...
        run();

        // ...and re-apply whenever a new local camera track is published (e.g.
        // camera off -> on republishes a fresh, unprocessed track).
        const onLocalTrackPublished = (pub: LocalTrackPublication) => {
            if (pub.source === Track.Source.Camera) run();
        };
        localParticipant.on(ParticipantEvent.LocalTrackPublished, onLocalTrackPublished);
        return () => {
            localParticipant.off(ParticipantEvent.LocalTrackPublished, onLocalTrackPublished);
        };
    }, [effect, localParticipant]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            const track = localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack as LocalVideoTrack | undefined;
            if (track?.getProcessor()) track.stopProcessor().catch(() => {});
        };
    }, [localParticipant]);
}
