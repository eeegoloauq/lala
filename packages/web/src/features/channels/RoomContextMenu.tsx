import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/types';
import { deleteRoom } from '../../lib/api';
// Reuses the same themed .ctx-menu / .ctx-menu-item classes as the participant
// right-click menu (winxp has hand-tuned overrides for these selectors already —
// see globals.css `[data-theme="winxp"] .ctx-menu*`), so this menu is themed for
// free across all 5 themes without any new CSS.
import '../room/VideoGrid/participant-context-menu.css';

export interface RoomContextMenuProps {
    roomId: string;
    roomName: string;
    adminSecret: string;
    x: number;
    y: number;
    onOpenBans: (roomId: string, adminSecret: string) => void;
    onClose: () => void;
}

/**
 * Creator/admin-only right-click menu on a room row in ChannelSidebar. Only ever
 * constructed when this device holds the room's adminSecret (see
 * ChannelSidebar.handleRoomContextMenu), so no extra permission check needed here.
 */
export function RoomContextMenu({ roomId, roomName, adminSecret, x, y, onOpenBans, onClose }: RoomContextMenuProps) {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

    const style: React.CSSProperties = {
        position: 'fixed',
        top: Math.min(y, window.innerHeight - 200),
        left: Math.min(x, window.innerWidth - 240),
    };

    const handleDeleteClick = async () => {
        if (!confirmDelete) {
            setConfirmDelete(true);
            return;
        }
        setDeleting(true);
        setError(null);
        try {
            await deleteRoom(roomId, adminSecret);
            // No optimistic removal needed — the SSE `rooms_updated` stream
            // triggers useRooms' fetchRooms(), which drops the deleted room.
            onClose();
        } catch (err) {
            setError(err instanceof ApiError ? t('room.errorCode', { code: err.code }) : t('room.errorCode', { code: 'server_error' }));
            setDeleting(false);
        }
    };

    return (
        <div className="ctx-menu" style={style} ref={ref}>
            <div className="ctx-menu-name">{roomName}</div>

            <button
                className="ctx-menu-item"
                onClick={() => { onOpenBans(roomId, adminSecret); onClose(); }}
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
                {t('roomAdmin.bannedUsers')}
            </button>

            <div className="ctx-menu-admin">
                <button
                    className="ctx-menu-item ctx-menu-item--danger"
                    onClick={handleDeleteClick}
                    disabled={deleting}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                    {confirmDelete ? t('roomAdmin.deleteConfirm') : t('roomAdmin.deleteRoom')}
                </button>
                {error && <div className="ctx-menu-local-note" style={{ color: 'var(--color-danger)', fontStyle: 'normal' }}>{error}</div>}
            </div>
        </div>
    );
}
