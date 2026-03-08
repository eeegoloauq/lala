import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsIcon, RenameIcon } from '../icons/Icons';
import './participant-context-menu.css';

export interface AdminActions {
    adminSecret: string;
    roomId: string;
    serverMuted: boolean;
    onKick: () => void;
    onBan: () => void;
    onToggleMute: () => void;
}

interface ParticipantContextMenuProps {
    identity: string;
    name: string;
    isRemote: boolean;
    x: number;
    y: number;
    volume?: number;
    onVolumeChange?: (vol: number) => void;
    screenVolume?: number;
    onScreenVolumeChange?: (vol: number) => void;
    screenShareHidden?: boolean;
    onToggleScreenShare?: () => void;
    admin?: AdminActions;
    onOpenSettings?: () => void;
    onRenameRequest?: () => void;
    onClose: () => void;
}

export function ParticipantContextMenu({ identity, name, isRemote, x, y, volume = 50, onVolumeChange, screenVolume, onScreenVolumeChange, screenShareHidden, onToggleScreenShare, admin, onOpenSettings, onRenameRequest, onClose }: ParticipantContextMenuProps) {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);

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
        top: Math.min(y, window.innerHeight - 260),
        left: Math.min(x, window.innerWidth - 240),
    };

    const isMuted = volume === 0;

    return (
        <div className="ctx-menu" style={style} ref={ref}>
            <div className="ctx-menu-name">{name}</div>

            {isRemote ? (
                <>
                    <button
                        className="ctx-menu-item"
                        onClick={() => onVolumeChange?.(isMuted ? 50 : 0)}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            {isMuted
                                ? <><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v3M8 19H5m6 0h6" /></>
                                : <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" /></>
                            }
                        </svg>
                        {isMuted ? t('ctx.unmute') : t('ctx.mute')}
                    </button>

                    <div className="ctx-menu-volume">
                        <div className="ctx-menu-volume-row">
                            <span className="ctx-menu-volume-label">{t('ctx.volume')}</span>
                            <span className="ctx-menu-volume-val">{volume}%</span>
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            value={volume}
                            onChange={(e) => onVolumeChange?.(Number(e.target.value))}
                            className="ctx-menu-slider"
                        />
                    </div>

                    {onScreenVolumeChange !== undefined && screenVolume !== undefined && (
                        <div className="ctx-menu-volume">
                            <div className="ctx-menu-volume-row">
                                <span className="ctx-menu-volume-label">{t('ctx.screen')}</span>
                                <span className="ctx-menu-volume-val">{screenVolume}%</span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={100}
                                value={screenVolume}
                                onChange={(e) => onScreenVolumeChange(Number(e.target.value))}
                                className="ctx-menu-slider"
                            />
                        </div>
                    )}

                    {onToggleScreenShare && (
                        <button
                            className="ctx-menu-item"
                            onClick={() => { onToggleScreenShare(); onClose(); }}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="3" width="20" height="14" rx="2" />
                                <line x1="8" y1="21" x2="16" y2="21" />
                                <line x1="12" y1="17" x2="12" y2="21" />
                                {screenShareHidden && <line x1="2" y1="2" x2="22" y2="22" />}
                            </svg>
                            {screenShareHidden ? t('ctx.showScreen') : t('ctx.hideScreen')}
                        </button>
                    )}

                    {admin && (
                        <div className="ctx-menu-admin">
                            <button className="ctx-menu-item ctx-menu-item--warn" onClick={() => { admin.onToggleMute(); onClose(); }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    {admin.serverMuted
                                        ? <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" /></>
                                        : <><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v3M8 19H5m6 0h6" /></>
                                    }
                                </svg>
                                {admin.serverMuted ? t('ctx.allowMic') : t('ctx.serverMute')}
                            </button>
                            <button className="ctx-menu-item ctx-menu-item--danger" onClick={() => { admin.onKick(); onClose(); }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                    <polyline points="16 17 21 12 16 7" />
                                    <line x1="21" y1="12" x2="9" y2="12" />
                                </svg>
                                {t('ctx.kick')}
                            </button>
                            <button className="ctx-menu-item ctx-menu-item--danger" onClick={() => { admin.onBan(); onClose(); }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                </svg>
                                {t('ctx.ban')}
                            </button>
                        </div>
                    )}
                </>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div className="ctx-menu-local-note">{t('ctx.itsYou')}</div>
                    {onRenameRequest && (
                        <button
                            className="ctx-menu-item"
                            onClick={() => { onRenameRequest(); onClose(); }}
                        >
                            <RenameIcon size={14} />
                            {t('ctx.rename')}
                        </button>
                    )}
                    {onOpenSettings && (
                        <button
                            className="ctx-menu-item"
                            onClick={() => { onOpenSettings(); onClose(); }}
                        >
                            <SettingsIcon size={14} />
                            {t('ctx.settings')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
