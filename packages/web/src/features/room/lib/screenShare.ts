import { RemoteParticipant, Track } from 'livekit-client';
import type { Participant } from 'livekit-client';

/** Receives or stops receiving someone's screen share, its audio with it. */
export function setScreenShareSubscribed(participant: Participant, subscribed: boolean) {
    if (!(participant instanceof RemoteParticipant)) return;
    participant.getTrackPublication(Track.Source.ScreenShare)?.setSubscribed(subscribed);
    participant.getTrackPublication(Track.Source.ScreenShareAudio)?.setSubscribed(subscribed);
}
