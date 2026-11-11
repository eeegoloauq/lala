import { useEffect, useRef, useState } from 'react';
import { useRemoteParticipants } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { botListens } from '../../../lib/bots';

const UPDATE_ON = [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ParticipantPermissionsChanged, RoomEvent.ParticipantNameChanged];
const SHOWN_MS = 10_000;

/**
 * Names of bots that just became able to hear the call, for a notice. Each bot is
 * announced once per call, when it joins or is given listen, and the notice goes away on
 * its own; after that the ear on its tile and in the list says it.
 */
export function useListeningBotsNotice(): { names: string[]; dismiss: () => void } {
    const participants = useRemoteParticipants({ updateOnlyOn: UPDATE_ON });
    const announced = useRef(new Set<string>());
    const [names, setNames] = useState<string[]>([]);

    // A string, so the effect runs when the set of listening bots changes, not on every render.
    const listening = participants.filter(botListens).map((p) => `${p.identity}\t${p.name || p.identity}`).join('\n');

    useEffect(() => {
        const fresh = listening.split('\n').filter(Boolean).map((line) => line.split('\t'))
            .filter(([identity]) => !announced.current.has(identity));
        if (fresh.length === 0) return;
        for (const [identity] of fresh) announced.current.add(identity);
        setNames(fresh.map(([, name]) => name));
    }, [listening]);

    useEffect(() => {
        if (names.length === 0) return;
        const timer = setTimeout(() => setNames([]), SHOWN_MS);
        return () => clearTimeout(timer);
    }, [names]);

    return { names, dismiss: () => setNames([]) };
}
