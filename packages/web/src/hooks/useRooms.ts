import { useState, useEffect, useCallback, useRef } from 'react';
import type { RoomInfo, CreateRoomRequest } from '../lib/types';
import { getRooms, createRoom, getPresenceTicket } from '../lib/api';
import { presenceChanged } from '../lib/presence';
import { IS_DEMO } from '../lib/env';
import { applyChatEvent, resyncChat } from '../lib/textChat';
import type { ChatEvent } from '../lib/types';

export function useRooms() {
    const [rooms, setRooms] = useState<RoomInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // A burst of room events must not become a burst of requests: while one fetch is in
    // flight, later calls share it and trigger a single refetch once it settles.
    const pending = useRef<Promise<void> | null>(null);
    const stale = useRef(false);

    const fetchRooms = useCallback((): Promise<void> => {
        if (pending.current) {
            stale.current = true;
            return pending.current;
        }
        const run = async () => {
            do {
                stale.current = false;
                try {
                    setRooms(await getRooms());
                    setError(null);
                } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to fetch rooms');
                }
            } while (stale.current);
            setLoading(false);
            pending.current = null;
        };
        pending.current = run();
        return pending.current;
    }, []);

    const addRoom = useCallback(async (request: CreateRoomRequest): Promise<RoomInfo> => {
        const room = await createRoom(request);
        await fetchRooms();
        return room;
    }, [fetchRooms]);

    useEffect(() => {
        // Initial load
        fetchRooms();

        // The demo answers the API in the page and announces room changes the same way.
        if (IS_DEMO) {
            let unsubscribe: (() => void) | undefined;
            let active = true;
            import('../features/demo/server').then(demo => {
                if (active) unsubscribe = demo.onRoomsChanged(() => fetchRooms());
            });
            return () => { active = false; unsubscribe?.(); };
        }

        // Real-time updates via SSE — no polling. The stream opens with a presence ticket,
        // which keeps this device online while it is open; without one (a server that
        // turns this device away) it still carries room changes.
        let es: EventSource | undefined;
        let retry: ReturnType<typeof setTimeout> | undefined;
        let active = true;
        let connectedOnce = false;
        const connect = async () => {
            const ticket = await getPresenceTicket().catch(() => undefined);
            if (!active) return;
            es = new EventSource(ticket ? `/api/events?ticket=${encodeURIComponent(ticket)}` : '/api/events');
            const stream = es;

            es.addEventListener('presence_updated', () => presenceChanged());

            // Fetch on every room change event from LiveKit webhook
            es.addEventListener('rooms_updated', () => fetchRooms());

            // Re-fetch when SSE reconnects (may have missed events while disconnected)
            // Server sends custom 'connected' event on each new SSE connection
            es.addEventListener('connected', () => fetchRooms());

            // EventSource retries dropped connections by itself, but a non-200 answer
            // (502 while the API restarts, 401 after the instance password changed or
            // for a ticket that expired meanwhile) closes it for good. Reopen it
            // ourselves with a new ticket, and make a plain request so a 401 reaches
            // AccessGate.
            es.addEventListener('error', () => {
                setError('server_unavailable');
                if (stream.readyState === EventSource.CLOSED) {
                    fetchRooms();
                    retry = setTimeout(connect, 5000);
                }
            });
            // Presence changed while the stream was away.
            es.addEventListener('connected', () => presenceChanged());

            // Text chats: each event's data is the ChatEvent itself; a reconnect reloads.
            for (const type of ['chat_message', 'chat_deleted', 'chat_reactions'] as const) {
                es.addEventListener(type, (e) => {
                    try { applyChatEvent(JSON.parse((e as MessageEvent<string>).data) as ChatEvent); } catch { /* malformed: ignored */ }
                });
            }
            es.addEventListener('connected', () => { if (connectedOnce) resyncChat(); connectedOnce = true; });
        };
        connect();

        return () => {
            active = false;
            clearTimeout(retry);
            es?.close();
        };
    }, [fetchRooms]);

    return { rooms, loading, error, addRoom, refresh: fetchRooms };
}
