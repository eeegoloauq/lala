import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomBan } from '../../lib/types';
import { ApiError } from '../../lib/types';
import { getBans, unbanParticipant } from '../../lib/api';
import './banned-users-modal.css';

interface Props {
    roomId: string;
    adminSecret: string;
    onClose: () => void;
}

/** Creator/admin-only modal listing banned identities for a room, with per-row unban. */
export function BannedUsersModal({ roomId, adminSecret, onClose }: Props) {
    const { t } = useTranslation();
    const [bans, setBans] = useState<RoomBan[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [unbanning, setUnbanning] = useState<string | null>(null);

    const toErrorMessage = (err: unknown) =>
        t('room.errorCode', { code: err instanceof ApiError ? err.code : 'server_error' });

    const load = useCallback(async () => {
        setError(null);
        try {
            const list = await getBans(roomId, adminSecret);
            setBans(list);
        } catch (err) {
            setError(toErrorMessage(err));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomId, adminSecret]);

    useEffect(() => { load(); }, [load]);

    const handleUnban = async (identity: string) => {
        setUnbanning(identity);
        setError(null);
        try {
            await unbanParticipant(roomId, identity, adminSecret);
            // Optimistic removal — avoids a round trip just to confirm what we already know.
            setBans((prev) => prev?.filter((b) => b.identity !== identity) ?? prev);
        } catch (err) {
            setError(toErrorMessage(err));
        } finally {
            setUnbanning(null);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
    };

    return (
        <div className="modal-overlay" onKeyDown={handleKeyDown} onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal">
                <h3>{t('roomAdmin.bannedUsers')}</h3>

                {error && <p className="bum-error">{error}</p>}

                {bans === null ? (
                    <p className="bum-empty">{t('roomAdmin.loading')}</p>
                ) : bans.length === 0 ? (
                    <p className="bum-empty">{t('roomAdmin.noBans')}</p>
                ) : (
                    <div className="bum-list">
                        {bans.map((ban) => (
                            <div className="bum-row" key={ban.identity}>
                                <div className="bum-row-info">
                                    {ban.name && <span className="bum-row-name">{ban.name}</span>}
                                    <span className="bum-row-identity">{ban.identity}</span>
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-ghost"
                                    style={{ width: 'auto' }}
                                    disabled={unbanning === ban.identity}
                                    onClick={() => handleUnban(ban.identity)}
                                >
                                    {t('roomAdmin.unban')}
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="modal-actions">
                    <button type="button" className="btn btn-ghost" onClick={onClose}>
                        {t('createRoom.cancel')}
                    </button>
                </div>
            </div>
        </div>
    );
}
