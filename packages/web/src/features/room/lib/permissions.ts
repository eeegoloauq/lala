import type { Participant } from 'livekit-client';
import type { ParticipantAttribute } from '../../../lib/types';

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

/** Server markers and the raised hand, set as participant attributes ('1' or absent). */
export const hasAttribute = (participant: Participant, name: ParticipantAttribute) => participant.attributes[name] === '1';

export const isServerMuted = (participant: Participant) => hasAttribute(participant, 'lala.server-muted');
export const canSpeak = (participant: Participant) => canPublishSource(participant.permissions, MICROPHONE);
