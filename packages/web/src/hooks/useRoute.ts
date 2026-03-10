import { useState, useCallback, useEffect, useLayoutEffect } from 'react';

interface Route {
    path: string;
    /** Extracted room ID when path is /room/:id, otherwise null */
    roomId: string | null;
    /** Password from URL hash fragment (#pw=...), null if absent */
    hashPassword: string | null;
    navigate: (to: string) => void;
    replace: (to: string) => void;
}

function parseRoomId(pathname: string): string | null {
    const m = pathname.match(/^\/room\/([a-zA-Z0-9_-]+)$/);
    return m ? m[1] : null;
}

function parseHashPassword(hash: string): string | null {
    if (!hash || !hash.startsWith('#')) return null;
    const params = new URLSearchParams(hash.slice(1));
    return params.get('pw');
}


export function useRoute(): Route {
    const [path, setPath] = useState(window.location.pathname);
    const [hashPassword, setHashPassword] = useState(() => parseHashPassword(window.location.hash));

    // Strip password from URL before first paint (don't leak in address bar / screen share)
    useLayoutEffect(() => {
        if (hashPassword && window.location.hash) {
            window.history.replaceState(null, '', window.location.pathname);
        }
    }, [hashPassword]);

    // Clear hash password when navigating away from the room it was intended for
    useEffect(() => {
        if (hashPassword && !parseRoomId(path)) {
            setHashPassword(null);
        }
    }, [path]);

    useEffect(() => {
        const handler = () => setPath(window.location.pathname);
        window.addEventListener('popstate', handler);
        return () => window.removeEventListener('popstate', handler);
    }, []);

    const navigate = useCallback((to: string) => {
        window.history.pushState(null, '', to);
        setPath(to);
    }, []);

    const replace = useCallback((to: string) => {
        window.history.replaceState(null, '', to);
        setPath(to);
    }, []);

    return { path, roomId: parseRoomId(path), hashPassword, navigate, replace };
}
