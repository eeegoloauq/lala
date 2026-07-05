import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import type { ReceivedChatMessage } from '@livekit/components-react';
import { playChatSound } from '../../../lib/sounds';
import { speak } from '../../../lib/tts';
import { ttsOptsFromSettings } from '../lib/ttsOpts';
import type { AppSettings } from '../../settings/types';
import type { FileTransferItem } from '../../../lib/fileTransfer';

export interface UseChatNotificationsResult {
    unreadCount: number;
    /** Call when the chat panel is opened to clear the unread badge. */
    resetUnread: () => void;
}

/**
 * Tracks unread chat messages (badge count, mirrored to the Electron dock badge),
 * plays the incoming-chat sound, and speaks new messages via TTS. Incoming file
 * transfers are folded into the same notification pipeline — counted in the unread
 * badge and announced by TTS as "<name> sent a file" (never the filename, which
 * could be attacker-controlled text read aloud).
 */
export function useChatNotifications(
    settings: AppSettings,
    messages: ReceivedChatMessage[],
    chatOpen: boolean,
    localParticipantIdentity: string,
    t: TFunction,
    fileTransfers: FileTransferItem[] = [],
): UseChatNotificationsResult {
    const [unreadCount, setUnreadCount] = useState(0);
    const prevMsgCountRef = useRef(0);
    const prevFileCountRef = useRef(0);

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

    // Same pipeline for incoming file transfers, keyed off first appearance (not progress/status
    // updates) so a single file only ever notifies once.
    useEffect(() => {
        const incomingFiles = fileTransfers.filter((f) => f.direction === 'in');
        const newFiles = incomingFiles.slice(prevFileCountRef.current);
        const s = settingsRef.current;

        if (newFiles.length > 0) {
            if (!chatOpen) setUnreadCount((c) => c + newFiles.length);
            if (s.soundChat ?? true) playChatSound();
            if (s.chatTTS) {
                for (const f of newFiles) {
                    speak(t('chat.fileSent', { name: f.displayName }), ttsOptsFromSettings(s));
                }
            }
        }
        prevFileCountRef.current = incomingFiles.length;
    }, [fileTransfers, chatOpen, t]);

    // Sync unread count to Electron badge
    useEffect(() => {
        window.electronAPI?.setBadgeCount?.(unreadCount);
    }, [unreadCount]);

    const resetUnread = useCallback(() => setUnreadCount(0), []);

    return { unreadCount, resetUnread };
}
