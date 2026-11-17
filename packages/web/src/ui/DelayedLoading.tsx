import { useEffect, useState, type ReactNode } from 'react';

const LOADING_DELAY_MS = 500;

/** Mount while waiting. Fast requests finish before their loading indicator appears. */
export function DelayedLoading({ children }: { children: ReactNode }) {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setVisible(true), LOADING_DELAY_MS);
        return () => clearTimeout(timer);
    }, []);
    return visible ? children : null;
}
