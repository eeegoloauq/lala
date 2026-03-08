import { useEffect, useRef } from 'react';
import { useLocalParticipant } from '@livekit/components-react';

export function usePushToTalk(enabled: boolean, key: string) {
    const { localParticipant } = useLocalParticipant();
    const isKeyPressed = useRef(false);

    useEffect(() => {
        if (!enabled || !key) return;

        // If PTT is enabled, make sure mic starts disabled
        localParticipant.setMicrophoneEnabled(false).catch(console.warn);

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.code === key && !isKeyPressed.current && !e.repeat) {
                // Ignore key events if user is typing in chat input
                if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

                isKeyPressed.current = true;
                localParticipant.setMicrophoneEnabled(true).catch(console.warn);
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === key && isKeyPressed.current) {
                isKeyPressed.current = false;
                localParticipant.setMicrophoneEnabled(false).catch(console.warn);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            if (isKeyPressed.current) {
                localParticipant.setMicrophoneEnabled(false).catch(console.warn);
            }
        };
    }, [enabled, key, localParticipant]);
}
