import { useEffect, useState } from 'react';
import { ConnectionState } from 'livekit-client';

/** Debounces the "reconnecting" banner so sub-second hiccups don't cause a flash. */
export function useReconnectingBanner(connectionState: ConnectionState): boolean {
    const [showReconnecting, setShowReconnecting] = useState(false);

    useEffect(() => {
        if (connectionState === ConnectionState.Reconnecting) {
            const id = setTimeout(() => setShowReconnecting(true), 1500);
            return () => clearTimeout(id);
        }
        setShowReconnecting(false);
    }, [connectionState]);

    return showReconnecting;
}
