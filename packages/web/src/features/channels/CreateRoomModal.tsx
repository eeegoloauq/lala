import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreateRoomRequest } from '../../lib/types';
import './create-room-modal.css';

interface Props {
    onConfirm: (req: CreateRoomRequest) => Promise<void>;
    onClose: () => void;
}

export function CreateRoomModal({ onConfirm, onClose }: Props) {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [maxParticipants, setMaxParticipants] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const nameRef = useRef<HTMLInputElement>(null);

    useEffect(() => { nameRef.current?.focus(); }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        setLoading(true);
        setError(null);
        try {
            await onConfirm({
                name: trimmed,
                password: password || undefined,
                maxParticipants: maxParticipants || undefined,
            });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('createRoom.createFailed'));
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
    };

    return (
        <div className="modal-overlay" onKeyDown={handleKeyDown} onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal crm-modal">
                <h3>{t('createRoom.title')}</h3>

                <form onSubmit={handleSubmit}>
                    <div className="input-group">
                        <label>{t('createRoom.name')}</label>
                        <input
                            ref={nameRef}
                            className="input"
                            placeholder={t('createRoom.namePlaceholder')}
                            value={name}
                            maxLength={50}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="input-group">
                        <label>{t('createRoom.password')} <span className="crm-optional">({t('createRoom.passwordOptional')})</span></label>
                        <div className="crm-password-wrap">
                            <input
                                className="input"
                                type={showPassword ? 'text' : 'password'}
                                placeholder={t('createRoom.passwordPlaceholder')}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="new-password"
                            />
                            <button
                                type="button"
                                className="crm-eye-btn"
                                onClick={() => setShowPassword((v) => !v)}
                                tabIndex={-1}
                            >
                                {showPassword ? (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                                        <line x1="1" y1="1" x2="23" y2="23" />
                                    </svg>
                                ) : (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                        <circle cx="12" cy="12" r="3" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="input-group crm-limit-group">
                        <label>{t('createRoom.maxParticipants')} <span className="crm-optional">({maxParticipants === 0 ? t('createRoom.noLimit') : t('createRoom.maxLabel', { count: maxParticipants })})</span></label>
                        <div className="crm-limit-row">
                            <input
                                type="range"
                                className="settings-range"
                                min={0}
                                max={50}
                                step={1}
                                value={maxParticipants}
                                onChange={(e) => setMaxParticipants(Number(e.target.value))}
                            />
                            <span className="crm-limit-val">{maxParticipants === 0 ? '∞' : maxParticipants}</span>
                        </div>
                    </div>

                    {error && <p className="crm-error">{error}</p>}

                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
                            {t('createRoom.cancel')}
                        </button>
                        <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={!name.trim() || loading}>
                            {loading ? t('createRoom.creating') : t('createRoom.create')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
