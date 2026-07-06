import type { TFunction } from 'i18next';
import { MAX_FILE_SIZE, formatFileSize, type FileTransferItem } from '../../../lib/fileTransfer';

interface FileBubbleProps {
    item: FileTransferItem;
    /** Only meaningful for the sender's own in-flight outgoing transfers. */
    onCancel?: (id: string) => void;
    /** Opens the in-app lightbox for a finished image transfer. */
    onOpenImage?: (item: FileTransferItem) => void;
    t: TFunction;
}

/**
 * Renders one file-transfer chat bubble: progress while sending/receiving, an inline
 * thumbnail for finished images (click opens the in-app lightbox — see
 * ChatPanel/ImageLightbox.tsx), or a download chip for everything else. Never
 * auto-opens/executes anything — images just render as an <img>, other files are
 * plain <a download> links. Nothing here ever uses window.open/target="_blank":
 * those are silently blocked by Electron's window-open handler for non-http(s)
 * (blob:) URLs, so both the lightbox and the download chip stay same-document.
 */
export function FileBubble({ item, onCancel, onOpenImage, t }: FileBubbleProps) {
    const sizeLabel = item.size !== undefined ? formatFileSize(item.size) : '';

    if (item.status === 'error' || item.status === 'canceled') {
        const statusText = item.status === 'canceled'
            ? t('chat.fileCanceled')
            : item.errorReason === 'tooLarge'
                ? t('chat.fileTooLarge', { max: formatFileSize(MAX_FILE_SIZE) })
                : t('chat.fileFailed');
        return (
            <div className="cp-file cp-file-error">
                <FileIcon />
                <div className="cp-file-info">
                    <span className="cp-file-name" title={item.fileName}>{item.fileName}</span>
                    <span className="cp-file-status">{statusText}</span>
                </div>
            </div>
        );
    }

    if (item.status === 'queued') {
        return (
            <div className="cp-file cp-file-queued">
                <FileIcon />
                <div className="cp-file-info">
                    <span className="cp-file-name" title={item.fileName}>{item.fileName}</span>
                    <span className="cp-file-status">{t('chat.fileQueued')}</span>
                </div>
                {item.direction === 'out' && onCancel && (
                    <button className="cp-file-cancel" onClick={() => onCancel(item.id)} title={t('chat.cancelTransfer')}>
                        ✕
                    </button>
                )}
            </div>
        );
    }

    if (item.status === 'active') {
        const pct = item.progress !== undefined ? Math.round(item.progress * 100) : null;
        return (
            <div className="cp-file cp-file-active">
                <FileIcon />
                <div className="cp-file-info">
                    <span className="cp-file-name" title={item.fileName}>{item.fileName}</span>
                    <div className="cp-file-progress">
                        <div className="cp-file-progress-bar" style={{ width: pct !== null ? `${pct}%` : '100%' }} />
                    </div>
                    <span className="cp-file-status">{sizeLabel}{pct !== null ? ` · ${pct}%` : ''}</span>
                </div>
                {item.direction === 'out' && onCancel && (
                    <button className="cp-file-cancel" onClick={() => onCancel(item.id)} title={t('chat.cancelTransfer')}>
                        ✕
                    </button>
                )}
            </div>
        );
    }

    // status === 'done'
    if (item.isImage && item.blobUrl) {
        return (
            <button
                type="button"
                className="cp-file-thumb-link"
                onClick={() => onOpenImage?.(item)}
                title={t('chat.openImage')}
            >
                <img className="cp-file-thumb" src={item.blobUrl} alt={item.fileName} />
            </button>
        );
    }

    return (
        <a className="cp-file cp-file-chip" href={item.blobUrl} download={item.fileName} title={t('chat.download')}>
            <FileIcon />
            <div className="cp-file-info">
                <span className="cp-file-name" title={item.fileName}>{item.fileName}</span>
                <span className="cp-file-status">{sizeLabel}</span>
            </div>
            <DownloadIcon />
        </a>
    );
}

function FileIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    );
}

export function DownloadIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    );
}
