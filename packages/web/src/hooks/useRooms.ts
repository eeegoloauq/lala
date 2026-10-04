import { useState, useEffect, useCallback } from 'react';
import type { RoomInfo, CreateRoomRequest } from '../lib/types';
import { getRooms, createRoom } from '../lib/api';

export function useRooms() {
    const [rooms, setRooms] = useState<RoomInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchRooms = useCallback(async () => {
        try {
            const data = await getRooms();
            setRooms(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch rooms');
        } finally {
            setLoading(false);
        }
    }, []);

    const addRoom = useCallback(async (request: CreateRoomRequest): Promise<RoomInfo> => {
        const room = await createRoom(request);
        await fetchRooms();
        return room;
    }, [fetchRooms]);

    useEffect(() => {
        // Initial load
        fetchRooms();

        // Real-time updates via SSE — no polling
        let es: EventSource;
        let retry: ReturnType<typeof setTimeout> | undefined;
        const connect = () => {
            es = new EventSource('/api/events');

            // Fetch on every room change event from LiveKit webhook
            es.addEventListener('rooms_updated', () => fetchRooms());

            // Re-fetch when SSE reconnects (may have missed events while disconnected)
            // Server sends custom 'connected' event on each new SSE connection
            es.addEventListener('connected', () => fetchRooms());

            // EventSource retries dropped connections by itself, but a non-200 answer
            // (502 while the API restarts, 401 after the instance password changed)
            // closes it for good. Reopen it ourselves, and make a plain request so a
            // 401 reaches AccessGate.
            es.addEventListener('error', () => {
                setError('server_unavailable');
                if (es.readyState === EventSource.CLOSED) {
                    fetchRooms();
                    retry = setTimeout(connect, 5000);
                }
            });
        };
        connect();

        return () => {
            clearTimeout(retry);
            es.close();
        };
    }, [fetchRooms]);

    return { rooms, loading, error, addRoom, refresh: fetchRooms };
}
