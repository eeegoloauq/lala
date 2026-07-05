import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { RoomEvent, Track } from 'livekit-client';
import type { Participant, RemoteParticipant, RemoteTrackPublication, Room } from 'livekit-client';
import type { ReceivedChatMessage } from '@livekit/components-react';
import { playJoinSound } from '../../../lib/sounds';
import { speak } from '../../../lib/tts';
import { ttsOptsFromSettings } from '../lib/ttsOpts';
import type { AppSettings } from '../../settings/types';
import type { ChatEntry } from '../ChatPanel/ChatPanel';
import type { FileTransferItem } from '../../../lib/fileTransfer';

export interface UseRoomSystemMessagesResult {
    /** Chat messages + system entries, merged and sorted by insertion order. */
    chatEntries: ChatEntry[];
    /** Appends a system entry (used here and by useAdminActions for kick/ban/mute text). */
    addSystem: (text: string, id: string) => void;
    /** Marks an identity's next "left" message as redundant (already announced by an
     *  admin action) — used here and by useAdminActions, which calls it right before
     *  the kick/ban actually disconnects the target. */
    suppressLeave: (identity: string) => void;
}

/**
 * Owns system chat entries — join/leave, screen-share start/stop, and (via the
 * `addSystem`/`suppressLeave` it hands to useAdminActions) kick/ban/mute — plus the
 * insertion-order bookkeeping that interleaves them with real chat messages into a
 * single sorted `chatEntries` list for ChatPanel.
 *
 * Consolidates what used to be three separate RoomShell effects (self-join, join/leave,
 * screen-share) that all built the same kind of entry via a shared `addSystem` closure.
 */
