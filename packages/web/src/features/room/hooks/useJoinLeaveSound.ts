import { useEffect } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, Track, RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import { playJoinSound, playLeaveSound, playScreenShareStartSound, playScreenShareStopSound } from '../../../lib/sounds';

/** Plays subtle tones when participants join or leave, including self leave. */
export function useJoinLeaveSound(enabled: boolean) {
    const room = useRoomContext();

    useEffect(() => {
        if (!enabled) return;
        room.on(RoomEvent.ParticipantConnected, playJoinSound);
        room.on(RoomEvent.ParticipantDisconnected, playLeaveSound);
        room.on(RoomEvent.Disconnected, playLeaveSound);
        return () => {
            room.off(RoomEvent.ParticipantConnected, playJoinSound);
            room.off(RoomEvent.ParticipantDisconnected, playLeaveSound);
            room.off(RoomEvent.Disconnected, playLeaveSound);
        };
    }, [room, enabled]);
}

/** Plays tones when remote participants start or stop screen sharing. */
export function useScreenShareSound(enabled: boolean) {
    const room = useRoomContext();

    useEffect(() => {
        if (!enabled) return;
        const onPublished = (pub: RemoteTrackPublication, _: RemoteParticipant) => {
            if (pub.source === Track.Source.ScreenShare) playScreenShareStartSound();
        };
        const onUnpublished = (pub: RemoteTrackPublication, _: RemoteParticipant) => {
            if (pub.source === Track.Source.ScreenShare) playScreenShareStopSound();
        };
        room.on(RoomEvent.TrackPublished, onPublished);
        room.on(RoomEvent.TrackUnpublished, onUnpublished);
        return () => {
            room.off(RoomEvent.TrackPublished, onPublished);
            room.off(RoomEvent.TrackUnpublished, onUnpublished);
        };
    }, [room, enabled]);
}
