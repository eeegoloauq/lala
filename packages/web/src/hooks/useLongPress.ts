import { useCallback, useEffect, useRef } from 'react';

const HOLD_MS = 500;
const MOVE_TOLERANCE = 10;

/**
 * Long press on touch screens. Android fires `contextmenu` on a long press but iOS Safari
 * does not, and React has no long-press event, so this times the touch itself.
 * `bind(onFire)` returns handlers for one element; only one press runs at a time, so one
 * hook serves a whole list. After a long press, the release doesn't click: `touchend` is
 * cancelled (which stops the emulated mouse events, so `useDismiss` doesn't close the menu
 * that just opened) and the click is swallowed.
 */
export function useLongPress() {
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const start = useRef({ x: 0, y: 0 });
    const fired = useRef(false);

    const cancel = useCallback(() => {
        clearTimeout(timer.current);
        timer.current = undefined;
    }, []);
    useEffect(() => cancel, [cancel]);

    return useCallback((onFire: (x: number, y: number) => void) => ({
        onPointerDown: (e: React.PointerEvent) => {
            if (e.pointerType !== 'touch') return;
            cancel();
            fired.current = false;
            const { clientX: x, clientY: y } = e;
            start.current = { x, y };
            timer.current = setTimeout(() => {
                timer.current = undefined;
                fired.current = true;
                onFire(x, y);
            }, HOLD_MS);
        },
        onPointerMove: (e: React.PointerEvent) => {
            if (!timer.current) return;
            if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > MOVE_TOLERANCE) cancel();
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onTouchEnd: (e: React.TouchEvent) => {
            if (fired.current) e.preventDefault();
        },
        onClickCapture: (e: React.MouseEvent) => {
            if (!fired.current) return;
            fired.current = false;
            e.stopPropagation();
            e.preventDefault();
        },
    }), [cancel]);
}
