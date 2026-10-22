import { useEffect, useRef } from 'react';
import { useLocalParticipant } from '@livekit/components-react';

/** Hold `key` to talk. Deafened, the key does nothing; leaving the window lets go of it. */
export function usePushToTalk(enabled: boolean, key: string, deafened: boolean) {
    const { localParticipant } = useLocalParticipant();
    const isKeyPressed = useRef(false);

    useEffect(() => {
        if (!enabled || !key) return;

        // If PTT is enabled, make sure mic starts disabled
        localParticipant.setMicrophoneEnabled(false).catch(console.warn);

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.code === key && !isKeyPressed.current && !e.repeat && !deafened) {
                // Ignore key events if user is typing in chat input
                if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

                isKeyPressed.current = true;
                localParticipant.setMicrophoneEnabled(true).catch(console.warn);
            }
        };

        const release = () => {
            if (!isKeyPressed.current) return;
            isKeyPressed.current = false;
            localParticipant.setMicrophoneEnabled(false).catch(console.warn);
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === key) release();
        };

        // The key-up of a key let go in another window never arrives here.
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', release);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', release);
            if (isKeyPressed.current) {
                localParticipant.setMicrophoneEnabled(false).catch(console.warn);
            }
        };
    }, [enabled, key, deafened, localParticipant]);
}
