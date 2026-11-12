import { useState, useCallback, useEffect, useLayoutEffect } from 'react';

interface Route {
    path: string;
    /** Extracted room ID when path is /room/:id, otherwise null */
    roomId: string | null;
    /** The text chat at /chat/:id, or the rules at /rules (outside a call). */
    text: { kind: 'chat'; id: string } | { kind: 'rules' } | null;
    /** Password from URL hash fragment (#pw=...), null if absent */
    hashPassword: string | null;
    navigate: (to: string) => void;
}

/** The app's own path prefix, '' unless the build sets a base (the demo on GitHub Pages does). */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
/** The location's path within the app, so routes read the same under any base. */
const appPath = () => window.location.pathname.slice(BASE.length) || '/';

function parseRoomId(pathname: string): string | null {
    const m = pathname.match(/^\/room\/([a-zA-Z0-9_-]+)$/);
    return m ? m[1] : null;
}

function parseText(pathname: string): Route['text'] {
    if (pathname === '/rules') return { kind: 'rules' };
    const m = pathname.match(/^\/chat\/([a-zA-Z0-9_-]+)$/);
    return m ? { kind: 'chat', id: m[1] } : null;
}

function parseHashPassword(hash: string): string | null {
    if (!hash || !hash.startsWith('#')) return null;
    const params = new URLSearchParams(hash.slice(1));
    return params.get('pw');
}


export function useRoute(): Route {
    const [path, setPath] = useState(appPath);
    // The password from an invite link, good for the room in that same link only.
    const [invite] = useState(() => ({
        roomId: parseRoomId(appPath()),
        password: parseHashPassword(window.location.hash),
    }));

    // Strip password from URL before first paint (don't leak in address bar / screen share)
    useLayoutEffect(() => {
        if (invite.password && window.location.hash) {
            window.history.replaceState(null, '', window.location.pathname);
        }
    }, [invite]);

    useEffect(() => {
        const handler = () => setPath(appPath());
        window.addEventListener('popstate', handler);
        return () => window.removeEventListener('popstate', handler);
    }, []);

    const navigate = useCallback((to: string) => {
        window.history.pushState(null, '', BASE + to);
        setPath(to);
    }, []);

    const roomId = parseRoomId(path);
    return { path, roomId, text: parseText(path), hashPassword: roomId && roomId === invite.roomId ? invite.password : null, navigate };
}
