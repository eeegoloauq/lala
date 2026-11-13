import { useMemo, useSyncExternalStore } from 'react';
import { createStore } from './store';
import { notifyIncoming, useNotifyLevels } from './chatNotify';
import type { ChatEvent, ChatMessage, ServerRules, TextChannel } from './types';
import { ApiError } from './types';
import { acceptRules, deleteMessage, getChannels, getMessages, getPins, sendMessage, setPinned, setReaction, uploadChatFile } from './api';

/** Messages of one chat that this client has loaded: a contiguous run ending at the newest. */
export interface ChannelHistory {
    messages: ChatMessage[];
    /** Whether the server has older ones. */
    more: boolean;
    loading: boolean;
    /** Why the newest page did not load: the server refused, or the request failed. */
    error?: 'forbidden' | 'failed';
}

interface TextChatState {
    /** Null until the first answer, or when the server has no text chats. */
    channels: TextChannel[] | null;
    rules?: ServerRules;
    mentions: Array<{ channel: string; id: string }>;
    /** The last message ID read in each chat; kept on this device only. */
    read: Record<string, string>;
    history: Record<string, ChannelHistory>;
    /** Each chat's pinned messages, once looked at. */
    pins: Record<string, ChatMessage[]>;
    /** The message to bring into view and highlight, after a jump to it. */
    focus: { channel: string; id: string; at: number } | null;
    /** The chat shown in a call's chat panel instead of the call's own chat. */
    openInCall: string | null;
}

const READ_KEY = 'lala_chat_read';
const PAGE = 50;

