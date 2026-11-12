import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_FILE_SIZE, formatFileSize } from '../../../lib/fileTransfer';
import { useTimedValue } from '../../../hooks/useTimedValue';
import { MessageList, type ChatEntry } from './MessageList';
import { ChatComposer } from './ChatComposer';
import { useFloatingPanel, RESIZE_DIRS } from './useFloatingPanel';
import { useStagedFiles } from './useStagedFiles';
import { openInCall, RULES_IN_CALL, useChannels, useOpenInCall } from '../../../lib/textChat';
import { TextChannelView } from '../../text/TextChannelView';
import { RulesView } from '../../text/RulesView';
import { HashIcon } from '../../text/icons';
import { PinsButton } from '../../text/PinsButton';
import type { StagedFile } from './composerTools';
import './chat-panel.css';

/** Below this width the chat stays the existing floating/fullscreen overlay; at or above it, chat docks as a proper reflowing column. */
export const DESKTOP_CHAT_QUERY = '(min-width: 900px)';

interface ChatPanelProps {
    entries: ChatEntry[];
    send: (msg: string) => Promise<unknown>;
    isSending: boolean;
    /** Whose messages are our own. */
    localIdentity: string;
    /** Whether the room lets us chat. */
    mayChat: boolean;
    onClose?: () => void;
    overlay?: boolean;
    /** Sends a File as a byte-stream chat attachment; resolves with an error tag on failure (e.g. too large). */
    onSendFile?: (file: File) => Promise<{ ok: boolean; error?: 'tooLarge' }>;
    /** Cancels an in-progress outgoing file transfer. */
    onCancelFile?: (id: string) => void;
}

export function ChatPanel({ entries, send, isSending, localIdentity, mayChat, onClose, overlay = false, onSendFile, onCancelFile }: ChatPanelProps) {
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement>(null);
    const { startDrag, startResize } = useFloatingPanel(panelRef, overlay);
    // A text chat picked in the room list shows here instead of the call's chat until closed.
    const textChannel = useOpenInCall();
    const channelName = useChannels()?.find(c => c.id === textChannel)?.name;
    const [fileError, showFileError] = useTimedValue<string>(5000);
    const [dragActive, setDragActive] = useState(false);
    // Counted so enter/leave pairs bubbling from child elements don't make the drop overlay flicker.
    const dragDepth = useRef(0);

    const staged = useStagedFiles();
    const tooLarge = () => showFileError(t('chat.fileTooLarge', { max: formatFileSize(MAX_FILE_SIZE) }));
    // Files wait in the composer's tray; ones over the cap never get there.
    const stageFiles = onSendFile && ((files: Iterable<File>) => {
        const fitting = Array.from(files).filter(f => f.size <= MAX_FILE_SIZE);
        if (fitting.length < Array.from(files).length) tooLarge();
        staged.add(fitting);
    });
    const stagedFiles = stageFiles && { ...staged, add: stageFiles };

    // The text goes as a chat message, then each file as its own transfer.
    const sendWithFiles = async (text: string, files: StagedFile[]) => {
        if (text) await send(text);
        for (const f of files) {
            onSendFile?.(f.file).then((result) => {
                if (!result.ok && result.error === 'tooLarge') tooLarge();
            });
        }
    };

    const draggingFiles = (e: React.DragEvent) => !textChannel && !!stageFiles && e.dataTransfer.types.includes('Files');

    return (
        <div
            ref={panelRef}
            className={`cp-panel${overlay ? ' cp-overlay' : ''}`}
            onDragEnter={(e) => {
                if (!draggingFiles(e)) return;
                e.preventDefault();
                dragDepth.current += 1;
                setDragActive(true);
            }}
            onDragOver={(e) => { if (draggingFiles(e)) e.preventDefault(); }}
            onDragLeave={(e) => {
                if (!draggingFiles(e)) return;
                e.preventDefault();
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (dragDepth.current === 0) setDragActive(false);
            }}
            onDrop={(e) => {
                if (!stageFiles || textChannel) return;
                e.preventDefault();
                dragDepth.current = 0;
                setDragActive(false);
                if (e.dataTransfer.files.length) stageFiles(e.dataTransfer.files);
            }}
        >
            {dragActive && (
                <div className="cp-dropzone">
                    <span>{t('chat.dropToSend')}</span>
                </div>
            )}

            {overlay && RESIZE_DIRS.map(dir => (
                <div key={dir} className={`cp-resize cp-resize-${dir}`} onMouseDown={e => startResize(e, dir)} />
            ))}

            <div className="cp-header" onMouseDown={overlay ? startDrag : undefined}>
                {textChannel ? (
                    <span className="cp-header-text">
                        <button className="cp-back" onMouseDown={e => e.stopPropagation()} onClick={() => openInCall(null)} title={t('chat.backToCall')} aria-label={t('chat.backToCall')}>←</button>
                        {textChannel === RULES_IN_CALL ? t('rules.title') : <><HashIcon size={14} />{channelName}</>}
                    </span>
                ) : <span>{t('chat.title')}</span>}
                {textChannel && textChannel !== RULES_IN_CALL && (
                    <span className="cp-header-tools" onMouseDown={e => e.stopPropagation()}><PinsButton channel={textChannel} myIdentity={localIdentity} /></span>
                )}
                {onClose && (
                    <button className="cp-close" onMouseDown={e => e.stopPropagation()} onClick={onClose} title={t('chat.close')}>✕</button>
                )}
            </div>

            {textChannel === RULES_IN_CALL ? <RulesView compact /> : textChannel ? <TextChannelView key={textChannel} channel={textChannel} compact /> : (<>
            <MessageList entries={entries} localIdentity={localIdentity} onCancelFile={onCancelFile} />

            {fileError && <div className="cp-rate-limit">{fileError}</div>}

            <ChatComposer send={sendWithFiles} isSending={isSending} mayChat={mayChat} staged={stagedFiles} />
            </>)}
        </div>
    );
}
