import type { Participant } from 'livekit-client';

// TrackSource.MICROPHONE from @livekit/protocol, which livekit-client does not re-export.
const MICROPHONE = 2;

/** Whether the server has taken this participant's microphone away. No listed sources means all are allowed. */
export function isMicRevoked(participant: Participant): boolean {
    const permission = participant.permissions;
    if (!permission) return false;
    const sources = permission.canPublishSources;
    return !permission.canPublish || (sources.length > 0 && !sources.includes(MICROPHONE));
}
