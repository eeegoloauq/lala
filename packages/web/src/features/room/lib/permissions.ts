import type { Participant } from 'livekit-client';

// TrackSource values from @livekit/protocol, which livekit-client does not re-export.
export const CAMERA = 1;
export const MICROPHONE = 2;
export const SCREEN_SHARE = 3;

type Permission = Participant['permissions'];

/** Whether the server lets this participant publish a source. No listed sources means all are allowed. */
export function canPublishSource(permission: Permission, source: number): boolean {
    if (!permission) return true;
    const sources = permission.canPublishSources;
    return permission.canPublish && (sources.length === 0 || sources.includes(source));
}

export const isMicRevoked = (participant: Participant) => !canPublishSource(participant.permissions, MICROPHONE);
