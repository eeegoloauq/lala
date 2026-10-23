import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_FILE_SIZE, formatFileSize } from '../../../lib/fileTransfer';
import { useTimedValue } from '../../../hooks/useTimedValue';
import { MessageList, type ChatEntry } from './MessageList';
import { ChatComposer } from './ChatComposer';
import { useFloatingPanel, RESIZE_DIRS } from './useFloatingPanel';
import './chat-panel.css';

interface ChatPanelProps {
    entries: ChatEntry[];
    send: (msg: string) => Promise<unknown>;
    isSending: boolean;
    onClose?: () => void;
    overlay?: boolean;
    /** Sends a File as a byte-stream chat attachment; resolves with an error tag on failure (e.g. too large). */
    onSendFile?: (file: File) => Promise<{ ok: boolean; error?: 'tooLarge' }>;
    /** Cancels an in-progress outgoing file transfer. */
    onCancelFile?: (id: string) => void;
}

export function ChatPanel({ entries, send, isSending, onClose, overlay = false, onSendFile, onCancelFile }: ChatPanelProps) {
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement>(null);
    const { startDrag, startResize } = useFloatingPanel(panelRef, overlay);
    const [fileError, showFileError] = useTimedValue<string>(5000);
    const [dragActive, setDragActive] = useState(false);
    // Counted so enter/leave pairs bubbling from child elements don't make the drop overlay flicker.
    const dragDepth = useRef(0);

    const sendFiles = onSendFile && ((files: Iterable<File>) => {
        const tooLarge = () => showFileError(t('chat.fileTooLarge', { max: formatFileSize(MAX_FILE_SIZE) }));
        for (const file of files) {
            if (file.size > MAX_FILE_SIZE) {
                tooLarge();
                continue;
            }
            onSendFile(file).then((result) => {
                if (!result.ok && result.error === 'tooLarge') tooLarge();
            });
        }
    });

    const draggingFiles = (e: React.DragEvent) => !!sendFiles && e.dataTransfer.types.includes('Files');

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
                if (!sendFiles) return;
                e.preventDefault();
                dragDepth.current = 0;
                setDragActive(false);
                if (e.dataTransfer.files.length) sendFiles(e.dataTransfer.files);
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
                <span>{t('chat.title')}</span>
                {onClose && (
                    <button className="cp-close" onMouseDown={e => e.stopPropagation()} onClick={onClose} title={t('chat.close')}>✕</button>
                )}
            </div>

            <MessageList entries={entries} onCancelFile={onCancelFile} />

            {fileError && <div className="cp-rate-limit">{fileError}</div>}

            <ChatComposer send={send} isSending={isSending} onFiles={sendFiles} />
        </div>
    );
}
