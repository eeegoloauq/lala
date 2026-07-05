import { useEffect, useCallback, useRef } from 'react';
import { RoomEvent, ConnectionState } from 'livekit-client';
import type { Room, RemoteParticipant, Participant } from 'livekit-client';
import { setCachedAvatar, setCachedAvatarByName, clearCachedAvatar, clearCachedAvatarByName } from '../lib/avatarUtils';

interface UseAvatarSyncOptions {
    room: Room;
    myAvatarUrl: string | null;
    onAvatarReceived: (identity: string, dataUrl: string | null) => void;
}

/** Participant attribute key our own avatar is published under. Empty string == cleared. */
const AVATAR_ATTR_KEY = 'lala.avatar';

// Guard for what we're willing to *send* via setAttributes. Avatars are 128x128
// JPEG data URLs (see avatarUtils.compressAvatar) so this is a generous margin.
const MAX_SEND_AVATAR_BYTES = 32 * 1024;

// Looser cap kept only for the legacy publishData receive path below (matches
// what older clients were allowed to send under the pre-attributes scheme).
const MAX_LEGACY_AVATAR_BYTES = 50_000;

export function useAvatarSync({ room, myAvatarUrl, onAvatarReceived }: UseAvatarSyncOptions) {
    const myAvatarRef = useRef(myAvatarUrl);
    myAvatarRef.current = myAvatarUrl;

    const sendAvatar = useCallback(() => {
        const dataUrl = myAvatarRef.current;
        if (dataUrl && dataUrl.length > MAX_SEND_AVATAR_BYTES) {
            console.warn('avatar data URL too large to send via attributes, skipping', dataUrl.length);
            return;
        }
        // Empty string clears the attribute for late joiners / other clients;
        // LiveKit attribute values are always strings (no null/undefined).
        room.localParticipant.setAttributes({ [AVATAR_ATTR_KEY]: dataUrl ?? '' }).catch(err => {
            console.warn('avatar attribute send failed', err);
        });
    }, [room]);

    // Re-send when our own avatar changes mid-session.
    const prevAvatarRef = useRef(myAvatarUrl);
    useEffect(() => {
        if (prevAvatarRef.current === myAvatarUrl) return;
        prevAvatarRef.current = myAvatarUrl;
        if (room.state === ConnectionState.Connected) sendAvatar();
    }, [myAvatarUrl, room, sendAvatar]);

    useEffect(() => {
        const applyAvatar = (identity: string, name: string | undefined, dataUrl: string | null) => {
            if (dataUrl) {
                setCachedAvatar(identity, dataUrl);
                if (name) setCachedAvatarByName(name, dataUrl);
            } else {
                clearCachedAvatar(identity);
                if (name) clearCachedAvatarByName(name);
            }
            onAvatarReceived(identity, dataUrl);
        };

        const onAttrsChanged = (changed: Record<string, string>, participant: Participant) => {
            if (participant.isLocal) return;
            if (!(AVATAR_ATTR_KEY in changed)) return;
            const value = changed[AVATAR_ATTR_KEY];
            applyAvatar(participant.identity, participant.name, value ? value : null);
        };

        // TODO(2026-10-05): remove legacy publishData avatar receive path (one release compat)
        const onData = (data: Uint8Array, participant?: RemoteParticipant) => {
            if (!participant) return;
            try {
                const msg = JSON.parse(new TextDecoder().decode(data));
                if (msg.type !== 'lala_avatar') return;
                if (msg.dataUrl === null) {
                    applyAvatar(participant.identity, participant.name, null);
                    return;
                }
                if (typeof msg.dataUrl !== 'string' || msg.dataUrl.length > MAX_LEGACY_AVATAR_BYTES) return;
                if (!msg.dataUrl.startsWith('data:image/')) return;
                applyAvatar(participant.identity, participant.name, msg.dataUrl);
            } catch { /* ignore malformed */ }
        };

        room.on(RoomEvent.ParticipantAttributesChanged, onAttrsChanged);
        room.on(RoomEvent.DataReceived, onData);

        // Catch peers who already set their avatar attribute before we joined —
        // the server delivers current attributes on join, so this is a plain read.
        for (const p of room.remoteParticipants.values()) {
            const value = p.attributes[AVATAR_ATTR_KEY];
            if (value) applyAvatar(p.identity, p.name, value);
        }

        // Publish our own avatar once the signaling connection is up. No
        // resend-on-join dance needed anymore — the server delivers our
        // attributes to late joiners automatically.
        if (room.state === ConnectionState.Connected) {
            sendAvatar();
        } else {
            room.once(RoomEvent.Connected, sendAvatar);
        }

        return () => {
            room.off(RoomEvent.ParticipantAttributesChanged, onAttrsChanged);
            room.off(RoomEvent.DataReceived, onData);
            room.off(RoomEvent.Connected, sendAvatar);
        };
    }, [room, sendAvatar, onAvatarReceived]);

    return { resend: sendAvatar };
}
