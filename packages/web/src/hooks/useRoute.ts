import { useState, useCallback, useEffect, useLayoutEffect } from 'react';

interface Route {
    path: string;
    /** Extracted room ID when path is /room/:id, otherwise null */
    roomId: string | null;
    /** Password from URL hash fragment (#pw=...), null if absent */
    hashPassword: string | null;
    navigate: (to: string) => void;
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
    // The password from an invite link, good for the room in that same link only.
    const [invite] = useState(() => ({
        roomId: parseRoomId(window.location.pathname),
        password: parseHashPassword(window.location.hash),
    }));

    // Strip password from URL before first paint (don't leak in address bar / screen share)
    useLayoutEffect(() => {
        if (invite.password && window.location.hash) {
            window.history.replaceState(null, '', window.location.pathname);
        }
    }, [invite]);

    useEffect(() => {
        const handler = () => setPath(window.location.pathname);
        window.addEventListener('popstate', handler);
        return () => window.removeEventListener('popstate', handler);
    }, []);

    const navigate = useCallback((to: string) => {
        window.history.pushState(null, '', to);
        setPath(to);
    }, []);

    const roomId = parseRoomId(path);
    return { path, roomId, hashPassword: roomId && roomId === invite.roomId ? invite.password : null, navigate };
}
