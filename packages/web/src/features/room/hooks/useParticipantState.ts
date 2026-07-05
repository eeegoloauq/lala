import { useEffect, useState } from 'react';
import type { Participant, ParticipantEvent, ParticipantEventCallbacks } from 'livekit-client';

/**
 * Derives reactive state from a participant by re-running `read` whenever any of `events` fires.
 * Shared plumbing behind the participant-event hooks in ParticipantTile (mic muted, deafened,
 * server-muted, screen sharing…), which previously each hand-rolled the same
 * useState + participant.on/off + reset-on-[participant] pattern.
 *
 * `update` always takes zero args, which every ParticipantEventCallbacks listener accepts
 * (TS allows fewer-param callbacks); the cast below only bridges the enum-vs-string-literal-key
 * mismatch between `ParticipantEvent` and `keyof ParticipantEventCallbacks`.
 */
export function useParticipantState<T>(
    participant: Participant,
    events: ParticipantEvent[],
    read: (participant: Participant) => T,
): T {
    const [state, setState] = useState<T>(() => read(participant));

    useEffect(() => {
        const update = () => setState(read(participant));
        update();
        const keys = events as unknown as (keyof ParticipantEventCallbacks)[];
        for (const ev of keys) participant.on(ev, update);
        return () => {
            for (const ev of keys) participant.off(ev, update);
        };
        // `events`/`read` are fixed per call site (re-created each render but stable in shape);
        // only the participant identity should trigger a re-subscribe, matching prior behavior.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [participant]);

    return state;
}
