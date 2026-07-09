import { useEffect, useRef } from 'react';
import { useConnectionState } from '@livekit/components-react';
import { ConnectionState, RemoteParticipant, Track } from 'livekit-client';
import type { Participant, RemoteAudioTrack } from 'livekit-client';

const DEFAULT_VOLUME = 50;

// Defense-in-depth for the CWAEC join-glitch (see RoomView.tsx's audioOptions
// comment): even with the pre-acquired-mic-track mitigation, briefly fading
// remote audio in over our own join means a residual glitch (if one still
// happens) plays out quiet rather than at full volume. The ramp runs once per
// connect — a participant who joins after it's already finished (fadeRef.current
// === 1) gets full volume immediately; this only fades around OUR join moment.
const FADE_MS = 700;

export interface UseParticipantVolumeSyncOptions {
    participants: Participant[];
    volumes: Map<string, number>;
    onVolumeChange: (identity: string, vol: number) => void;
    screenVolumes: Map<string, number>;
}

/**
 * Keeps LiveKit's per-participant audio volume (mic + screen-share audio) in sync with
 * the persisted volume maps, and seeds newly-joined remote participants with the
 * default mic volume the first time they're seen.
 */
export function useParticipantVolumeSync({
    participants,
    volumes,
    onVolumeChange,
    screenVolumes,
}: UseParticipantVolumeSyncOptions): void {
    const connectionState = useConnectionState();

    // Multiplier applied to every volume write below (1 outside the ramp). A
    // plain ref rather than state — the rAF loop below re-applies volumes
    // directly, so ramping doesn't force RoomShell's render tree to re-render
    // on every frame for 700ms.
    const fadeRef = useRef(1);

    // Mirrors the latest props for the rAF tick below, which lives across many
    // renders during its ~700ms life and so can't just close over the render
    // that started it. Updated after every render/commit (not during render,
    // so a discarded/replayed render can't leave this pointing at stale props).
    const latestRef = useRef({ participants, volumes, screenVolumes });
    useEffect(() => { latestRef.current = { participants, volumes, screenVolumes }; });

    const applyMicVolumes = () => {
        const { participants, volumes } = latestRef.current;
        participants.forEach(p => {
            if (!(p instanceof RemoteParticipant)) return;
            const vol = volumes.get(p.identity);
            if (vol !== undefined) p.setVolume((vol / 100) * fadeRef.current);
        });
    };

    const applyScreenVolumes = () => {
        const { participants, screenVolumes } = latestRef.current;
        participants.forEach(p => {
            if (!(p instanceof RemoteParticipant)) return;
            const vol = screenVolumes.get(p.identity);
            if (vol !== undefined) {
                const pub = p.getTrackPublication(Track.Source.ScreenShareAudio);
                const track = pub?.audioTrack as RemoteAudioTrack | undefined;
                if (track) track.setVolume((vol / 100) * fadeRef.current);
            }
        });
    };

    // Ramp the fade factor 0 -> 1 over FADE_MS starting the moment we connect,
    // re-applying both volume maps on every frame so remote audio audibly rises
    // in rather than snapping straight to full volume. `RoomAudioRenderer`'s own
    // `volume` prop is deliberately left untouched — writing here too would just
    // fight it (last writer wins), so all volume control stays owned by this hook.
    useEffect(() => {
        if (connectionState !== ConnectionState.Connected) return;
        fadeRef.current = 0;
        const start = performance.now();
        let raf = 0;
        const tick = (now: number) => {
            // Clamp BOTH ends: the rAF timestamp is the frame-start time, which
            // can be a few ms BEFORE `start` (captured mid-frame in the effect),
            // so (now - start) may be slightly negative on the first tick. Without
            // the lower clamp that negative reaches setVolume -> el.volume, and the
            // browser throws "volume ... outside the range [0, 1]", crashing to the
            // error boundary.
            fadeRef.current = Math.max(0, Math.min(1, (now - start) / FADE_MS));
            applyMicVolumes();
            applyScreenVolumes();
            if (fadeRef.current < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [connectionState]);

    // Initialize new remote participants with default volume
    useEffect(() => {
        participants.forEach(p => {
            if (!(p instanceof RemoteParticipant)) return;
            if (!volumes.has(p.identity)) {
                p.setVolume((DEFAULT_VOLUME / 100) * fadeRef.current);
                onVolumeChange(p.identity, DEFAULT_VOLUME);
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [participants]);

    // Sync mic volumes to LiveKit when they change
    useEffect(() => {
        applyMicVolumes();
    }, [volumes, participants]);

    // Sync screen audio volumes to LiveKit when they change
    useEffect(() => {
        applyScreenVolumes();
    }, [screenVolumes, participants]);
}
