import { useEffect } from 'react';

interface RoomKeyboardOptions {
    onMicToggle: () => void;
    onCamToggle: () => void;
    onDeafen: () => void;
    onChat: () => void;
    onFullscreen: () => void;
    onScreenShare?: () => void;
    onEscape?: () => void;
    pttKey?: string;      // skip binding if PTT is on (Space already used)
    enabled?: boolean;    // master shortcut toggle
    keyMic?: string;
    keyCam?: string;
    keyDeafen?: string;
    keyChat?: string;
    keyFullscreen?: string;
    keyScreenShare?: string;
}

const IGNORED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function useRoomKeyboard({
    onMicToggle, onCamToggle, onDeafen, onChat, onFullscreen,
    onScreenShare, onEscape,
    pttKey,
    enabled = true,
    keyMic = 'KeyM',
    keyCam = 'KeyV',
    keyDeafen = 'KeyD',
    keyChat = 'KeyC',
    keyFullscreen = 'KeyF',
    keyScreenShare = 'KeyS',
}: RoomKeyboardOptions) {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Escape always works regardless of enabled flag
            if (e.code === 'Escape') {
                if (onEscape) onEscape();
                return;
            }
            if (!enabled) return;
            if (IGNORED_TAGS.has((e.target as HTMLElement)?.tagName)) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            if (e.code === keyMic)             { e.preventDefault(); onMicToggle(); }
            else if (e.code === keyCam)        { e.preventDefault(); onCamToggle(); }
            else if (e.code === keyDeafen)     { e.preventDefault(); onDeafen(); }
            else if (e.code === keyChat)       { e.preventDefault(); onChat(); }
            else if (e.code === keyFullscreen) { e.preventDefault(); onFullscreen(); }
            else if (e.code === keyScreenShare && onScreenShare) { e.preventDefault(); onScreenShare(); }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onMicToggle, onCamToggle, onDeafen, onChat, onFullscreen, onScreenShare, onEscape,
        enabled, keyMic, keyCam, keyDeafen, keyChat, keyFullscreen, keyScreenShare, pttKey]);
}
