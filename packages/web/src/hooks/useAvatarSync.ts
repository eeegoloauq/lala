import { useEffect, useCallback, useRef } from 'react';
import { RoomEvent, ConnectionState } from 'livekit-client';
import type { Room, RemoteParticipant } from 'livekit-client';
import { setCachedAvatar, setCachedAvatarByName, clearCachedAvatar, clearCachedAvatarByName } from '../lib/avatarUtils';

interface UseAvatarSyncOptions {
    room: Room;
    myAvatarUrl: string | null;
    onAvatarReceived: (identity: string, dataUrl: string | null) => void;
}

const MAX_AVATAR_BYTES = 50_000;

export function useAvatarSync({ room, myAvatarUrl, onAvatarReceived }: UseAvatarSyncOptions) {
    const myAvatarRef = useRef(myAvatarUrl);
    myAvatarRef.current = myAvatarUrl;

    const sendAvatar = useCallback((target?: RemoteParticipant) => {
        const dataUrl = myAvatarRef.current;
        if (dataUrl && dataUrl.length > MAX_AVATAR_BYTES) return;
        const payload = new TextEncoder().encode(
            JSON.stringify({ type: 'lala_avatar', dataUrl: dataUrl ?? null })
        );
        room.localParticipant.publishData(payload, {
            reliable: true,
            destinationIdentities: target ? [target.identity] : undefined,
        }).catch(err => {
            console.warn('avatar send failed', err);
        });
    }, [room]);

    // Re-broadcast when avatar changes mid-session
    const prevAvatarRef = useRef(myAvatarUrl);
    useEffect(() => {
        if (prevAvatarRef.current === myAvatarUrl) return;
        prevAvatarRef.current = myAvatarUrl;
        if (room.state === ConnectionState.Connected) sendAvatar();
    }, [myAvatarUrl, room, sendAvatar]);

    useEffect(() => {
        const onData = (data: Uint8Array, participant?: RemoteParticipant) => {
            if (!participant) return;
            try {
                const msg = JSON.parse(new TextDecoder().decode(data));
                if (msg.type !== 'lala_avatar') return;
                if (msg.dataUrl === null) {
                    clearCachedAvatar(participant.identity);
                    if (participant.name) clearCachedAvatarByName(participant.name);
                    onAvatarReceived(participant.identity, null);
                    return;
                }
                if (typeof msg.dataUrl !== 'string' || msg.dataUrl.length > MAX_AVATAR_BYTES) return;
                if (!msg.dataUrl.startsWith('data:image/')) return;
                setCachedAvatar(participant.identity, msg.dataUrl);
                if (participant.name) setCachedAvatarByName(participant.name, msg.dataUrl);
                onAvatarReceived(participant.identity, msg.dataUrl);
            } catch { /* ignore malformed */ }
        };

        const onJoin = (p: RemoteParticipant) => {
            sendAvatar(p); // unicast own avatar to new joiner
        };

        room.on(RoomEvent.DataReceived, onData);
        room.on(RoomEvent.ParticipantConnected, onJoin);

        // Broadcast own avatar only after the data channel is ready
        if (room.state === ConnectionState.Connected) {
            sendAvatar();
        } else {
            room.once(RoomEvent.Connected, () => sendAvatar());
        }

        return () => {
            room.off(RoomEvent.DataReceived, onData);
            room.off(RoomEvent.ParticipantConnected, onJoin);
            room.off(RoomEvent.Connected, sendAvatar);
        };
    }, [room, sendAvatar, onAvatarReceived]);

    return { resend: sendAvatar };
}
