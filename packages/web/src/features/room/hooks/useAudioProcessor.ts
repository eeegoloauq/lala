import { useEffect } from 'react';
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

    useEffect(() => {
        const needsProcessor = noiseSuppressionMode === 'rnnoise' || silenceGate !== 0;

        const getMicTrack = (): LocalAudioTrack | undefined => {
            const pub = localParticipant.getTrackPublication(Track.Source.Microphone);
            return pub?.audioTrack as LocalAudioTrack | undefined;
        };

        // Asks the track, not a remembered processor: a republished mic track starts bare.
        const applyProcessor = async (track: LocalAudioTrack | undefined) => {
            if (!track) return;
            const current = track.getProcessor();
            if (!needsProcessor) {
                if (current) await track.stopProcessor();
                return;
            }
            const config = { rnnoise: noiseSuppressionMode === 'rnnoise', gateThreshold: silenceGate };
            if (current instanceof LalaAudioProcessor) current.updateConfig(config);
            else await track.setProcessor(new LalaAudioProcessor(config));
        };

        const run = () => {
            applyProcessor(getMicTrack()).catch(err => console.warn('[useAudioProcessor] failed to apply:', err.message));
        };

        // Apply now, and again for every newly published mic track (unmuting after a
        // settings change, or a republish), which starts without the processor.
        run();
        const onLocalTrackPublished = (pub: LocalTrackPublication) => {
            if (pub.source === Track.Source.Microphone) run();
        };
        localParticipant.on(ParticipantEvent.LocalTrackPublished, onLocalTrackPublished);
        return () => {
            localParticipant.off(ParticipantEvent.LocalTrackPublished, onLocalTrackPublished);
        };
    }, [noiseSuppressionMode, silenceGate, localParticipant]);

    useEffect(() => {
        return () => {
            const track = localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack as LocalAudioTrack | undefined;
            if (track?.getProcessor()) track.stopProcessor().catch(() => {});
        };
    }, [localParticipant]);
}
