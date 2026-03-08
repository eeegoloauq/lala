import { useState, useEffect } from 'react';
import { type Participant, ParticipantEvent, ConnectionQuality } from 'livekit-client';

export { ConnectionQuality };

export function useConnectionQuality(participant: Participant): ConnectionQuality {
    const [quality, setQuality] = useState<ConnectionQuality>(
        participant.connectionQuality ?? ConnectionQuality.Unknown,
    );

    useEffect(() => {
        const handler = (q: ConnectionQuality) => setQuality(q);
        participant.on(ParticipantEvent.ConnectionQualityChanged, handler);
        return () => { participant.off(ParticipantEvent.ConnectionQualityChanged, handler); };
    }, [participant]);

    return quality;
}
