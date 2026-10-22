import { useEffect, useRef, useState } from 'react';

/** "KeyM" → "M", "Digit5" → "5"; other codes ("Space", "F1") as they are. */
export function keyLabel(code: string): string {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
}

/**
 * Binds a setting to the next key pressed. Escape cancels; the key press doesn't reach
 * anything else, so it neither closes Settings nor triggers a shortcut. Listening ends
 * with the component.
 */
export function useKeyCapture<T extends string>(onCapture: (target: T, code: string) => void) {
    const [listening, setListening] = useState<T | null>(null);
    const onCaptureRef = useRef(onCapture);
    useEffect(() => { onCaptureRef.current = onCapture; });

    useEffect(() => {
        if (!listening) return;
        const handler = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.code !== 'Escape') onCaptureRef.current(listening, e.code);
            setListening(null);
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [listening]);

    return { listening, listen: setListening };
}
