import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomInfo, CreateRoomRequest } from '../../lib/types';
import { APP_NAME } from '../../lib/constants';
import { colorForName } from '../../lib/participantColor';
import { Avatar } from '../room/VideoGrid/Avatar';
import { AvatarBadge } from '../../ui/AvatarBadge';
import { getCachedAvatar } from '../../lib/avatarUtils';
import { getBookmarks, addBookmark, removeBookmark, isBookmarked } from '../../lib/bookmarks';
import { SettingsIcon, MoonIcon } from '../room/icons/Icons';
import { ParticipantContextMenu } from '../room/VideoGrid/ParticipantContextMenu';
import { kickParticipant, banParticipant, muteParticipant } from '../../lib/api';
import { MicOffIcon, SpeakerOffIcon, ScreenShareStatusIcon } from '../room/icons/Icons';
import { CreateRoomModal } from './CreateRoomModal';
import { useTheme } from '../settings/ThemeProvider';
import type { Theme } from '../settings/ThemeProvider';
import '../settings/settings.css';
import './channel-sidebar.css';

const THEMES: Theme[] = ['dark', 'light', 'amoled', 'discord', 'retro', 'winxp'];

interface ChannelSidebarProps {
    rooms: RoomInfo[];
    activeRoom: string | null;
    identity: string;       // HMAC identity (or device UUID before room join) — for self-detection and admin ops
    displayName: string;    // display name shown in footer
    myAvatarUrl?: string | null;
    liveParticipants: Map<string, string>;
    onRename: (name: string) => void;
    speakingUsers: Set<string>;
    mutedInRoom?: Set<string>;    // real-time mute state from LiveKit (active room only)
    deafenedInRoom?: Set<string>; // real-time deafen state from LiveKit (active room only)
    onJoinRoom: (id: string) => void;
    onCreateRoom: (req: CreateRoomRequest) => Promise<void>;
    onOpenSettings: () => void;
    onClose?: () => void;
    avatarCache?: Map<string, string>;
    volumes?: Map<string, number>;
    onVolumeChange?: (identity: string, vol: number) => void;
}

interface ContextMenuState {
    identity: string;
    name: string;
    roomId: string;
    x: number;
    y: number;
}

