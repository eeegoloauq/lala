import { useCallback, useEffect, useRef, useState } from 'react';

/** A value that clears itself `ms` after it was last shown, for notices and "copied" marks. */
export function useTimedValue<T>(ms: number): [T | null, (value: T) => void, () => void] {
    const [value, setValue] = useState<T | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

    const show = useCallback((next: T) => {
        clearTimeout(timer.current);
        setValue(next);
        timer.current = setTimeout(() => setValue(null), ms);
    }, [ms]);

    const clear = useCallback(() => {
        clearTimeout(timer.current);
        setValue(null);
    }, []);

    useEffect(() => () => clearTimeout(timer.current), []);

    return [value, show, clear];
}
