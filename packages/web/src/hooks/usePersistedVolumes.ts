import { useState, useCallback, useEffect, useRef } from 'react';
import { safeJsonParse } from '../lib/utils';

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEBOUNCE_MS = 400;

interface StoredEntry {
    vol: number;
    t: number;
}

function load(storageKey: string): Map<string, number> {
    const data = safeJsonParse<Record<string, StoredEntry>>(localStorage.getItem(storageKey), {});
    const cutoff = Date.now() - TTL_MS;
    const map = new Map<string, number>();
    for (const [id, entry] of Object.entries(data)) {
        if (entry?.t > cutoff) map.set(id, entry.vol);
    }
    return map;
}

function save(storageKey: string, volumes: Map<string, number>) {
    try {
        const existing: Record<string, StoredEntry> = safeJsonParse(localStorage.getItem(storageKey), {});
        const now = Date.now();
        for (const [id, vol] of volumes) {
            existing[id] = { vol, t: now };
        }
        localStorage.setItem(storageKey, JSON.stringify(existing));
    } catch { /* storage full or blocked */ }
}

export function usePersistedVolumes(storageKey = 'lala_volumes') {
    const [volumes, setVolumes] = useState<Map<string, number>>(() => load(storageKey));
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const keyRef = useRef(storageKey);

    const persistVolumes = useCallback((map: Map<string, number>) => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => save(keyRef.current, map), DEBOUNCE_MS);
    }, []);

    const handleVolumeChange = useCallback((identity: string, vol: number) => {
        setVolumes(prev => {
            const next = new Map(prev).set(identity, vol);
            persistVolumes(next);
            return next;
        });
    }, [persistVolumes]);

    const reset = useCallback(() => {
        setVolumes(new Map());
        localStorage.removeItem(keyRef.current);
    }, []);

    useEffect(() => {
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, []);

    return { volumes, handleVolumeChange, reset };
}
