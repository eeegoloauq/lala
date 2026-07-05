import { useEffect, useRef } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { Track, ParticipantEvent } from 'livekit-client';
import type { LocalAudioTrack, LocalTrackPublication } from 'livekit-client';
import { LalaAudioProcessor } from '../../../lib/audioProcessor';
import type { NoiseSuppressionMode } from '../../settings/types';

interface AudioProcessorSettings {
    noiseSuppressionMode: NoiseSuppressionMode;
    silenceGate: number;
}

export function useAudioProcessor({ noiseSuppressionMode, silenceGate }: AudioProcessorSettings) {
    const { localParticipant } = useLocalParticipant();
    const processorRef = useRef<LalaAudioProcessor | null>(null);

    useEffect(() => {
        const needsProcessor = noiseSuppressionMode === 'rnnoise' || silenceGate !== 0;

        const getMicTrack = (): LocalAudioTrack | undefined => {
            const pub = localParticipant.getTrackPublication(Track.Source.Microphone);
            return pub?.audioTrack as LocalAudioTrack | undefined;
        };

        const applyProcessor = async (track: LocalAudioTrack | undefined) => {
            if (!track) return;

            if (!needsProcessor) {
                if (processorRef.current) {
                    await track.setProcessor(null as never);
                    processorRef.current = null;
                }
                return;
            }

            const config = {
                rnnoise: noiseSuppressionMode === 'rnnoise',
                gateThreshold: silenceGate,
            };

            if (processorRef.current) {
                // Update in-place — no restart needed
                processorRef.current.updateConfig(config);
            } else {
                const processor = new LalaAudioProcessor(config);
                processorRef.current = processor;
                await track.setProcessor(processor);
            }
        };

        const run = () => {
            applyProcessor(getMicTrack()).catch(err => console.warn('[useAudioProcessor] failed to apply:', err.message));
        };

        // Apply immediately in case a mic track already exists...
        run();

        // ...and re-apply whenever a new local mic track is published. Without
        // this, muting -> changing NS mode/silence gate -> unmuting publishes a
        // fresh, unprocessed track: the settings change above no-ops silently
        // because there was no track to attach the processor to at the time.
        // (Listening on the LocalParticipant instance, so this is the
        // Participant-level event, not the identically-named Room-level one.)
        const onLocalTrackPublished = (pub: LocalTrackPublication) => {
            if (pub.source === Track.Source.Microphone) run();
        };
        localParticipant.on(ParticipantEvent.LocalTrackPublished, onLocalTrackPublished);
        return () => {
            localParticipant.off(ParticipantEvent.LocalTrackPublished, onLocalTrackPublished);
        };
    }, [noiseSuppressionMode, silenceGate, localParticipant]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            const track = localParticipant
                .getTrackPublication(Track.Source.Microphone)
                ?.audioTrack as LocalAudioTrack | undefined;
            if (track && processorRef.current) {
                track.setProcessor(null as never).catch(() => {});
                processorRef.current = null;
            }
        };
    }, [localParticipant]);
}
