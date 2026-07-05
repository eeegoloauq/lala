import { useEffect, useRef } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { Track, ParticipantEvent } from 'livekit-client';
import type { LocalVideoTrack, LocalTrackPublication } from 'livekit-client';
import { BackgroundProcessor, type BackgroundProcessorWrapper } from '@livekit/track-processors';
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
export function useCameraProcessor(effect: CameraEffect) {
    const { localParticipant } = useLocalParticipant();
    const processorRef = useRef<BackgroundProcessorWrapper | null>(null);

    useEffect(() => {
        const getCameraTrack = (): LocalVideoTrack | undefined => {
            const pub = localParticipant.getTrackPublication(Track.Source.Camera);
            return pub?.videoTrack as LocalVideoTrack | undefined;
        };

        const applyProcessor = async (track: LocalVideoTrack | undefined) => {
            if (!track) return;

            if (effect === 'none') {
                if (processorRef.current) {
                    await track.stopProcessor();
                    processorRef.current = null;
                }
                return;
            }

            // effect === 'blur'
            if (processorRef.current) return; // already applied — nothing to update in-place for blur-only scope
            const processor = BackgroundProcessor({ mode: 'background-blur' });
            processorRef.current = processor;
            await track.setProcessor(processor);
        };

        const run = () => {
            applyProcessor(getCameraTrack()).catch(err => {
                // Never let a processor failure break/unpublish the camera — just
                // fall back to unprocessed video.
                console.warn('[useCameraProcessor] failed to apply:', err instanceof Error ? err.message : err);
                processorRef.current = null;
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
            const track = localParticipant
                .getTrackPublication(Track.Source.Camera)
                ?.videoTrack as LocalVideoTrack | undefined;
            if (track && processorRef.current) {
                track.stopProcessor().catch(() => {});
                processorRef.current = null;
            }
        };
    }, [localParticipant]);
}
