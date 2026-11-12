import type { RoomInfo } from './types';

/**
 * Whether a moderator's menu offers to give someone the floor or take it back, from the
 * server's room list. The floor is for people the room's rights don't let speak, so
 * someone who may speak anyway, or whom a moderator muted, is offered neither.
 */
export function floorAction(
    identity: string,
    room: Pick<RoomInfo, 'serverMutedParticipants' | 'voicedParticipants' | 'cannotSpeakParticipants'>,
): 'give' | 'take' | undefined {
    if (room.voicedParticipants.includes(identity)) return 'take';
    if (room.cannotSpeakParticipants.includes(identity) && !room.serverMutedParticipants.includes(identity)) return 'give';
    return undefined;
}
