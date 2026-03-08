import { useState, useCallback } from 'react';
import { useRoomContext } from '@livekit/components-react';

export function useSpeakerMode() {
    const room = useRoomContext();
    const [loudspeaker, setLoudspeaker] = useState(false);

    const toggle = useCallback(async () => {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const outputs = devices.filter(d => d.kind === 'audiooutput');

            if (!loudspeaker) {
                // Find loudspeaker device (Android Chrome exposes it)
                const speaker = outputs.find(d =>
                    /speaker/i.test(d.label) && !/earpiece/i.test(d.label)
                ) ?? outputs.find(d => d.deviceId !== 'default' && d.deviceId !== 'communications');

                if (speaker) {
                    await room.switchActiveDevice('audiooutput', speaker.deviceId);
                    setLoudspeaker(true);
                }
            } else {
                // Switch back to default (earpiece on mobile)
                await room.switchActiveDevice('audiooutput', 'default');
                setLoudspeaker(false);
            }
        } catch {
            // iOS Safari — silently ignore, no setSinkId support
        }
    }, [loudspeaker, room]);

    return { loudspeaker, toggle };
}
