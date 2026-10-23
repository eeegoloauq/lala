import { useMemo } from 'react';
import { kickParticipant, banParticipant, muteParticipant, setVoice, banFromServer } from '../../../lib/api';
import { useMeContext } from '../../../lib/meContext';
import type { ParticipantAdminActions } from './useParticipantContextMenu';

/**
 * Kick, ban and mute for any room the caller moderates, plus a server ban for server
 * admins. Each is just the API call: the server announces the outcome to everyone in
 * the room, the caller included.
 */
export function buildAdminActions(roomId: string, serverAdmin: boolean): Omit<ParticipantAdminActions, 'roomId'> {
    return {
        onKick: (identity) => kickParticipant(roomId, identity),
        onBan: (identity) => banParticipant(roomId, identity),
        onToggleMute: (identity, serverMuted) => muteParticipant(roomId, identity, !serverMuted),
        onToggleVoice: (identity, voiced) => setVoice(roomId, identity, !voiced),
        onServerBan: serverAdmin ? banFromServer : undefined,
    };
}

/** The moderator's actions in this room, or none for everyone else. */
export function useAdminActions(roomId: string, canModerate: boolean): ParticipantAdminActions | undefined {
    const serverAdmin = useMeContext()?.role === 'admin';
    return useMemo(
        () => (canModerate ? { roomId, ...buildAdminActions(roomId, serverAdmin) } : undefined),
        [canModerate, roomId, serverAdmin],
    );
}
