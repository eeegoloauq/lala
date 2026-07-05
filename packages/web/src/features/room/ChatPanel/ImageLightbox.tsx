import { useCallback, useEffect } from 'react';
import type { TFunction } from 'i18next';
import { DownloadIcon } from './FileBubble';

interface ImageLightboxProps {
    /** Object URL of the already-downloaded image blob. */
    src: string;
    fileName: string;
    onClose: () => void;
    t: TFunction;
}

/**
 * Fullscreen in-app image viewer opened by clicking an image thumbnail in chat.
 * Replaces the old target="_blank" tab: that does nothing in the Electron desktop
 * app (setWindowOpenHandler denies popups for non-http(s) — i.e. blob: — URLs) and
 * is clunky in the browser too. Closes on Esc, backdrop click, or the X button.
 * The download button builds a detached <a download> and clicks it programmatically
 * — never window.open — so it works the same way in the browser and in Electron.
 */
export function ImageLightbox({ src, fileName, onClose, t }: ImageLightboxProps) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const handleDownload = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const a = document.createElement('a');
        a.href = src;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }, [src, fileName]);

    return (
        <div className="cp-lightbox-backdrop" onClick={onClose}>
            <div className="cp-lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
                <button
                    type="button"
                    className="cp-lightbox-btn"
                    onClick={handleDownload}
                    aria-label={t('chat.download')}
                    title={t('chat.download')}
                >
                    <DownloadIcon />
                </button>
                <button
                    type="button"
                    className="cp-lightbox-btn"
                    onClick={onClose}
                    aria-label={t('chat.close')}
                    title={t('chat.close')}
                >
                    ✕
                </button>
            </div>
            <img
                className="cp-lightbox-img"
                src={src}
                alt={fileName}
                onClick={(e) => e.stopPropagation()}
            />
        </div>
    );
}
