import { useSyncExternalStore } from 'react';
import { createStore } from './store';
import type { ChatMessage } from './types';
import { playChatSound } from './sounds';
import { IS_ELECTRON } from './env';
import { plainText } from './chatMarkup';

/**
 * What a text chat tells you about, chosen per chat from its menu (Discord's model):
 * - `mentions` (the default): new messages mark the chat unread; a sound and a desktop
 *   notification only when someone mentions you or answers your message.
 * - `all`: a notification for every message.
 * - `none`: no unread mark and no notification; a mention still shows its quiet badge.
 * Do Not Disturb silences all of it, and the chat on screen never notifies. Kept on this
 * device only (`lala_chat_notify`).
 */
export type NotifyLevel = 'all' | 'mentions' | 'none';
export const NOTIFY_LEVELS: NotifyLevel[] = ['all', 'mentions', 'none'];
const KEY = 'lala_chat_notify';

function load(): Record<string, NotifyLevel> {
    try {
        const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

const levels = createStore<Record<string, NotifyLevel>>(load());

export const notifyLevel = (channel: string): NotifyLevel => levels.get()[channel] ?? 'mentions';
export const useNotifyLevel = (channel: string) => useSyncExternalStore(levels.subscribe, () => notifyLevel(channel));
export const useNotifyLevels = () => useSyncExternalStore(levels.subscribe, levels.get);

export function setNotifyLevel(channel: string, level: NotifyLevel): void {
    const next = { ...levels.get(), [channel]: level };
    if (level === 'mentions') delete next[channel];
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: lasts until reload */ }
    levels.set(next);
}

/** What the rest of the app knows and this module needs; set by App. */
interface NotifyContext {
    me?: string;
    sound: boolean;
    desktop: boolean;
    doNotDisturb: boolean;
    /** Opens the chat when its notification is clicked. */
    open: (channel: string) => void;
    /** A chat's name, for the notification's title. */
    channelName: (channel: string) => string | undefined;
    /** A person's current name, for mentions in the preview. */
    personName: (identity: string) => string | undefined;
}
let context: NotifyContext = { sound: true, desktop: true, doNotDisturb: false, open: () => {}, channelName: () => undefined, personName: () => undefined };
export const setNotifyContext = (next: NotifyContext) => { context = next; };

/** The chat on screen right now (a feed mounts it, and clears it when it goes). */
let viewing: string | null = null;
export const setViewingChannel = (channel: string | null) => { viewing = channel; };

/** Whether desktop notifications can show: the desktop app always, a browser once allowed. */
export const desktopNotificationsAllowed = () =>
    IS_ELECTRON || (typeof Notification !== 'undefined' && Notification.permission === 'granted');

/** Asks the browser, from a click (browsers only ask then); true when they may show. */
export async function askForDesktopNotifications(): Promise<boolean> {
    if (IS_ELECTRON) return true;
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'default') await Notification.requestPermission();
    return Notification.permission === 'granted';
}

/** A new message from someone else arrived: sound and notification, if this chat's level and the moment allow. */
export function notifyIncoming(message: ChatMessage, mentionsMe: boolean): void {
    const level = notifyLevel(message.channel);
    const forMe = mentionsMe || message.reply?.identity === context.me;
    if (level === 'none' || (level === 'mentions' && !forMe) || context.doNotDisturb) return;
    const onScreen = viewing === message.channel && document.visibilityState === 'visible' && document.hasFocus();
    if (onScreen) return;

    if (context.sound) playChatSound();
    if (!context.desktop || !desktopNotificationsAllowed()) return;
    const where = context.channelName(message.channel);
    try {
        const n = new Notification(where ? `${message.name} · #${where}` : message.name, {
            body: (plainText(message.text, id => context.personName(id) ?? '…') || (message.attachments?.length ? '📎' : '')).slice(0, 180),
            // One per chat at a time: a busy chat replaces its notification instead of stacking.
            tag: `lala-chat-${message.channel}`,
        });
        n.onclick = () => {
            window.focus();
            context.open(message.channel);
            n.close();
        };
    } catch {
        // Some browsers allow notifications only from a service worker; the sound was enough.
    }
}