function loadRead(): Record<string, string> {
    try {
        const parsed = JSON.parse(localStorage.getItem(READ_KEY) ?? '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

const store = createStore<TextChatState>({ channels: null, mentions: [], read: loadRead(), history: {}, pins: {}, focus: null, openInCall: null });
const update = (patch: Partial<TextChatState>) => store.set({ ...store.get(), ...patch });

/** Orders message IDs (`<ms>-<seq>`, as Redis stream IDs are) by time. */
export function compareIds(a: string, b: string): number {
    const [am, as = '0'] = a.split('-');
    const [bm, bs = '0'] = b.split('-');
    return Number(am) - Number(bm) || Number(as) - Number(bs);
}

const after = (id: string | undefined, than: string | undefined) => !!id && (!than || compareIds(id, than) > 0);

export async function loadChannels(): Promise<void> {
    try {
        const { channels, rules, mentions } = await getChannels();
        update({ channels, rules, mentions });
    } catch (err) {
        // An older API that claims chats but has no route answers 404: the app shows none.
        if (err instanceof ApiError && err.status === 404) update({ channels: [], rules: undefined, mentions: [] });
        else if (!(err instanceof ApiError && err.code === 'rules_required')) console.warn('[textChat] Loading chats failed:', err);
    }
}

/** After the event stream was away: drop what may have missed events; open chats load again. */
export function resyncChat(): void {
    update({ history: {}, pins: {} });
    loadChannels();
}

function setHistory(channel: string, history: ChannelHistory) {
    update({ history: { ...store.get().history, [channel]: history } });
}

/** Loads the newest page the first time a chat opens. */
export async function openChannel(channel: string): Promise<void> {
    if (store.get().history[channel]) return;
    setHistory(channel, { messages: [], more: false, loading: true });
    try {
        const { messages, more } = await getMessages(channel, undefined, PAGE);
        setHistory(channel, { messages, more, loading: false });
    } catch (err) {
        console.warn('[textChat] Loading messages failed:', err);
        // Kept, not dropped: an empty entry would make the open chat ask again at once.
        const error = err instanceof ApiError && err.status === 403 ? 'forbidden' : 'failed';
        setHistory(channel, { messages: [], more: false, loading: false, error });
    }
}

/** Asks for a chat's newest page again after it failed to load. */
export function retryChannel(channel: string): void {
    const next = { ...store.get().history };
    delete next[channel];
    update({ history: next });
}

/** Pages being loaded, so a second call waits for the same one. */
const loadingOlder = new Map<string, Promise<void>>();

/** The page before the oldest loaded message. */
export function loadOlder(channel: string): Promise<void> {
    const inFlight = loadingOlder.get(channel);
    if (inFlight) return inFlight;
    const current = store.get().history[channel];
    if (!current || !current.more) return Promise.resolve();
    setHistory(channel, { ...current, loading: true });
    const run = (async () => {
        try {
            const { messages, more } = await getMessages(channel, current.messages[0]?.id, PAGE);
            const now = store.get().history[channel] ?? current;
            setHistory(channel, { messages: [...messages, ...now.messages], more, loading: false });
        } catch (err) {
            console.warn('[textChat] Loading older messages failed:', err);
            setHistory(channel, { ...(store.get().history[channel] ?? current), loading: false });
        } finally {
            loadingOlder.delete(channel);
        }
    })();
    loadingOlder.set(channel, run);
    return run;
}

/** Applies an event from the server (the event stream, or the demo's own). */
export function applyChatEvent(event: ChatEvent): void {
    const state = store.get();
    if (event.type === 'chat_message') {
        const { message } = event;
        const channels = state.channels?.map(c => c.id === message.channel && after(message.id, c.lastMessageId) ? { ...c, lastMessageId: message.id } : c) ?? null;
        const history = state.history[message.channel];
        const patch: Partial<TextChatState> = { channels };
        if (history && !history.messages.some(m => m.id === message.id)) {
            patch.history = { ...state.history, [message.channel]: { ...history, messages: [...history.messages, message] } };
        }
        const fromOther = message.identity !== myIdentity;
        const mentionsMe = !!myIdentity && mentionsOf(message.text).has(myIdentity);
        if (mentionsMe && fromOther) {
            patch.mentions = [...state.mentions, { channel: message.channel, id: message.id }].slice(-50);
        }
        const isNew = !history?.messages.some(m => m.id === message.id);
        update(patch);
        if (fromOther && isNew) notifyIncoming(message, mentionsMe);
        return;
    }
    if (event.type === 'chat_pinned') {
        const { message } = event;
        const history = state.history[event.channel];
        const pins = state.pins[event.channel];
        update({
            history: history ? { ...state.history, [event.channel]: { ...history, messages: history.messages.map(m => m.id === message.id ? { ...m, pinned: message.pinned } : m) } } : state.history,
            pins: pins ? { ...state.pins, [event.channel]: message.pinned ? [message, ...pins.filter(m => m.id !== message.id)] : pins.filter(m => m.id !== message.id) } : state.pins,
        });
        return;
    }
    const history = state.history[event.channel];
    const pins = state.pins[event.channel];
    if (event.type === 'chat_deleted' && pins) update({ pins: { ...state.pins, [event.channel]: pins.filter(m => m.id !== event.id) } });
    if (!history) {
        if (event.type === 'chat_deleted') update({ mentions: state.mentions.filter(m => m.id !== event.id) });
        return;
    }
    const messages = event.type === 'chat_deleted'
        ? history.messages.filter(m => m.id !== event.id)
        : history.messages.map(m => m.id === event.id ? { ...m, reactions: event.reactions } : m);
    update({
        history: { ...state.history, [event.channel]: { ...history, messages } },
        mentions: event.type === 'chat_deleted' ? state.mentions.filter(m => m.id !== event.id) : state.mentions,
    });
}

let myIdentity: string | undefined;
/** Whose mentions count as "you"; set from /api/me. */
export const setChatIdentity = (identity: string | undefined) => { myIdentity = identity; };

/** Everyone a message mentions. */
export function mentionsOf(text: string): Set<string> {
    return new Set(Array.from(text.matchAll(/<@([A-Za-z0-9_-]{1,64})>/g), m => m[1]));
}

export function markRead(channel: string, id: string | undefined): void {
    const state = store.get();
    if (!id || !after(id, state.read[channel])) return;
    const read = { ...state.read, [channel]: id };
    try { localStorage.setItem(READ_KEY, JSON.stringify(read)); } catch { /* private mode: unread resets on reload */ }
    update({ read });
}

export interface OutgoingFile { file: File; spoiler: boolean }

/** Uploads the files, then sends the message that carries them. */
export async function postMessage(channel: string, text: string, files: OutgoingFile[], replyTo?: string): Promise<void> {
    const uploaded = await Promise.all(files.map(async f => ({ id: (await uploadChatFile(channel, f.file)).id, spoiler: f.spoiler || undefined })));
    const message = await sendMessage(channel, { text, attachments: uploaded.length ? uploaded : undefined, replyTo });
    applyChatEvent({ type: 'chat_message', message });
    markRead(channel, message.id);
}

export async function removeMessage(channel: string, id: string): Promise<void> {
    await deleteMessage(channel, id);
    applyChatEvent({ type: 'chat_deleted', channel, id });
}

export async function toggleReaction(channel: string, message: ChatMessage, emoji: string): Promise<void> {
    if (!myIdentity) return;
    const who = message.reactions?.[emoji] ?? [];
    const on = !who.includes(myIdentity);
    // Shown at once; the server's event confirms it, or the reload after an error undoes it.
    const reactions = { ...message.reactions, [emoji]: on ? [...who, myIdentity] : who.filter(i => i !== myIdentity) };
    if (reactions[emoji].length === 0) delete reactions[emoji];
    applyChatEvent({ type: 'chat_reactions', channel, id: message.id, reactions });
    try {
        await setReaction(channel, message.id, emoji, on);
    } catch (err) {
        applyChatEvent({ type: 'chat_reactions', channel, id: message.id, reactions: message.reactions ?? {} });
        throw err;
    }
}

export async function loadPins(channel: string): Promise<void> {
    try {
        const messages = await getPins(channel);
        update({ pins: { ...store.get().pins, [channel]: messages } });
    } catch (err) {
        console.warn('[textChat] Loading pins failed:', err);
    }
}

export async function togglePin(channel: string, message: ChatMessage): Promise<void> {
    const on = !message.pinned;
    await setPinned(channel, message.id, on);
    applyChatEvent({ type: 'chat_pinned', channel, message: { ...message, pinned: on } });
}

/** At most this many older pages are loaded looking for a message. */
const JUMP_PAGES = 40;

/**
 * Brings a message into view: loads older pages until it is there (the feed then scrolls
 * to it and highlights it). False when it's gone (deleted, or expired from the history).
 */
export async function jumpTo(channel: string, id: string): Promise<boolean> {
    const has = () => !!store.get().history[channel]?.messages.some(m => m.id === id);
    for (let page = 0; !has() && page < JUMP_PAGES; page++) {
        const history = store.get().history[channel];
        if (!history?.more) break;
        await loadOlder(channel);
    }
    if (!has()) return false;
    update({ focus: { channel, id, at: Date.now() } });
    return true;
}

export async function agreeToRules(): Promise<void> {
    const rules = store.get().rules;
    if (!rules) return;
    await acceptRules(rules.version);
    update({ rules: { ...rules, accepted: true } });
}

/** What `openInCall` takes to show the rules in the call's panel. */
export const RULES_IN_CALL = ':rules';

/** Shows a chat (or the rules) in the call's chat panel; null: the call's own chat again. */
export const openInCall = (channel: string | null) => update({ openInCall: channel });

const useTextChat = () => useSyncExternalStore(store.subscribe, store.get);

export const useChannels = () => useSyncExternalStore(store.subscribe, () => store.get().channels);
export const useRules = () => useSyncExternalStore(store.subscribe, () => store.get().rules);
export const useFocusTarget = () => useSyncExternalStore(store.subscribe, () => store.get().focus);
export const usePins = (channel: string) => useSyncExternalStore(store.subscribe, () => store.get().pins[channel]);
export const useOpenInCall = () => useSyncExternalStore(store.subscribe, () => store.get().openInCall);

export function useHistory(channel: string): ChannelHistory | undefined {
    return useSyncExternalStore(store.subscribe, () => store.get().history[channel]);
}

/** Per chat: whether something is unread, and how many unread messages mention you. */
export function useUnread(): Map<string, { unread: boolean; mentions: number }> {
    const state = useTextChat();
    const levels = useNotifyLevels();
    return useMemo(() => {
        const result = new Map<string, { unread: boolean; mentions: number }>();
        for (const c of state.channels ?? []) {
            const read = state.read[c.id];
            result.set(c.id, {
                // A chat set to "Nothing" never shows as unread; its mentions still count.
                unread: (levels[c.id] ?? 'mentions') !== 'none' && after(c.lastMessageId, read),
                mentions: state.mentions.filter(m => m.channel === c.id && after(m.id, read)).length,
            });
        }
        return result;
    }, [state.channels, state.read, state.mentions, levels]);
}

/** True when the rules must be agreed to before anything else. */
export function useRulesPending(): boolean {
    const rules = useRules();
    return !!rules?.required && !rules.accepted;
}
