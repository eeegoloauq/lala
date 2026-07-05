import { useCallback, useEffect, useMemo, useRef } from 'react';
import i18next from 'i18next';
import type { TFunction } from 'i18next';
import { RoomEvent } from 'livekit-client';
import type { LocalParticipant, Participant, Room } from 'livekit-client';
import { speak } from '../../../lib/tts';
import { ttsOptsFromSettings } from '../lib/ttsOpts';
import { kickParticipant, banParticipant, muteParticipant } from '../../../lib/api';
import { ApiError } from '../../../lib/types';
import { getAdminSecret } from '../../../lib/passwords';
import type { AppSettings } from '../../settings/types';
import type { ParticipantAdminActions } from './useParticipantContextMenu';

function formatAdminMsg(action: string, target: string, by: string): string {
    const key = `admin.${action}`;
    if (i18next.exists(key)) {
        return i18next.t(key, { by, target });
    }
    return `${by}: ${action} → ${target}`;
}

export interface UseAdminActionsOptions {
    room: Room;
    participants: Participant[];
    localParticipant: LocalParticipant;
    t: TFunction;
    settings: AppSettings;
    /** From useRoomSystemMessages — this hook appends kick/ban/mute text through it. */
    addSystem: (text: string, id: string) => void;
    /** From useRoomSystemMessages — called before a kick/ban disconnects the target, so
     *  the redundant "left" message doesn't also show up. */
    suppressLeave: (identity: string) => void;
}

/**
 * Kick/ban/mute wiring for the room creator: builds the `adminProps` bundle handed to
 * VideoGrid/FocusLayout's context menus, broadcasts each action to other clients over
 * the data channel (the sender doesn't get its own DataReceived echo, so it also adds
 * the system message locally), and listens for the same broadcast from other admins so
 * every client shows an identical system message.
 */
export function useAdminActions({
    room,
    participants,
    localParticipant,
    t,
    settings,
    addSystem,
    suppressLeave,
}: UseAdminActionsOptions): ParticipantAdminActions | undefined {
    const adminSecret = getAdminSecret(room.name) ?? undefined;

    // Keep settings in a ref so event handlers registered once don't go stale
    const settingsRef = useRef(settings);
    useEffect(() => { settingsRef.current = settings; });

    // Broadcast admin action to all participants via data channel.
    // Sender doesn't receive their own DataReceived, so we also add locally.
    const broadcastAdminAction = useCallback((action: string, targetIdentity: string) => {
        const targetName = participants.find(p => p.identity === targetIdentity)?.name || targetIdentity;
        const byName = localParticipant.name || localParticipant.identity;
        // Include identity so receivers can also suppress the redundant "left" message
        const payload = new TextEncoder().encode(JSON.stringify({
            type: 'lala_admin', action, target: targetName, by: byName, identity: targetIdentity,
        }));
        room.localParticipant.publishData(payload, { reliable: true });
        // Kick/ban will trigger ParticipantDisconnected — suppress "left" for that user on this client
        if (action === 'kicked' || action === 'banned') suppressLeave(targetIdentity);
        const text = formatAdminMsg(action, targetName, byName);
        addSystem(text, `admin-${action}-${targetIdentity}-${Date.now()}`);
        if (settingsRef.current.chatTTS) speak(text, ttsOptsFromSettings(settingsRef.current));
    }, [room, localParticipant, participants, addSystem, suppressLeave]);

    // Receive admin events from other clients
    useEffect(() => {
        const onData = (data: Uint8Array, sender?: { identity: string; name?: string }) => {
            try {
                const msg = JSON.parse(new TextDecoder().decode(data));
                if (msg.type !== 'lala_admin') return;
                // Use sender's actual name from LiveKit (not msg.by which could be spoofed)
                const byName = sender?.name || sender?.identity || msg.by;
                // Suppress the upcoming "left" message for kicked/banned users on all clients
                if ((msg.action === 'kicked' || msg.action === 'banned') && msg.identity) {
                    suppressLeave(msg.identity);
                }
                const text = formatAdminMsg(msg.action, msg.target, byName);
                addSystem(text, `admin-${msg.action}-${msg.target}-${Date.now()}`);
                if (settingsRef.current.chatTTS) speak(text, ttsOptsFromSettings(settingsRef.current));
            } catch { /* ignore malformed data */ }
        };
        room.on(RoomEvent.DataReceived, onData);
        return () => { room.off(RoomEvent.DataReceived, onData); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [room]);

    const handleAdminError = useCallback((err: unknown) => {
        if (err instanceof ApiError && err.code === 'rate_limited') {
            addSystem(t('admin.rateLimited'), `admin-ratelimit-${Date.now()}`);
        }
    }, [t, addSystem]);

    const adminProps = useMemo(() => adminSecret ? {
        adminSecret,
        roomId: room.name,
        onKick: async (identity: string) => {
            broadcastAdminAction('kicked', identity);
            try { await kickParticipant(room.name, identity, adminSecret); }
            catch (e) { handleAdminError(e); }
        },
        onBan: async (identity: string) => {
            broadcastAdminAction('banned', identity);
            try { await banParticipant(room.name, identity, adminSecret); }
            catch (e) { handleAdminError(e); }
        },
        onToggleMute: async (identity: string, serverMuted: boolean) => {
            broadcastAdminAction(serverMuted ? 'unmuted' : 'muted', identity);
            try { await muteParticipant(room.name, identity, adminSecret, !serverMuted); }
            catch (e) { handleAdminError(e); }
        },
    } : undefined, [adminSecret, room.name, broadcastAdminAction, handleAdminError]);

    return adminProps;
}
