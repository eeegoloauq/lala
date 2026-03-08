import { useMemo } from 'react';
import { useChat } from '@livekit/components-react';

export function useRoomChat() {
    const { chatMessages, send, isSending } = useChat();

    // LiveKit can deliver your own message back as an echo — deduplicate by id.
    const messages = useMemo(() => {
        const seen = new Set<string>();
        return chatMessages.filter(m => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
        });
    }, [chatMessages]);

    return { messages, send, isSending };
}
