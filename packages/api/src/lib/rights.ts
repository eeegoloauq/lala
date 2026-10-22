import { TrackSource, type ParticipantPermission } from 'livekit-server-sdk';
import type { Right, RoomState } from './rooms';

export function isModerator(identity: string | undefined, room: RoomState): boolean {
    return identity !== undefined && identity === room.creator;
}

function allowed(identity: string, room: RoomState, right: Right): boolean {
    return room.rights[right] === 'everyone' || isModerator(identity, room);
}

/**
 * What a participant may publish. It goes into their token and, on a change, to LiveKit
 * directly, so the media server enforces it whatever the client does.
 */
export function permissionFor(identity: string, room: RoomState, muted: boolean): Partial<ParticipantPermission> {
    const sources: TrackSource[] = [];
    if (allowed(identity, room, 'speak') && !muted) sources.push(TrackSource.MICROPHONE);
    if (allowed(identity, room, 'video')) sources.push(TrackSource.CAMERA);
    if (allowed(identity, room, 'screen')) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
    return {
        canSubscribe: true,
        canPublish: sources.length > 0,
        canPublishSources: sources,
        canPublishData: allowed(identity, room, 'chat'),
        canUpdateMetadata: true,
    };
}
