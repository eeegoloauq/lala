import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatContextMenu } from './ChatMenus';
import { useLongPress } from '../../hooks/useLongPress';
import { RULES_IN_CALL, useChannels, useOpenInCall, useRules, useRulesPending, useUnread } from '../../lib/textChat';
import { HashIcon } from './icons';
import './text-chat.css';

export type TextTarget = { kind: 'chat'; id: string } | { kind: 'rules' };

interface TextChannelListProps {
    /** What the main area shows, outside a call. */
    current: TextTarget | null;
    /** In a call, chats open in its side panel; this marks the one shown there. */
    inCall: boolean;
    onOpen: (target: TextTarget) => void;
}

/** The "Text" section at the top of the room list: the rules, then each chat. */
export function TextChannelList({ current, inCall, onOpen }: TextChannelListProps) {
    const { t } = useTranslation();
    const channels = useChannels() ?? [];
    const rules = useRules();
    const pending = useRulesPending();
    const unread = useUnread();
    const openInCall = useOpenInCall();
    const [menu, setMenu] = useState<{ channel: string; x: number; y: number } | null>(null);
    const longPress = useLongPress();
    if (!rules && channels.length === 0) return null;

    const isCurrent = (target: TextTarget) => inCall
        ? openInCall === (target.kind === 'rules' ? RULES_IN_CALL : target.id)
        : current?.kind === target.kind && (target.kind === 'rules' || (current.kind === 'chat' && current.id === target.id));

    return (
        <div className="sidebar-text">
            <div className="sidebar-section-header">
                <span className="sidebar-section-title section-title">{t('sidebar.text')}</span>
            </div>
            {rules && (
                <button
                    type="button"
                    className={`channel-item text-item${isCurrent({ kind: 'rules' }) ? ' active' : ''}${pending ? ' text-item-unread' : ''}`}
                    onClick={() => onOpen({ kind: 'rules' })}
                    aria-current={isCurrent({ kind: 'rules' }) ? 'page' : undefined}
                >
                    {/* No icon of its own; the gap keeps the name in line with the chats'. */}
                    <span className="text-item-gap" aria-hidden />
                    <span className="channel-name">{t('rules.title')}</span>
                </button>
            )}
            {channels.map(c => {
                const state = unread.get(c.id);
                const here = isCurrent({ kind: 'chat', id: c.id });
                return (
                    <button
                        key={c.id}
                        type="button"
                        className={`channel-item text-item${here ? ' active' : ''}${state?.unread && !here ? ' text-item-unread' : ''}`}
                        onClick={() => onOpen({ kind: 'chat', id: c.id })}
                        onContextMenu={(e) => { e.preventDefault(); setMenu({ channel: c.id, x: e.clientX, y: e.clientY }); }}
                        {...longPress((x, y) => setMenu({ channel: c.id, x, y }))}
                        aria-current={here ? 'page' : undefined}
                        aria-label={state?.mentions ? t('sidebar.chatMentions', { name: c.name, count: state.mentions }) : undefined}
                    >
                        <HashIcon className="channel-icon" size={15} />
                        <span className="channel-name">{c.name}</span>
                        {!!state?.mentions && !here && <span className="text-badge" aria-hidden>{state.mentions}</span>}
                    </button>
                );
            })}
            {menu && (() => {
                const c = channels.find(x => x.id === menu.channel);
                return c && <ChatContextMenu channel={c.id} name={c.name} lastMessageId={c.lastMessageId} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />;
            })()}
        </div>
    );
}
