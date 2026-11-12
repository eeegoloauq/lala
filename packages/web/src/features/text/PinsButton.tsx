import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { jumpTo, loadPins, usePins } from '../../lib/textChat';
import { usePresence } from '../../lib/presence';
import { avatarColorForIdentity } from '../../lib/avatarUtils';
import { useDismiss } from '../../hooks/useDismiss';
import { ChatText } from '../../ui/ChatText';
import { PinGlyph } from './MessageFeed';

const WIDTH = 360;

/** The chat's pinned messages, from a button in its header; each one jumps to its place. */
export function PinsButton({ channel, myIdentity }: { channel: string; myIdentity?: string }) {
    const { t } = useTranslation();
    const [anchor, setAnchor] = useState<DOMRect | null>(null);
    return (
        <>
            <button
                type="button"
                className={`tc-header-btn${anchor ? ' active' : ''}`}
                title={t('chat.pinnedMessages')}
                aria-label={t('chat.pinnedMessages')}
                aria-expanded={!!anchor}
                onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
            >
                <PinGlyph size={17} />
            </button>
            {anchor && <PinsPopover channel={channel} myIdentity={myIdentity} anchor={anchor} onClose={() => setAnchor(null)} />}
        </>
    );
}

function PinsPopover({ channel, myIdentity, anchor, onClose }: { channel: string; myIdentity?: string; anchor: DOMRect; onClose: () => void }) {
    const { t } = useTranslation();
    const pins = usePins(channel);
    const presence = usePresence();
    const ref = useRef<HTMLDivElement>(null);
    const [missing, setMissing] = useState<string | null>(null);
    useDismiss(ref, onClose);
    useEffect(() => { loadPins(channel); }, [channel]);

    const open = async (id: string) => {
        if (await jumpTo(channel, id)) onClose();
        else setMissing(id);
    };

    const left = Math.max(8, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - 8));
    return createPortal(
        <div ref={ref} className="tc-pins" style={{ top: anchor.bottom + 6, left, width: WIDTH }} role="dialog" aria-label={t('chat.pinnedMessages')}>
            <div className="tc-pins-head">{t('chat.pinnedMessages')}</div>
            <div className="tc-pins-list">
                {!pins && <div className="tc-loading" />}
                {pins?.length === 0 && <p className="tc-pins-empty">{t('chat.noPins')}</p>}
                {pins?.map(m => {
                    const name = presence?.get(m.identity)?.name ?? m.name;
                    return (
                        // The whole entry goes to the message. Not a <button>: the text inside
                        // may hold links, mentions and spoilers, which are controls themselves.
                        <div
                            key={m.id}
                            role="button"
                            tabIndex={0}
                            className="tc-pin"
                            onClick={(e) => { if (!(e.target as HTMLElement).closest('a, button, [role="button"]:not(.tc-pin)')) open(m.id); }}
                            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(m.id); } }}
                        >
                            <span className="tc-pin-head">
                                <span className="tc-pin-name" style={{ color: avatarColorForIdentity(m.identity) }}>{name}</span>
                                <span className="tc-msg-time">{new Date(m.at).toLocaleDateString()}</span>
                            </span>
                            <span className="tc-pin-text">
                                {m.text ? <ChatText text={m.text} myIdentity={myIdentity} /> : t('chat.attachmentOnly')}
                            </span>
                            {missing === m.id && <span className="tc-pin-missing">{t('chat.pinOutsideHistory')}</span>}
                        </div>
                    );
                })}
            </div>
        </div>,
        document.body,
    );
}
