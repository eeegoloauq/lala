import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../lib/types';
import { NOTIFY_LEVELS, setNotifyLevel, useNotifyLevel } from '../../lib/chatNotify';
import { markRead, removeMessage, toggleReaction, togglePin } from '../../lib/textChat';
import { plainText } from '../../lib/chatMarkup';
import { getRecentEmoji } from '../../lib/emoji';
import { usePresence } from '../../lib/presence';
import { useDismiss } from '../../hooks/useDismiss';
import { CheckIcon } from '../room/icons/Icons';
import '../room/VideoGrid/participant-context-menu.css';

/** Keeps a menu opened at a point inside the window, moving it up or left where it would not fit. */
function useMenuPosition(x: number, y: number) {
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ top: y, left: x });
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        setPos({
            top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
            left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
        });
    }, [x, y]);
    return { ref, style: { position: 'fixed' as const, ...pos } };
}

/** Right-click (long press) on a chat in the room list: mark it read, and what it tells you about. */
export function ChatContextMenu({ channel, name, lastMessageId, x, y, onClose }: {
    channel: string; name: string; lastMessageId?: string; x: number; y: number; onClose: () => void;
}) {
    const { t } = useTranslation();
    const { ref, style } = useMenuPosition(x, y);
    const level = useNotifyLevel(channel);
    useDismiss(ref, onClose);
    return createPortal(
        <div className="ctx-menu" style={style} ref={ref} role="menu" aria-label={`#${name}`}>
            <div className="ctx-menu-name">#{name}</div>
            <button className="ctx-menu-item" role="menuitem" onClick={() => { markRead(channel, lastMessageId); onClose(); }}>
                {t('chat.markRead')}
            </button>
            <div className="ctx-menu-admin" role="group" aria-label={t('chat.notify.title')}>
                <div className="ctx-menu-section">{t('chat.notify.title')}</div>
                {NOTIFY_LEVELS.map(l => (
                    <button
                        key={l}
                        className="ctx-menu-item ctx-menu-radio"
                        role="menuitemradio"
                        aria-checked={level === l}
                        onClick={() => { setNotifyLevel(channel, l); onClose(); }}
                    >
                        <span className="ctx-menu-check">{level === l && <CheckIcon size={13} strokeWidth={2.5} />}</span>
                        <span>
                            {t(`chat.notify.${l}`)}
                            {l === 'mentions' && <span className="ctx-menu-hint"> · {t('chat.notify.default')}</span>}
                        </span>
                    </button>
                ))}
            </div>
        </div>,
        document.body,
    );
}

const QUICK = ['👍', '😂', '❤️', '🔥', '👀', '🎉'];

/** Right-click (long press) on a message: quick reactions, then what can be done with it. */
export function MessageMenu({ message, x, y, myIdentity, canDelete, canPin, onReply, onMoreReactions, onClose }: {
    message: ChatMessage; x: number; y: number; myIdentity?: string; canDelete: boolean; canPin: boolean;
    onReply?: (message: ChatMessage) => void; onMoreReactions: () => void; onClose: () => void;
}) {
    const { t } = useTranslation();
    const presence = usePresence();
    const { ref, style } = useMenuPosition(x, y);
    const [confirmDelete, setConfirmDelete] = useState(false);
    useDismiss(ref, onClose);
    // The ones used last first, topped up with the usual few.
    const quick = [...new Set([...getRecentEmoji(), ...QUICK])].slice(0, 6);
    const react = (emoji: string) => { toggleReaction(message.channel, message, emoji).catch(() => {}); onClose(); };
    const copy = () => {
        // Mentions copy as names; the rest keeps its formatting marks, so it pastes back the same.
        const text = message.text.replace(/<@([A-Za-z0-9_-]{1,64})>/g, (_, id: string) => `@${presence?.get(id)?.name ?? id}`);
        navigator.clipboard?.writeText(text || plainText(message.text, () => '')).catch(() => {});
        onClose();
    };

    return createPortal(
        <div className="ctx-menu" style={style} ref={ref} role="menu" aria-label={t('chat.messageActions')}>
            <div className="ctx-menu-reactions" role="group" aria-label={t('chat.addReaction')}>
                {quick.map(e => {
                    const mine = !!myIdentity && !!message.reactions?.[e]?.includes(myIdentity);
                    return (
                        <button key={e} className={`ctx-menu-emoji${mine ? ' mine' : ''}`} onClick={() => react(e)} aria-pressed={mine} aria-label={e}>{e}</button>
                    );
                })}
                <button className="ctx-menu-emoji" onClick={() => { onMoreReactions(); onClose(); }} title={t('chat.addReaction')} aria-label={t('chat.moreReactions')}>＋</button>
            </div>
            {onReply && <button className="ctx-menu-item" role="menuitem" onClick={() => { onReply(message); onClose(); }}>{t('chat.reply')}</button>}
            {message.text && <button className="ctx-menu-item" role="menuitem" onClick={copy}>{t('chat.copyText')}</button>}
            {canPin && (
                <button className="ctx-menu-item" role="menuitem" onClick={() => { togglePin(message.channel, message).catch(() => {}); onClose(); }}>
                    {t(message.pinned ? 'chat.unpin' : 'chat.pin')}
                </button>
            )}
            {canDelete && (
                <button
                    className="ctx-menu-item ctx-menu-item--danger"
                    role="menuitem"
                    onClick={() => {
                        if (!confirmDelete) { setConfirmDelete(true); return; }
                        removeMessage(message.channel, message.id).catch(() => {});
                        onClose();
                    }}
                >
                    {confirmDelete ? t('chat.deleteConfirm') : t('chat.delete')}
                </button>
            )}
        </div>,
        document.body,
    );
}