export function useRoomSystemMessages(
    room: Room,
    t: TFunction,
    settings: AppSettings,
    messages: ReceivedChatMessage[],
    fileTransfers: FileTransferItem[] = [],
): UseRoomSystemMessagesResult {
    // System entries carry insertion order for correct chat interleaving
    const [systemEntries, setSystemEntries] = useState<ChatEntry[]>([]);
    const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);

    // Keep settings in a ref so event handlers registered once don't go stale
    const settingsRef = useRef(settings);
    useEffect(() => { settingsRef.current = settings; });

    // Insertion-order counter shared by system entries, chat messages, and file transfers
    // Ensures correct interleaving regardless of server vs client clock skew
    const orderCounterRef = useRef(0);
    const msgOrderRef = useRef(new Map<string, number>());
    const fileOrderRef = useRef(new Map<string, number>());

    // Identities that were kicked or banned — suppress the redundant "left" system message for them.
    // Cleared after 10s to avoid stale entries if the disconnect never arrives.
    const suppressLeaveRef = useRef(new Set<string>());
    const suppressLeave = useCallback((identity: string) => {
        suppressLeaveRef.current.add(identity);
        setTimeout(() => suppressLeaveRef.current.delete(identity), 10_000);
    }, []);

    const addSystem = useCallback((text: string, id: string) => {
        setSystemEntries(prev => [...prev, {
            kind: 'system' as const,
            id,
            timestamp: Date.now(),
            order: orderCounterRef.current++,
            text,
        }]);
    }, []);

    // Self-join sound + initial system message.
    // Not covered by the room.on(ParticipantConnected) listener below — LiveKit never
    // fires that event for the local participant connecting.
    useEffect(() => {
        playJoinSound();
        setSystemEntries([{
            kind: 'system',
            id: 'self-join',
            timestamp: Date.now(),
            order: orderCounterRef.current++,
            text: t('system.youJoined'),
        }]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Participant join/leave system messages + TTS
    // Using settingsRef avoids stale closure (this effect runs once on mount)
    useEffect(() => {
        const onJoin = (p: Participant) => {
            const displayName = p.name || p.identity;
            if (settingsRef.current.chatTTS) speak(t('system.joined', { name: displayName }), ttsOptsFromSettings(settingsRef.current));
            addSystem(t('system.joined', { name: displayName }), `join-${p.identity}-${Date.now()}`);
        };
        const onLeave = (p: Participant) => {
            // Suppressed when this disconnect is caused by a kick/ban (already announced)
            if (suppressLeaveRef.current.has(p.identity)) return;
            const displayName = p.name || p.identity;
            if (settingsRef.current.chatTTS) speak(t('system.left', { name: displayName }), ttsOptsFromSettings(settingsRef.current));
            addSystem(t('system.left', { name: displayName }), `leave-${p.identity}-${Date.now()}`);
        };
        room.on(RoomEvent.ParticipantConnected, onJoin);
        room.on(RoomEvent.ParticipantDisconnected, onLeave);
        return () => {
            room.off(RoomEvent.ParticipantConnected, onJoin);
            room.off(RoomEvent.ParticipantDisconnected, onLeave);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [room]);

    // Screen share start/stop system messages + TTS
    useEffect(() => {
        const onScreenStart = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
            if (pub.source !== Track.Source.ScreenShare) return;
            const name = p.name || p.identity;
            const text = t('system.screenShareStarted', { name });
            addSystem(text, `screenshare-start-${p.identity}-${Date.now()}`);
            if (settingsRef.current.chatTTS) speak(text, ttsOptsFromSettings(settingsRef.current));
        };
        const onScreenStop = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
            if (pub.source !== Track.Source.ScreenShare) return;
            const name = p.name || p.identity;
            const text = t('system.screenShareStopped', { name });
            addSystem(text, `screenshare-stop-${p.identity}-${Date.now()}`);
            if (settingsRef.current.chatTTS) speak(text, ttsOptsFromSettings(settingsRef.current));
        };
        room.on(RoomEvent.TrackPublished, onScreenStart);
        room.on(RoomEvent.TrackUnpublished, onScreenStop);
        return () => {
            room.off(RoomEvent.TrackPublished, onScreenStart);
            room.off(RoomEvent.TrackUnpublished, onScreenStop);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [room]);

    // Rebuild sorted chat entries whenever messages, system entries, or file transfers change.
    // Must be useEffect (not useMemo) so msgOrderRef/fileOrderRef are always populated before we read them.
    useEffect(() => {
        // Assign insertion order to new messages (sort within batch by server timestamp)
        const newMsgs = messages.filter(m => !msgOrderRef.current.has(m.id));
        if (newMsgs.length > 0) {
            newMsgs.sort((a, b) => a.timestamp - b.timestamp);
            for (const m of newMsgs) {
                msgOrderRef.current.set(m.id, orderCounterRef.current++);
            }
        }

        // Same treatment for file transfers — order assigned once at creation, so
        // later progress/status updates (same id) don't reshuffle their position.
        const newFiles = fileTransfers.filter(f => !fileOrderRef.current.has(f.id));
        if (newFiles.length > 0) {
            newFiles.sort((a, b) => a.timestamp - b.timestamp);
            for (const f of newFiles) {
                fileOrderRef.current.set(f.id, orderCounterRef.current++);
            }
        }

        const all: Array<{ entry: ChatEntry; order: number }> = [
            ...messages.map(m => ({
                entry: { kind: 'chat' as const, msg: m },
                order: msgOrderRef.current.get(m.id) ?? 0,
            })),
            ...systemEntries.map(e => ({
                entry: e,
                order: (e as ChatEntry & { order?: number }).order ?? 0,
            })),
            ...fileTransfers.map(f => ({
                entry: { kind: 'file' as const, id: f.id, timestamp: f.timestamp, item: f },
                order: fileOrderRef.current.get(f.id) ?? 0,
            })),
        ];
        setChatEntries(all.sort((a, b) => a.order - b.order).map(x => x.entry));
    }, [messages, systemEntries, fileTransfers]);

    return { chatEntries, addSystem, suppressLeave };
}
