import { useEffect, useRef } from 'react';
import { useLocalParticipant, useConnectionState } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { playMuteSound, playUnmuteSound, playTalkingWhileMutedSound } from '../../../lib/sounds';

/**
 * Plays mute/unmute sounds whenever mic state changes —
 * works for button clicks, keyboard shortcuts, and deafen toggle.
 */
export function useMicSound(enabled: boolean) {
    const { isMicrophoneEnabled } = useLocalParticipant();
    const connectionState = useConnectionState();
    const prevRef = useRef<boolean | null>(null);

    useEffect(() => {
        if (connectionState !== ConnectionState.Connected) { prevRef.current = null; return; }
        if (prevRef.current === null) {
            prevRef.current = isMicrophoneEnabled;
            return;
        }
        if (isMicrophoneEnabled !== prevRef.current) {
            if (enabled) isMicrophoneEnabled ? playUnmuteSound() : playMuteSound();
            prevRef.current = isMicrophoneEnabled;
        }
    }, [isMicrophoneEnabled, enabled, connectionState]);
}

/**
 * Mumble-style "talking while muted" warning.
 * Opens a lightweight secondary audio stream when mic is muted,
 * monitors RMS level, and plays a double-beep if speech is detected.
 * Cleans up the stream immediately when mic is unmuted.
 */
export function useTalkingWhileMuted(audioInputDeviceId?: string, enabled = true) {
    const { isMicrophoneEnabled } = useLocalParticipant();
    const connectionState = useConnectionState();

    useEffect(() => {
        if (isMicrophoneEnabled || !enabled || connectionState !== ConnectionState.Connected) return;

        let active = true;
        let ac: AudioContext | null = null;
        let intervalId: number;
        let stream: MediaStream | null = null;

        const constraints: MediaStreamConstraints = {
            audio: audioInputDeviceId ? { deviceId: { ideal: audioInputDeviceId } } : true,
        };

        navigator.mediaDevices.getUserMedia(constraints).then(s => {
            if (!active) { s.getTracks().forEach(t => t.stop()); return; }
            stream = s;
            ac = new AudioContext();
            const source = ac.createMediaStreamSource(stream);
            const analyser = ac.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);

            const data = new Float32Array(analyser.fftSize);
            let lastWarning = 0;

            intervalId = window.setInterval(() => {
                analyser.getFloatTimeDomainData(data);
                const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
                const dBFS = 20 * Math.log10(Math.max(rms, 1e-10));
                if (dBFS > -40) {
                    const now = Date.now();
                    if (now - lastWarning > 2500) {
                        lastWarning = now;
                        playTalkingWhileMutedSound();
                    }
                }
            }, 150);
        }).catch((err) => { console.warn('[useTalkingWhileMuted] mic access failed:', err.message); });

        return () => {
            active = false;
            clearInterval(intervalId);
            stream?.getTracks().forEach(t => t.stop());
            ac?.close();
        };
    }, [isMicrophoneEnabled, audioInputDeviceId, enabled, connectionState]);
}