function LockIcon({ title }: { title?: string }) {
    return (
        <span title={title} style={{ display: 'flex', flexShrink: 0 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
        </span>
    );
}


export function ChannelSidebar({
    rooms,
    activeRoom,
    identity,
    displayName,
    myAvatarUrl,
    liveParticipants,
    onRename,
    speakingUsers,
    mutedInRoom,
    deafenedInRoom,
    onJoinRoom,
    onCreateRoom,
    onOpenSettings,
    onClose,
    avatarCache,
    volumes,
    onVolumeChange,
}: ChannelSidebarProps) {
    const { t } = useTranslation();
    const { theme, setTheme } = useTheme();
    const cycleTheme = () => {
        const idx = THEMES.indexOf(theme);
        setTheme(THEMES[(idx + 1) % THEMES.length]);
    };

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [copiedRoom, setCopiedRoom] = useState<string | null>(null);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const renameInputRef = useRef<HTMLInputElement>(null);
    const [bookmarkVersion, setBookmarkVersion] = useState(0);

    const bookmarks = useMemo(() => getBookmarks(), [bookmarkVersion]);
    const liveRoomIds = useMemo(() => new Set(rooms.map(r => r.id)), [rooms]);
    const offlineBookmarks = useMemo(
        () => bookmarks.filter(b => !liveRoomIds.has(b.roomId)),
        [bookmarks, liveRoomIds],
    );

    const roomParticipants = useMemo(() => {
        const map = new Map<string, Array<{ identity: string; name: string }>>();
        for (const room of rooms) {
            const list = room.id === activeRoom && liveParticipants.size > 0
                ? Array.from(liveParticipants.entries()).map(([id, name]) => ({ identity: id, name }))
                : room.participants.filter(p => p.identity !== identity);
            map.set(room.id, list);
        }
        return map;
    }, [rooms, activeRoom, liveParticipants, identity]);

    const toggleBookmark = useCallback((roomId: string, name: string, hasPassword?: boolean) => {
        if (isBookmarked(roomId)) {
            removeBookmark(roomId);
        } else {
            addBookmark({ roomId, name, hasPassword });
        }
        setBookmarkVersion(v => v + 1);
    }, []);

    useEffect(() => {
        if (renaming) renameInputRef.current?.focus();
    }, [renaming]);

    const startRename = () => {
        setRenameValue(displayName);
        setRenaming(true);
    };

    const commitRename = () => {
        const val = renameValue.trim();
        if (val && val !== displayName) onRename(val);
        setRenaming(false);
    };

    const handleCopyInvite = useCallback((e: React.MouseEvent, roomId: string) => {
        e.stopPropagation();
        const url = `${window.location.origin}/room/${roomId}`;
        navigator.clipboard.writeText(url).then(() => {
            setCopiedRoom(roomId);
            setTimeout(() => setCopiedRoom(null), 1500);
        });
    }, []);

    const handleUserContextMenu = (e: React.MouseEvent, participantIdentity: string, participantName: string, roomId: string) => {
        e.preventDefault();
        setContextMenu({ identity: participantIdentity, name: participantName, roomId, x: e.clientX, y: e.clientY });
    };

    // Keep room participants in a ref for the long-press callback
    const roomParticipantsRef = useRef(roomParticipants);
    roomParticipantsRef.current = roomParticipants;
    const channelListRef = useRef<HTMLDivElement>(null);

    const isTouchDevice = typeof window !== 'undefined' && navigator.maxTouchPoints > 0;

    const handleUserCardClick = useCallback((e: React.MouseEvent) => {
        if (!isTouchDevice) return;
        let el = e.target as HTMLElement | null;
        while (el && el !== channelListRef.current) {
            if (el.dataset.participantIdentity) {
                const pid = el.dataset.participantIdentity;
                const pname = el.dataset.participantName || pid;
                const roomId = el.dataset.participantRoom || '';
                setContextMenu({ identity: pid, name: pname, roomId, x: e.clientX, y: e.clientY });
                return;
            }
            el = el.parentElement;
        }
    }, []);

    const getAdminProps = (roomId: string, identity: string) => {
        const secret = localStorage.getItem(`lala_admin_${roomId}`);
        if (!secret) return undefined;
        return {
            adminSecret: secret,
            roomId,
            serverMuted: false, // sidebar has no LiveKit context to read permissions from
            onKick: () => kickParticipant(roomId, identity, secret),
            onBan: () => banParticipant(roomId, identity, secret),
            onToggleMute: () => muteParticipant(roomId, identity, secret, true),
        };
    };

    return (
        <div className="sidebar">
            {/* Header */}
            <div className="sidebar-header">
                <span className="logo">{APP_NAME}</span>
                {onClose && (
                    <button className="sidebar-close-btn" onClick={onClose} title={t('sidebar.close')}>✕</button>
                )}
            </div>

            {/* Channel List */}
            <div
                className="sidebar-section"
                style={{ flex: 1, overflowY: 'auto' }}
                ref={channelListRef}
                onClick={handleUserCardClick}
            >
                <div className="sidebar-section-header">
                    <span className="sidebar-section-title">{t('sidebar.voiceChannels')}</span>
                    <button
                        className="sidebar-add-btn"
                        onClick={() => setShowCreateModal(true)}
                        title={t('sidebar.createChannel')}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>
                </div>

                {rooms.length === 0 && offlineBookmarks.length === 0 && (
                    <div className="sidebar-empty">{t('sidebar.noChannels')}</div>
                )}

                {rooms.map((room) => (
                    <div key={room.id}>
                        <div
                            className={`channel-item ${activeRoom === room.id ? 'active' : ''}`}
                            onClick={() => onJoinRoom(room.id)}
                        >
                            <svg className="channel-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                            </svg>
                            <span className="channel-name">{room.displayName}</span>
                            {room.hasPassword && <LockIcon title={t('sidebar.passwordProtected')} />}
                            {((room.id === activeRoom ? liveParticipants.size : room.numParticipants) > 0 || room.maxParticipants > 0) && (
                                <span className="channel-count">
                                    {room.id === activeRoom ? liveParticipants.size : room.numParticipants}
                                    {room.maxParticipants > 0 ? `/${room.maxParticipants}` : ''}
                                </span>
                            )}
                            <button
                                className={`channel-copy-btn${isBookmarked(room.id) ? ' bookmarked' : ''}`}
                                onClick={(e) => { e.stopPropagation(); toggleBookmark(room.id, room.displayName, room.hasPassword); }}
                                title={isBookmarked(room.id) ? t('sidebar.removeBookmark') : t('sidebar.addBookmark')}
                            >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill={isBookmarked(room.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                                </svg>
                            </button>
                            <button
                                className={`channel-copy-btn${copiedRoom === room.id ? ' copied' : ''}`}
                                onClick={(e) => handleCopyInvite(e, room.id)}
                                title={t('sidebar.copyLink')}
                            >
                                {copiedRoom === room.id ? (
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                ) : (
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                    </svg>
                                )}
                            </button>
                        </div>

                        {(() => {
                            const participants = roomParticipants.get(room.id) ?? [];
                            return participants.length > 0 && (
                            <div className="channel-users">
                                {participants.map((p) => {
                                        const displayName = p.name;
                                        const participantAvatarUrl = (avatarCache?.get(p.identity) || getCachedAvatar(p.identity, displayName)) ?? undefined;
                                        return (
                                            <div
                                                key={p.identity}
                                                className="channel-user-card"
                                                data-participant-identity={p.identity}
                                                data-participant-name={displayName}
                                                data-participant-room={room.id}
                                                onContextMenu={(e) => handleUserContextMenu(e, p.identity, displayName, room.id)}
                                            >
                                                <AvatarBadge
                                                    topCrown={p.identity === room.adminIdentity ? (
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="#f59e0b" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,1))' }}>
                                                            <path d="M2 19l2-9 5 4 3-8 3 8 5-4 2 9H2z" />
                                                        </svg>
                                                    ) : undefined}
                                                >
                                                    <div
                                                        className={`channel-user-avatar${speakingUsers.has(p.identity) ? ' speaking' : ''}`}
                                                        style={{ background: participantAvatarUrl ? 'transparent' : colorForName(p.identity) }}
                                                    >
                                                        {participantAvatarUrl ? (
                                                            <img src={participantAvatarUrl} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} draggable={false} />
                                                        ) : (
                                                            displayName[0]?.toUpperCase() ?? '?'
                                                        )}
                                                    </div>
                                                </AvatarBadge>
                                                <span className="channel-user-name">{displayName}</span>
                                                {p.identity === identity && (
                                                    <span className="channel-user-you">{t('sidebar.you')}</span>
                                                )}
                                                <span className="channel-user-indicators">
                                                    {(room.id === activeRoom && mutedInRoom
                                                        ? mutedInRoom.has(p.identity)
                                                        : room.mutedParticipants?.includes(p.identity)
                                                    ) && (
                                                            <span className="channel-user-indicator" title={t('sidebar.micOff')}><MicOffIcon /></span>
                                                        )}
                                                    {(room.id === activeRoom && deafenedInRoom
                                                        ? deafenedInRoom.has(p.identity)
                                                        : room.deafenedParticipants?.includes(p.identity)
                                                    ) && (
                                                            <span className="channel-user-indicator" title={t('sidebar.soundOff')}><SpeakerOffIcon /></span>
                                                        )}
                                                </span>
                                                {room.screenSharingParticipants?.includes(p.identity) && (
                                                    <span className="channel-user-stream" title={t('sidebar.streaming')}>
                                                        <ScreenShareStatusIcon size={11} />
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                            </div>
                        );
                        })()}
                    </div>
                ))}

                {offlineBookmarks.length > 0 && (
                    <>
                        <div className="sidebar-section-header" style={{ marginTop: 12 }}>
                            <span className="sidebar-section-title" style={{ opacity: 0.5 }}>{t('sidebar.bookmarksOffline')}</span>
                        </div>
                        {offlineBookmarks.map(b => (
                            <div key={b.roomId}>
                                <div
                                    className="channel-item channel-item-offline"
                                    onClick={() => onJoinRoom(b.roomId)}
                                >
                                    <svg className="channel-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                                    </svg>
                                    <span className="channel-name" style={{ opacity: 0.5 }}>{b.name}</span>
                                    {b.hasPassword && <LockIcon title={t('sidebar.passwordProtected')} />}
                                    <button
                                        className="channel-copy-btn"
                                        onClick={(e) => { e.stopPropagation(); removeBookmark(b.roomId); setBookmarkVersion(v => v + 1); }}
                                        title={t('sidebar.removeBookmark')}
                                    >
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </div>

            {/* Footer */}
            <div className="sidebar-footer">
                <div className="sidebar-footer-avatar">
                    <Avatar name={displayName || '?'} identity={identity} size={32} avatarUrl={myAvatarUrl ?? undefined} />
                </div>
                {renaming ? (
                    <input
                        ref={renameInputRef}
                        className="sidebar-rename-input"
                        value={renameValue}
                        maxLength={20}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setRenaming(false);
                        }}
                    />
                ) : (
                    <span className="user-name" onDoubleClick={startRename}>{displayName || t('sidebar.anonymous')}</span>
                )}
                <button className="sidebar-theme-btn" onClick={cycleTheme} title={t('sidebar.theme', { name: t(`theme.${theme}`) })}>
                    <MoonIcon size={15} />
                </button>
                <button className="sidebar-settings-btn" onClick={onOpenSettings} title={t('sidebar.settings')}>
                    <SettingsIcon size={14} />
                </button>
            </div>

            {showCreateModal && (
                <CreateRoomModal
                    onConfirm={onCreateRoom}
                    onClose={() => setShowCreateModal(false)}
                />
            )}

            {contextMenu && (
                <ParticipantContextMenu
                    identity={contextMenu.identity}
                    name={contextMenu.name}
                    isRemote={contextMenu.identity !== identity}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    volume={volumes?.get(contextMenu.identity) ?? 50}
                    onVolumeChange={onVolumeChange ? (vol) => onVolumeChange(contextMenu.identity, vol) : undefined}
                    admin={contextMenu.identity !== identity ? getAdminProps(contextMenu.roomId, contextMenu.identity) : undefined}
                    onOpenSettings={onOpenSettings}
                    onRenameRequest={startRename}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}
