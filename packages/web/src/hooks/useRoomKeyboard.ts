import { useEffect, useRef } from 'react';

interface RoomKeyboardOptions {
    onMicToggle: () => void;
    onCamToggle: () => void;
    onDeafen: () => void;
    onChat: () => void;
    onFullscreen: () => void;
    onScreenShare: () => void;
    onEscape: () => void;
    /** The push-to-talk key when it is on: it belongs to push-to-talk, not to a shortcut. */
    pttKey?: string;
    enabled: boolean;    // master shortcut toggle
    keyMic: string;
    keyCam: string;
    keyDeafen: string;
    keyChat: string;
    keyFullscreen: string;
    keyScreenShare: string;
}

const IGNORED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function useRoomKeyboard(options: RoomKeyboardOptions) {
    // Callbacks from callers are often recreated per render; reading them
    // through a ref keeps the global keydown listener bound exactly once.
    const optionsRef = useRef(options);
    optionsRef.current = options;

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const {
                onMicToggle, onCamToggle, onDeafen, onChat, onFullscreen, onScreenShare, onEscape,
                pttKey, enabled, keyMic, keyCam, keyDeafen, keyChat, keyFullscreen, keyScreenShare,
            } = optionsRef.current;

            // Escape always works regardless of enabled flag
            if (e.code === 'Escape') {
                onEscape();
                return;
            }
            if (!enabled || e.code === pttKey) return;
            if (IGNORED_TAGS.has((e.target as HTMLElement)?.tagName)) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            if (e.code === keyMic)             { e.preventDefault(); onMicToggle(); }
            else if (e.code === keyCam)        { e.preventDefault(); onCamToggle(); }
            else if (e.code === keyDeafen)     { e.preventDefault(); onDeafen(); }
            else if (e.code === keyChat)       { e.preventDefault(); onChat(); }
            else if (e.code === keyFullscreen) { e.preventDefault(); onFullscreen(); }
            else if (e.code === keyScreenShare) { e.preventDefault(); onScreenShare(); }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);
}
