import { useEffect, useRef, type RefObject } from 'react';

export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const RESIZE_DIRS: ResizeDir[] = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];

const MIN_W = 200, MAX_W = 640, MIN_H = 160;

interface Rect { top: number; left: number; w: number; h: number }

/** Directly apply position/size to panel DOM — bypasses React reconciliation during drag */
function applyRect(panel: HTMLElement, { top, left, w, h }: Rect) {
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.width = `${w}px`;
    panel.style.height = `${h}px`;
}

function getRect(panel: HTMLElement): Rect {
    const pr = panel.getBoundingClientRect();
    const cr = panel.parentElement!.getBoundingClientRect();
    return { top: pr.top - cr.top, left: pr.left - cr.left, w: pr.width, h: pr.height };
}

/** Lets a panel be dragged by its header and resized from its edges while `enabled`. */
export function useFloatingPanel(panelRef: RefObject<HTMLElement | null>, enabled: boolean) {
    // The panel keeps its CSS position until the first drag or resize pins it to explicit coordinates.
    const pinned = useRef(false);
    const gesture = useRef<{ mx: number; my: number; start: Rect; dir: ResizeDir | null } | null>(null);

    useEffect(() => {
        if (!enabled) return;

        const onMove = (e: MouseEvent) => {
            const panel = panelRef.current;
            const g = gesture.current;
            if (!panel || !g) return;
            const dx = e.clientX - g.mx;
            const dy = e.clientY - g.my;
            const { start, dir } = g;

            if (!dir) {
                applyRect(panel, { ...start, top: start.top + dy, left: start.left + dx });
                return;
            }
            let { top, left, w, h } = start;
            if (dir.includes('e')) w = Math.max(MIN_W, Math.min(MAX_W, start.w + dx));
            if (dir.includes('w')) {
                w = Math.max(MIN_W, Math.min(MAX_W, start.w - dx));
                left = start.left + (start.w - w);
            }
            if (dir.includes('s')) h = Math.max(MIN_H, start.h + dy);
            if (dir.includes('n')) {
                h = Math.max(MIN_H, start.h - dy);
                top = start.top + (start.h - h);
            }
            applyRect(panel, { top, left, w, h });
        };
        const onUp = () => { gesture.current = null; };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
    }, [enabled, panelRef]);

    const begin = (e: React.MouseEvent, dir: ResizeDir | null) => {
        const panel = panelRef.current;
        if (!enabled || !panel) return;
        e.preventDefault();
        const start = getRect(panel);
        if (!pinned.current) {
            applyRect(panel, start);
            pinned.current = true;
        }
        gesture.current = { mx: e.clientX, my: e.clientY, start, dir };
    };

    return {
        startDrag: (e: React.MouseEvent) => begin(e, null),
        startResize: (e: React.MouseEvent, dir: ResizeDir) => {
            e.stopPropagation();
            begin(e, dir);
        },
    };
}
