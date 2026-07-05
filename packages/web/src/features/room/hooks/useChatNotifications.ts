import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import type { ReceivedChatMessage } from '@livekit/components-react';
import { playChatSound } from '../../../lib/sounds';
import { speak } from '../../../lib/tts';
import { ttsOptsFromSettings } from '../lib/ttsOpts';
import type { AppSettings } from '../../settings/types';

export interface UseChatNotificationsResult {
    unreadCount: number;
    /** Call when the chat panel is opened to clear the unread badge. */
    resetUnread: () => void;
}

/**
 * Tracks unread chat messages (badge count, mirrored to the Electron dock badge),
 * plays the incoming-chat sound, and speaks new messages via TTS.
 */
export function useChatNotifications(
    settings: AppSettings,
    messages: ReceivedChatMessage[],
    chatOpen: boolean,
    localParticipantIdentity: string,
    t: TFunction,
): UseChatNotificationsResult {
    const [unreadCount, setUnreadCount] = useState(0);
    const prevMsgCountRef = useRef(0);

    // Keep settings in a ref so this effect doesn't need to re-run on every settings change
    const settingsRef = useRef(settings);
    useEffect(() => { settingsRef.current = settings; });

    // Track unread messages, play sounds, TTS
    useEffect(() => {
        const newMsgs = messages.slice(prevMsgCountRef.current);
        const s = settingsRef.current;
        const incoming = newMsgs.filter((m) => m.from?.identity !== localParticipantIdentity);
        const allNew = s.ttsReadOwn ? newMsgs : incoming;

        if (incoming.length > 0) {
            if (!chatOpen) setUnreadCount((c) => c + incoming.length);
            if (s.soundChat ?? true) playChatSound();
        }
        if (s.chatTTS && allNew.length > 0) {
            for (const m of allNew) {
                const sender = m.from?.name || m.from?.identity || t('system.someone');
                speak(`${sender}: ${m.message}`, ttsOptsFromSettings(s));
            }
        }
        prevMsgCountRef.current = messages.length;
    }, [messages, localParticipantIdentity, chatOpen]);

    // Sync unread count to Electron badge
    useEffect(() => {
        window.electronAPI?.setBadgeCount?.(unreadCount);
    }, [unreadCount]);

    const resetUnread = useCallback(() => setUnreadCount(0), []);

    return { unreadCount, resetUnread };
}
