import { useCallback, useEffect, useEffectEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionState, ParticipantEvent, RoomEvent, Track } from 'livekit-client';
import type { LocalTrackPublication, RemoteParticipant, RemoteTrackPublication, Room } from 'livekit-client';
import { playJoinSound, playLeaveSound, playScreenShareStartSound, playScreenShareStopSound } from '../../../lib/sounds';
import { speak } from '../../../lib/tts';
import { ttsOptsFromSettings } from '../lib/ttsOpts';
import type { ModerationEvent, ModerationTopic } from '../../../lib/types';
import type { AppSettings } from '../../settings/types';

const MODERATION_TOPIC: ModerationTopic = 'lala.moderation';
const ACTIONS: ReadonlySet<string> = new Set<ModerationEvent['action']>(['kicked', 'banned', 'muted', 'unmuted', 'voiced', 'unvoiced']);

function parseModerationEvent(payload: Uint8Array): ModerationEvent | null {
    try {
        const e = JSON.parse(new TextDecoder().decode(payload));
        const valid = ACTIONS.has(e?.action) && [e.target, e.targetName, e.byName].every(v => typeof v === 'string');
        return valid ? e : null;
    } catch {
        return null;
    }
}

/**
 * Tells the room what happens in it: joins and leaves, screen shares starting and stopping,
 * and the server's moderation events, each as a sound (where the settings allow), a chat
 * notice and, with chat speech on, spoken aloud.
 */
export function useRoomAnnouncements(room: Room, settings: AppSettings, addSystem: (text: string, id: string) => void) {
    const { t } = useTranslation();
    // Identities just kicked or banned: their disconnect is already announced. Used up by
    // that disconnect, or dropped when they join again.
    const kickedRef = useRef(new Set<string>());

    const announce = useCallback((text: string, id: string) => {
        addSystem(text, `${id}-${Date.now()}`);
        if (settings.chatTTS) speak(text, ttsOptsFromSettings(settings));
    }, [addSystem, settings]);

    // Your own join: LiveKit fires no ParticipantConnected for it. The sound waits until the
    // room is connected and our microphone is published, so it plays after the output switch
    // that Chromium's echo cancellation makes when capture starts (see RoomView.tsx) instead
    // of being cut by it. Without a microphone it plays 300 ms after connecting.
    const announceSelfJoin = useEffectEvent(() => {
        if (settings.soundJoinLeave) playJoinSound();
        addSystem(t('system.youJoined'), 'self-join');
    });
    useEffect(() => {
        let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
        const onMicPublished = (pub: LocalTrackPublication) => {
            if (pub.source === Track.Source.Microphone) selfJoined();
        };
        const selfJoined = () => {
            clearTimeout(fallbackTimer);
            room.localParticipant.off(ParticipantEvent.LocalTrackPublished, onMicPublished);
            announceSelfJoin();
        };
        const onConnected = () => {
            if (room.localParticipant.isMicrophoneEnabled) {
                selfJoined();
                return;
            }
            room.localParticipant.on(ParticipantEvent.LocalTrackPublished, onMicPublished);
            fallbackTimer = setTimeout(selfJoined, 300);
        };

        if (room.state === ConnectionState.Connected) onConnected();
        else room.once(RoomEvent.Connected, onConnected);
        return () => {
            room.off(RoomEvent.Connected, onConnected);
            room.localParticipant.off(ParticipantEvent.LocalTrackPublished, onMicPublished);
            clearTimeout(fallbackTimer);
        };
    }, [room]);

    useEffect(() => {
        const onJoin = (p: RemoteParticipant) => {
            kickedRef.current.delete(p.identity);
            if (settings.soundJoinLeave) playJoinSound();
            announce(t('system.joined', { name: p.name || p.identity }), `join-${p.identity}`);
        };
        const onLeave = (p: RemoteParticipant) => {
            if (settings.soundJoinLeave) playLeaveSound();
            if (kickedRef.current.delete(p.identity)) return;
            announce(t('system.left', { name: p.name || p.identity }), `leave-${p.identity}`);
        };
        const onOwnLeave = () => {
            if (settings.soundJoinLeave) playLeaveSound();
        };
        const onPublished = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
            if (pub.source !== Track.Source.ScreenShare) return;
            if (settings.soundScreenShare) playScreenShareStartSound();
            announce(t('system.screenShareStarted', { name: p.name || p.identity }), `screenshare-start-${p.identity}`);
        };
        const onUnpublished = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
            if (pub.source !== Track.Source.ScreenShare) return;
            if (settings.soundScreenShare) playScreenShareStopSound();
            announce(t('system.screenShareStopped', { name: p.name || p.identity }), `screenshare-stop-${p.identity}`);
        };
        const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
            // Only the server publishes on this topic; the same event from a participant is forged.
            if (topic !== MODERATION_TOPIC || participant) return;
            const event = parseModerationEvent(payload);
            if (!event) return;
            if (event.action === 'kicked' || event.action === 'banned') kickedRef.current.add(event.target);
            announce(t(`admin.${event.action}`, { by: event.byName, target: event.targetName }), `admin-${event.action}-${event.target}`);
        };

        room.on(RoomEvent.ParticipantConnected, onJoin)
            .on(RoomEvent.ParticipantDisconnected, onLeave)
            .on(RoomEvent.Disconnected, onOwnLeave)
            .on(RoomEvent.TrackPublished, onPublished)
            .on(RoomEvent.TrackUnpublished, onUnpublished)
            .on(RoomEvent.DataReceived, onData);
        return () => {
            room.off(RoomEvent.ParticipantConnected, onJoin)
                .off(RoomEvent.ParticipantDisconnected, onLeave)
                .off(RoomEvent.Disconnected, onOwnLeave)
                .off(RoomEvent.TrackPublished, onPublished)
                .off(RoomEvent.TrackUnpublished, onUnpublished)
                .off(RoomEvent.DataReceived, onData);
        };
    }, [room, announce, settings, t]);
}
