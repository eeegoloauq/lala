import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { RoomEvent } from 'livekit-client';
import type { RemoteParticipant, Room } from 'livekit-client';
import { speak } from '../../../lib/tts';
import { ttsOptsFromSettings } from '../lib/ttsOpts';
import { kickParticipant, banParticipant, muteParticipant } from '../../../lib/api';
import type { ModerationEvent, ModerationTopic } from '../../../lib/types';
import type { AppSettings } from '../../settings/types';
import type { ParticipantAdminActions } from './useParticipantContextMenu';

const MODERATION_TOPIC: ModerationTopic = 'lala.moderation';
const ACTIONS: ReadonlySet<string> = new Set<ModerationEvent['action']>(['kicked', 'banned', 'muted', 'unmuted']);

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
 * Kick, ban and mute for any room the caller moderates. Each is just the API call: the
 * server announces the outcome to everyone in the room, the caller included.
 */
export function buildAdminActions(roomId: string): Omit<ParticipantAdminActions, 'roomId'> {
    return {
        onKick: (identity) => kickParticipant(roomId, identity),
        onBan: (identity) => banParticipant(roomId, identity),
        onToggleMute: (identity, serverMuted) => muteParticipant(roomId, identity, !serverMuted),
    };
}

export interface UseAdminActionsOptions {
    room: Room;
    canModerate: boolean;
    settings: AppSettings;
    /** From useRoomSystemMessages — moderation events are shown through it. */
    addSystem: (text: string, id: string) => void;
    /** From useRoomSystemMessages — a kick or ban already says the person left. */
    suppressLeave: (identity: string) => void;
}

/** Shows the server's moderation events in the chat and hands moderators their actions. */
export function useAdminActions({ room, canModerate, settings, addSystem, suppressLeave }: UseAdminActionsOptions): ParticipantAdminActions | undefined {
    const { t } = useTranslation();
    const settingsRef = useRef(settings);
    useEffect(() => { settingsRef.current = settings; });

    useEffect(() => {
        const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
            // Only the server publishes on this topic; the same event from a participant is forged.
            if (topic !== MODERATION_TOPIC || participant) return;
            const event = parseModerationEvent(payload);
            if (!event) return;
            if (event.action === 'kicked' || event.action === 'banned') suppressLeave(event.target);
            const text = t(`admin.${event.action}`, { by: event.byName, target: event.targetName });
            addSystem(text, `admin-${event.action}-${event.target}-${Date.now()}`);
            if (settingsRef.current.chatTTS) speak(text, ttsOptsFromSettings(settingsRef.current));
        };
        room.on(RoomEvent.DataReceived, onData);
        return () => { room.off(RoomEvent.DataReceived, onData); };
    }, [room, t, addSystem, suppressLeave]);

    return useMemo(
        () => (canModerate ? { roomId: room.name, ...buildAdminActions(room.name) } : undefined),
        [canModerate, room.name],
    );
}
