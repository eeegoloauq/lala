import { useState, useCallback, useEffect } from 'react';
import { STORAGE_KEYS } from '../lib/constants';

/**
 * Hook for persisting the user's display name in localStorage.
 */
export function useDisplayName() {
    const [displayName, setDisplayName] = useState<string>(() => {
        return localStorage.getItem(STORAGE_KEYS.displayName) || '';
    });

    const updateName = useCallback((name: string) => {
        setDisplayName(name);
        localStorage.setItem(STORAGE_KEYS.displayName, name);
    }, []);

    return { displayName, setDisplayName: updateName };
}
