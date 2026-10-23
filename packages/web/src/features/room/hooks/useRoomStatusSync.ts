import { useEffect } from 'react';
import { RoomEvent } from 'livekit-client';
import type { Participant, Room } from 'livekit-client';
import { readDeafened } from '../lib/participantMeta';
import { setSpeakingUsers, setMutedInRoom, setDeafenedInRoom, setLiveParticipants } from '../../../lib/roomStatusStore';

const MUTE_EVENTS = [
    RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
    RoomEvent.TrackPublished, RoomEvent.TrackUnpublished,
    RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
    RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
];
const DEAFEN_EVENTS = [RoomEvent.ParticipantMetadataChanged, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected];

/** Runs `update` now and on each of `events`; returns the unsubscribe. */
function onEvents(room: Room, events: RoomEvent[], update: () => void) {
    update();
    for (const e of events) room.on(e, update);
    return () => { for (const e of events) room.off(e, update); };
}

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
        const update = () => setMutedInRoom(buildMuted());
        return onEvents(room, MUTE_EVENTS, update);
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
        const update = () => setDeafenedInRoom(buildDeafened());
        return onEvents(room, DEAFEN_EVENTS, update);
    }, [room, audioMuted]);

    useEffect(() => {
        const update = (speakers: Participant[]) => setSpeakingUsers(speakers.map((s) => s.identity));
        room.on(RoomEvent.ActiveSpeakersChanged, update);
        return () => { room.off(RoomEvent.ActiveSpeakersChanged, update); };
    }, [room]);
}
