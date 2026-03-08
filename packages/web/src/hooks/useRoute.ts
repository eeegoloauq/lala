import { useState, useCallback, useEffect } from 'react';

interface Route {
    path: string;
    /** Extracted room ID when path is /room/:id, otherwise null */
    roomId: string | null;
    navigate: (to: string) => void;
    replace: (to: string) => void;
}

function parseRoomId(pathname: string): string | null {
    const m = pathname.match(/^\/room\/([a-zA-Z0-9_-]+)$/);
    return m ? m[1] : null;
}


export function useRoute(): Route {
    const [path, setPath] = useState(window.location.pathname);

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

    return { path, roomId: parseRoomId(path), navigate, replace };
}
