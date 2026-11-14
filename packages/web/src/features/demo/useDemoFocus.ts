import { useEffect, useRef, useState } from 'react';
import { MY_IDENTITY } from './server';
import { nextFocus } from '../room/FocusLayout/focusRules';
import type { FocusPin } from '../room/FocusLayout/focusRules';

export interface DemoFocusView { identity: string; type: 'screen' | 'camera' }

/**
 * The focus of the call (room/FocusLayout/useFocus.ts) over plain streams, with the same
 * rules (`nextFocus`); with a screen and a camera `swap` flips which one is large.
 * `gridFocus` is the camera someone clicked in the grid, as RoomShell's focusedIdentity.
 */
export function useDemoFocus(screens: ReadonlyMap<string, MediaStream>, cameras: ReadonlyMap<string, MediaStream>) {
    const [selected, setSelected] = useState<string | null>(null);
    const [gridFocus, setGridFocus] = useState<string | null>(null);
    const [preferCameraId, setPreferCameraId] = useState<string | null>(null);
    const pinRef = useRef<FocusPin | null>(null);
    const previousRef = useRef<Set<string>>(new Set());

    const screenKeys = [...screens.keys()].join(',');
    useEffect(() => {
        const now = new Set(screens.keys());
        const appeared = [...now].filter(id => !previousRef.current.has(id));
        const ended = [...previousRef.current].filter(id => !now.has(id));
        previousRef.current = now;
        setSelected(current => {
            const next = nextFocus({
                current,
                pin: pinRef.current,
                own: MY_IDENTITY,
                shares: now,
                appeared,
                ended,
                isPresent: id => now.has(id) || cameras.has(id),
                fallback: null,
            });
            pinRef.current = next.pin;
            return next.selected;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screenKeys]);

    // A camera focused from the grid goes back to the grid once it turns off.
    const hasGridFocus = !!gridFocus && (cameras.has(gridFocus) || screens.has(gridFocus));
    useEffect(() => {
        if (gridFocus && !hasGridFocus) setGridFocus(null);
    }, [gridFocus, hasGridFocus]);

    const viewOf = (identity: string | null): DemoFocusView | null => {
        if (!identity) return null;
        const screen = screens.has(identity), camera = cameras.has(identity);
        if (screen && camera && preferCameraId === identity) return { identity, type: 'camera' };
        if (screen) return { identity, type: 'screen' };
        if (camera) return { identity, type: 'camera' };
        return null;
    };
    const firstScreen = screens.keys().next().value;
    const focused = viewOf(selected ?? gridFocus) ?? (firstScreen ? { identity: firstScreen, type: 'screen' as const } : null);
    const pip: DemoFocusView | null = focused && (focused.type === 'screen' ? cameras.has(focused.identity) : screens.has(focused.identity))
        ? { identity: focused.identity, type: focused.type === 'screen' ? 'camera' : 'screen' }
        : null;

    const pin = (identity: string) => {
        pinRef.current = { identity, wasSharing: screens.has(identity) };
        setSelected(identity);
    };
    return {
        /** Whether the call shows the focus layout instead of the grid. */
        active: screens.size > 0 || (hasGridFocus && !!focused),
        focused,
        pip,
        pin,
        focusFromGrid: (identity: string) => { setGridFocus(identity); pin(identity); },
        swap: () => setPreferCameraId(current => current === focused?.identity ? null : focused?.identity ?? null),
        /** Back to the grid; only offered when nothing is shared, as in a call. */
        exit: hasGridFocus && screens.size === 0 ? () => { setGridFocus(null); pinRef.current = null; setSelected(null); } : undefined,
    };
}
