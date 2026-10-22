import { useEffect, useMemo, useRef } from 'react';
import { ConnectionState, Track } from 'livekit-client';
import type { LocalParticipant, Room, RoomOptions } from 'livekit-client';
import type { AppSettings } from '../../settings/types';
import { mediaOptionsFrom } from '../lib/roomOptions';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Publishes a source again so it picks up new capture or publishing options, keeping its mute state. */
async function republish(participant: LocalParticipant, source: Track.Source.Microphone | Track.Source.Camera) {
    const publication = participant.getTrackPublication(source);
    if (!publication?.track) return;
    const wasMuted = publication.isMuted;
    await participant.unpublishTrack(publication.track);
    if (source === Track.Source.Microphone) {
        await participant.setMicrophoneEnabled(true);
        if (wasMuted) await participant.setMicrophoneEnabled(false);
    } else if (!wasMuted) {
        await participant.setCameraEnabled(true);
    }
}

/**
 * Applies media settings to a live Room instead of making a new one, which would drop
 * and redo the whole connection. The Room's options object is shared with its local
 * participant, so updating it covers every later publish; what is already published
 * is switched or republished.
 */
export function useLiveSettings(room: Room, settings: AppSettings) {
    // Recomputed on any settings change; the effect compares and acts only on what differs.
    const options = useMemo(() => mediaOptionsFrom(settings), [settings]);
    const applied = useRef<RoomOptions>(options);

    useEffect(() => {
        const before = applied.current;
        applied.current = options;
        Object.assign(room.options, options);
        if (room.state !== ConnectionState.Connected) return;

        const participant = room.localParticipant;
        const audioPublish = (o: RoomOptions) => [o.publishDefaults?.audioPreset, o.publishDefaults?.dtx, o.publishDefaults?.forceStereo];
        const videoPublish = (o: RoomOptions) => [o.publishDefaults?.simulcast, o.publishDefaults?.videoEncoding];
        const work: Promise<unknown>[] = [];
        if (!same(options.audioOutput, before.audioOutput)) {
            work.push(room.switchActiveDevice('audiooutput', options.audioOutput?.deviceId ?? 'default'));
        }
        if (!same(options.audioCaptureDefaults, before.audioCaptureDefaults) || !same(audioPublish(options), audioPublish(before))) {
            work.push(republish(participant, Track.Source.Microphone));
        }
        if (!same(options.videoCaptureDefaults, before.videoCaptureDefaults) || !same(videoPublish(options), videoPublish(before))) {
            work.push(republish(participant, Track.Source.Camera));
        }
        Promise.all(work).catch(err => console.warn('[useLiveSettings] applying settings failed:', err instanceof Error ? err.message : err));
    }, [room, options]);
}
