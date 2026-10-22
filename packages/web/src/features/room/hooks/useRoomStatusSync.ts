import { useCallback, useEffect } from 'react';
import { RoomEvent } from 'livekit-client';
import type { Participant, Room } from 'livekit-client';
import { readDeafened } from '../lib/participantMeta';
import { setSpeakingUsers, setMutedInRoom, setDeafenedInRoom, setLiveParticipants } from '../../../lib/roomStatusStore';

export interface UseRoomStatusSyncOptions {
    room: Room;
    /** Reactive participant snapshot — only used for the live-participants map (see below). */
    participants: Participant[];
    /** Local "deafen" toggle state, folded into the deafened-identities set. */
    audioMuted: boolean;
}

/**
 * Keeps the sidebar-facing room status in sync: live participants, muted and deafened
 * identities, and active speakers, written straight into the room-status store
 * (lib/roomStatusStore.ts) so only the affected sidebar rows re-render.
 */
export function useRoomStatusSync({
    room,
    participants,
    audioMuted,
}: UseRoomStatusSyncOptions): void {
    // Keep active participants in sync for sidebar
    useEffect(() => {
        const live = new Map<string, string>();
        participants.forEach(p => {
            if (p.identity) live.set(p.identity, p.name || p.identity);
        });
        setLiveParticipants(live);
    }, [participants]);

    // Track real-time mic mute state for all participants → sidebar
    // Uses room.remoteParticipants directly (live Map) to avoid stale closure from useParticipants() snapshot
    useEffect(() => {
        const buildMuted = () => {
            const s = new Set<string>();
            room.remoteParticipants.forEach(p => {
                if (!p.isMicrophoneEnabled) s.add(p.identity);
            });
            if (!room.localParticipant.isMicrophoneEnabled) s.add(room.localParticipant.identity);
            return s;
        };
        setMutedInRoom(buildMuted());
        const update = () => setMutedInRoom(buildMuted());
        room.on(RoomEvent.TrackMuted, update);
        room.on(RoomEvent.TrackUnmuted, update);
        room.on(RoomEvent.TrackPublished, update);
        room.on(RoomEvent.TrackUnpublished, update);
        room.on(RoomEvent.LocalTrackPublished, update);
        room.on(RoomEvent.LocalTrackUnpublished, update);
        room.on(RoomEvent.ParticipantConnected, update);
        room.on(RoomEvent.ParticipantDisconnected, update);
        return () => {
            room.off(RoomEvent.TrackMuted, update);
            room.off(RoomEvent.TrackUnmuted, update);
            room.off(RoomEvent.TrackPublished, update);
            room.off(RoomEvent.TrackUnpublished, update);
            room.off(RoomEvent.LocalTrackPublished, update);
            room.off(RoomEvent.LocalTrackUnpublished, update);
            room.off(RoomEvent.ParticipantConnected, update);
            room.off(RoomEvent.ParticipantDisconnected, update);
        };
    }, [room]);

    // Deafen state: track via participant metadata (setMetadata broadcasts to all clients)
    // Local participant: use immediate audioMuted state (no async round-trip)
    // Remotes: read room.remoteParticipants directly to avoid stale snapshot from useParticipants()
    useEffect(() => {
        const buildDeafened = () => {
            const s = new Set<string>();
            if (audioMuted) s.add(room.localParticipant.identity);
            room.remoteParticipants.forEach(p => {
                if (readDeafened(p.metadata)) s.add(p.identity);
            });
            return s;
        };
        setDeafenedInRoom(buildDeafened());
        const update = () => setDeafenedInRoom(buildDeafened());
        room.on(RoomEvent.ParticipantMetadataChanged, update);
        room.on(RoomEvent.ParticipantConnected, update);
        room.on(RoomEvent.ParticipantDisconnected, update);
        return () => {
            room.off(RoomEvent.ParticipantMetadataChanged, update);
            room.off(RoomEvent.ParticipantConnected, update);
            room.off(RoomEvent.ParticipantDisconnected, update);
        };
    }, [room, audioMuted]);

    const handleSpeakers = useCallback(
        (speakers: Participant[]) => {
            setSpeakingUsers(speakers.map((s) => s.identity));
        },
        [],
    );

    useEffect(() => {
        room.on(RoomEvent.ActiveSpeakersChanged, handleSpeakers);
        return () => { room.off(RoomEvent.ActiveSpeakersChanged, handleSpeakers); };
    }, [room, handleSpeakers]);
}
