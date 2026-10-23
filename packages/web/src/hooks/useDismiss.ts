import { useEffect, type RefObject } from 'react';

/** Calls `onDismiss` on Escape or a press outside `ref` while `active`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, onDismiss: () => void, active = true) {
    useEffect(() => {
        if (!active) return;
        // mousedown rather than click: a drag that ends outside (selecting text, scrolling) still counts as inside.
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [ref, onDismiss, active]);
}
