import { useEffect } from 'react';

/**
 * iOS PWA suspends WebRTC when the screen locks or the app backgrounds.
 * A looping silent AudioContext buffer prevents iOS from suspending the
 * audio session, keeping the mic stream alive.
 *
 * Must run inside a component that mounts after a user gesture (joining
 * a room satisfies this). Uses AudioContext instead of Audio element
 * because it integrates with the same audio graph as LiveKit.
 */
export function useIosAudioKeepAlive(enabled: boolean) {
    useEffect(() => {
        const isIos = /iP(hone|ad|od)/.test(navigator.userAgent);
        if (!isIos || !enabled) return;

        let ctx: AudioContext | null = null;
        let source: AudioBufferSourceNode | null = null;

        try {
            ctx = new AudioContext();
            // 2-second silent mono buffer
            const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
            source = ctx.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
            source.connect(ctx.destination);
            source.start(0);
        } catch {
            // Not critical — just a keep-alive
        }

        const resume = () => ctx?.state === 'suspended' && ctx.resume();
        document.addEventListener('touchstart', resume);
        document.addEventListener('visibilitychange', resume);

        return () => {
            document.removeEventListener('touchstart', resume);
            document.removeEventListener('visibilitychange', resume);
            source?.stop();
            ctx?.close();
        };
    }, [enabled]);
}
