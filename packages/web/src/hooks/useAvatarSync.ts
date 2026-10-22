import { useEffect, useCallback, useRef } from 'react';
import { RoomEvent, ConnectionState } from 'livekit-client';
import type { Room, Participant } from 'livekit-client';
import { setCachedAvatar, clearCachedAvatar } from '../lib/avatarUtils';
import { MAX_AVATAR_LENGTH, parseAvatar } from '../lib/peerInput';

interface UseAvatarSyncOptions {
    room: Room;
    myAvatarUrl: string | null;
    onAvatarReceived: (identity: string, dataUrl: string | null) => void;
}

/** Participant attribute key our own avatar is published under. Empty string == cleared. */
const AVATAR_ATTR_KEY = 'lala.avatar';


export function useAvatarSync({ room, myAvatarUrl, onAvatarReceived }: UseAvatarSyncOptions) {
    const myAvatarRef = useRef(myAvatarUrl);
    myAvatarRef.current = myAvatarUrl;

    const sendAvatar = useCallback(() => {
        const dataUrl = myAvatarRef.current;
        if (dataUrl && dataUrl.length > MAX_AVATAR_LENGTH) {
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
        const applyAvatar = (identity: string, dataUrl: string | null) => {
            if (dataUrl) setCachedAvatar(identity, dataUrl);
            else clearCachedAvatar(identity);
            onAvatarReceived(identity, dataUrl);
        };

        const onAttrsChanged = (changed: Record<string, string>, participant: Participant) => {
            if (participant.isLocal || !(AVATAR_ATTR_KEY in changed)) return;
            applyAvatar(participant.identity, parseAvatar(changed[AVATAR_ATTR_KEY]));
        };

        room.on(RoomEvent.ParticipantAttributesChanged, onAttrsChanged);

        // Catch peers who already set their avatar attribute before we joined —
        // the server delivers current attributes on join, so this is a plain read.
        for (const p of room.remoteParticipants.values()) {
            const avatar = parseAvatar(p.attributes[AVATAR_ATTR_KEY]);
            if (avatar) applyAvatar(p.identity, avatar);
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
            room.off(RoomEvent.Connected, sendAvatar);
        };
    }, [room, sendAvatar, onAvatarReceived]);

    return { resend: sendAvatar };
}
