import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { postMessage, useChannels } from '../../lib/textChat';
import { usePresence } from '../../lib/presence';
import { useMeContext } from '../../lib/meContext';
import { ChatComposer } from '../room/ChatPanel/ChatComposer';
import { useStagedFiles } from '../room/ChatPanel/useStagedFiles';
import type { MentionCandidate, StagedFile } from '../room/ChatPanel/composerTools';
import { MessageFeed } from './MessageFeed';
import { PinsButton } from './PinsButton';
import type { ChatMessage } from '../../lib/types';
import { HashIcon } from './icons';
import '../room/ChatPanel/chat-panel.css';
import './text-chat.css';

interface TextChannelViewProps {
    channel: string;
    /** In a call's side panel: no page header (the panel has its own) and narrower rows. */
    compact?: boolean;
}

/** One text chat: its messages and the box to write in. */
export function TextChannelView({ channel, compact = false }: TextChannelViewProps) {
    const { t } = useTranslation();
    const me = useMeContext();
    const info = useChannels()?.find(c => c.id === channel);
    const presence = usePresence();
    const staged = useStagedFiles();
    const [sending, setSending] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
    const dragDepth = useRef(0);

    const mentions = useMemo<MentionCandidate[]>(
        () => [...(presence?.values() ?? [])].map(p => ({ identity: p.identity, name: p.name, status: p.status })),
        [presence],
    );

    const send = async (text: string, files: StagedFile[]) => {
        setSending(true);
        try {
            await postMessage(channel, text, files.map(f => ({ file: f.file, spoiler: f.spoiler })), replyTo?.id);
            setReplyTo(null);
        } finally {
            setSending(false);
        }
    };

    if (!info) return <div className="tc-view tc-view-missing">{t('chat.channelMissing')}</div>;
    const canPost = info.canPost;
    const filesDragged = (e: React.DragEvent) => canPost && e.dataTransfer.types.includes('Files');

    return (
        <section
            className={`tc-view${compact ? ' tc-view-compact' : ''}`}
            aria-label={`#${info.name}`}
            onDragEnter={(e) => { if (!filesDragged(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true); }}
            onDragOver={(e) => { if (filesDragged(e)) e.preventDefault(); }}
            onDragLeave={(e) => { if (!filesDragged(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
            onDrop={(e) => {
                if (!canPost) return;
                e.preventDefault();
                dragDepth.current = 0;
                setDragging(false);
                staged.add(e.dataTransfer.files);
            }}
        >
            {!compact && (
                <header className="tc-header">
                    <HashIcon size={20} className="tc-header-icon" />
                    <h1 className="tc-header-name">{info.name}</h1>
                    {info.topic && <span className="tc-header-topic">{info.topic}</span>}
                    <span className="tc-header-tools">
                        <PinsButton channel={channel} myIdentity={me?.identity} />
                    </span>
                </header>
            )}
            {dragging && <div className="cp-dropzone"><span>{t('chat.dropToAttach')}</span></div>}
            <MessageFeed channel={channel} myIdentity={me?.identity} isAdmin={me?.role === 'admin'} compact={compact} onReply={canPost ? setReplyTo : undefined} />
            <div className="tc-composer">
                <ChatComposer
                    key={channel}
                    send={send}
                    isSending={sending}
                    mayChat={canPost}
                    staged={canPost ? staged : undefined}
                    allowSpoiler
                    mentions={mentions}
                    botCommands={false}
                    placeholder={t('chat.placeholderChannel', { name: info.name })}
                    notAllowedText={t('chat.adminsOnly')}
                    replyingTo={replyTo ? { name: presence?.get(replyTo.identity)?.name ?? replyTo.name, onCancel: () => setReplyTo(null) } : undefined}
                />
            </div>
        </section>
    );
}
