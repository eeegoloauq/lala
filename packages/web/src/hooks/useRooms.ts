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
        const es = new EventSource('/api/events');

        // Fetch on every room change event from LiveKit webhook
        es.addEventListener('rooms_updated', () => fetchRooms());

        // Re-fetch when SSE reconnects (may have missed events while disconnected)
        es.addEventListener('connected', () => fetchRooms());

        return () => es.close();
    }, [fetchRooms]);

    return { rooms, loading, error, addRoom, refresh: fetchRooms };
}
