import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatAttachment } from '../../lib/types';
import { formatFileSize } from '../../lib/fileTransfer';

const IMAGE = /^image\/(png|jpeg|gif|webp|avif)$/;
const AUDIO = /^audio\//;
const VIDEO = /^video\/(mp4|webm)$/;
/** Pictures never take more room than this in the list; the full size opens on click. */
const MAX_W = 400;
const MAX_H = 300;

/**
 * A file kept with a message. Pictures show inline at their reserved size, songs and videos
 * play in the browser's own player (keyboard and screen reader support come with it), and
 * anything else is a download. The server set `type` from the content, and serves
 * everything that isn't shown inline as a download.
 */
export function Attachment({ file, onOpenImage }: { file: ChatAttachment; onOpenImage: (file: ChatAttachment) => void }) {
    const { t } = useTranslation();
    const [revealed, setRevealed] = useState(!file.spoiler);

    if (!file.url) {
        return <div className="tc-file tc-file-expired">{t('chat.fileExpired', { name: file.name })}</div>;
    }

    const media = IMAGE.test(file.type) || VIDEO.test(file.type);
    if (media) {
        const scale = Math.min(1, MAX_W / (file.width ?? MAX_W), MAX_H / (file.height ?? MAX_H));
        const size = file.width && file.height ? { width: Math.round(file.width * scale), height: Math.round(file.height * scale) } : undefined;
        return (
            <div className={`tc-media${revealed ? '' : ' tc-media-hidden'}`} style={size}>
                {IMAGE.test(file.type)
                    ? (
                        <button type="button" className="tc-media-open" onClick={() => onOpenImage(file)} title={t('chat.openImage')} tabIndex={revealed ? 0 : -1}>
                            <img src={file.url} alt={file.name} loading="lazy" width={size?.width} height={size?.height} />
                        </button>
                    )
                    : <video src={file.url} controls preload="metadata" width={size?.width} height={size?.height} tabIndex={revealed ? 0 : -1} />}
                {!revealed && (
                    <button type="button" className="tc-spoiler-cover" onClick={() => setRevealed(true)}>
                        <span>{t('chat.spoiler')}</span>
                    </button>
                )}
            </div>
        );
    }

    if (AUDIO.test(file.type)) {
        return (
            <div className="tc-audio">
                <div className="tc-audio-name">
                    <span>{file.name}</span>
                    <span className="tc-file-size">{formatFileSize(file.size)}</span>
                </div>
                {revealed
                    ? <audio src={file.url} controls preload="none" />
                    : <button type="button" className="btn tc-audio-reveal" onClick={() => setRevealed(true)}>{t('chat.spoilerReveal')}</button>}
            </div>
        );
    }

    return (
        <a className="tc-file" href={file.url} download={file.name} title={t('chat.download')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="tc-file-name">{file.name}</span>
            <span className="tc-file-size">{formatFileSize(file.size)}</span>
        </a>
    );
}
