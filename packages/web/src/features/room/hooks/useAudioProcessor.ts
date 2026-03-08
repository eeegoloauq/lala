import { useEffect, useRef } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { LocalAudioTrack } from 'livekit-client';
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

        const applyProcessor = async () => {
            const track = getMicTrack();
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

        applyProcessor().catch(err => console.warn('[useAudioProcessor] failed to apply:', err.message));
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
