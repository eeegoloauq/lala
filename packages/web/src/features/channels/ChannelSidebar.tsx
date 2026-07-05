import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomInfo, CreateRoomRequest } from '../../lib/types';
import { APP_NAME } from '../../lib/constants';
import { Avatar } from '../room/VideoGrid/Avatar';
import { getTemplates, removeTemplate } from '../../lib/roomTemplates';
import { getRoomPassword, getAdminSecret } from '../../lib/passwords';
import { SettingsIcon, MoonIcon } from '../room/icons/Icons';
import { ParticipantContextMenu } from '../room/VideoGrid/ParticipantContextMenu';
import { CreateRoomModal } from './CreateRoomModal';
import { RoomContextMenu } from './RoomContextMenu';
import { BannedUsersModal } from './BannedUsersModal';
import { ChannelUserRow } from './ChannelUserRow';
import { useTheme } from '../settings/ThemeProvider';
import type { Theme } from '../settings/ThemeProvider';
import { useLiveParticipants } from '../../lib/roomStatusStore';
import { getAdminBridge } from '../../lib/adminBridge';
import { buildAdminActions } from '../room/hooks/useAdminActions';
import '../settings/settings.css';
import './channel-sidebar.css';
import { IS_TOUCH as isTouchDevice } from '../../lib/env';

const THEMES: Theme[] = ['dark', 'light', 'amoled', 'discord', 'winxp'];

interface ChannelSidebarProps {
    rooms: RoomInfo[];
    roomsError?: string | null;
    activeRoom: string | null;
    identity: string;       // HMAC identity (or device UUID before room join) — for self-detection and admin ops
    displayName: string;    // display name shown in footer
    myAvatarUrl?: string | null;
    onRename: (name: string) => void;
    onJoinRoom: (id: string) => void;
    onCreateRoom: (req: CreateRoomRequest) => Promise<void>;
    onOpenSettings: () => void;
    onClose?: () => void;
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

interface RoomContextMenuState {
    roomId: string;
    roomName: string;
    adminSecret: string;
    x: number;
    y: number;
}

interface BansModalState {
    roomId: string;
    adminSecret: string;
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


export const ChannelSidebar = memo(function ChannelSidebar({
    rooms,
    roomsError,
    activeRoom,
    identity,
    displayName,
    myAvatarUrl,
    onRename,
    onJoinRoom,
    onCreateRoom,
    onOpenSettings,
    onClose,
    volumes,
    onVolumeChange,
}: ChannelSidebarProps) {
    const { t } = useTranslation();
    // Live participant list for the active room — lives in the external room-status
    // store (lib/roomStatusStore.ts) instead of being prop-drilled through
    // App -> RoomView -> RoomShell -> useRoomStatusSync -> App -> here. Speaking/
    // muted/deafened/avatar per participant are read individually by ChannelUserRow
    // so a voice-activity change only re-renders that one row, not this component.
    const liveParticipants = useLiveParticipants();
    const { theme, setTheme } = useTheme();
    const cycleTheme = () => {
        const idx = THEMES.indexOf(theme);
        setTheme(THEMES[(idx + 1) % THEMES.length]);
    };

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [roomContextMenu, setRoomContextMenu] = useState<RoomContextMenuState | null>(null);
    const [bansModal, setBansModal] = useState<BansModalState | null>(null);
    const [copiedRoom, setCopiedRoom] = useState<string | null>(null);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const renameInputRef = useRef<HTMLInputElement>(null);
    const [templateVersion, setTemplateVersion] = useState(0);
    const [templateError, setTemplateError] = useState<string | null>(null);

    const visibleTemplates = useMemo(() => {
        const templates = getTemplates();
        const liveNames = new Set(rooms.map(r => r.displayName.toLowerCase()));
        return templates.filter(t => !liveNames.has(t.name.toLowerCase()));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rooms, templateVersion]);

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

    const handleCopyInvite = useCallback((e: React.MouseEvent, roomId: string, hasPassword?: boolean) => {
        e.stopPropagation();
        let url = `${window.location.origin}/room/${roomId}`;
        // Include password in hash fragment for password-protected rooms
        // Hash is never sent to the server (HTTP spec), so this is safe
        if (hasPassword) {
            const pw = getRoomPassword(roomId);
            if (pw) url += `#pw=${encodeURIComponent(pw)}`;
        }
        navigator.clipboard.writeText(url).then(() => {
            setCopiedRoom(roomId);
            setTimeout(() => setCopiedRoom(null), 1500);
        });
    }, []);

    const handleUserContextMenu = useCallback((e: React.MouseEvent, participantIdentity: string, participantName: string, roomId: string) => {
        e.preventDefault();
        setContextMenu({ identity: participantIdentity, name: participantName, roomId, x: e.clientX, y: e.clientY });
    }, []);

    // Room-level right-click menu (banned users / delete room) — creator/admin only.
    // Presence of a saved adminSecret for this room IS the creator/admin check
    // (see lib/passwords.ts getAdminSecret); if it's absent, let the default
    // browser context menu show instead of hijacking the right-click.
    const handleRoomContextMenu = useCallback((e: React.MouseEvent, roomId: string, roomName: string) => {
        const secret = getAdminSecret(roomId);
        if (!secret) return;
        e.preventDefault();
        e.stopPropagation();
        setRoomContextMenu({ roomId, roomName, adminSecret: secret, x: e.clientX, y: e.clientY });
    }, []);

    // Keep room participants in a ref for the long-press callback
    const roomParticipantsRef = useRef(roomParticipants);
    roomParticipantsRef.current = roomParticipants;
    const channelListRef = useRef<HTMLDivElement>(null);


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

    // Same buildAdminActions builder the tile context menu uses (useAdminActions.ts),
    // so kick/ban/mute from the sidebar behave identically — HTTP call, broadcast,
    // system message, TTS, suppressLeave — instead of re-implementing a partial
    // version that skipped all but the HTTP call.
    const getAdminProps = useCallback((roomId: string, participantIdentity: string) => {
        const secret = getAdminSecret(roomId);
        if (!secret) return undefined;
        const room = rooms.find(r => r.id === roomId);
        const serverMuted = room?.serverMutedParticipants?.includes(participantIdentity) ?? false;
        // The sidebar can show participants of rooms we're NOT currently connected to
        // (they come from the SSE room snapshot, not a live LiveKit connection) — only
        // wire up the data-channel broadcast/system-message/TTS bridge when the target
        // room is the one we actually have a live connection to (registered by
        // useAdminActions while RoomShell is mounted for that room). Otherwise the
        // HTTP admin call still goes through, it just can't announce itself over a
        // data channel that doesn't exist from here.
        const bridge = getAdminBridge();
        const sameRoomBridge = bridge && bridge.roomId === roomId ? bridge : undefined;
        const actions = buildAdminActions(roomId, secret, {
            broadcast: sameRoomBridge?.broadcast,
            onError: sameRoomBridge?.onError,
        });
        return {
            adminSecret: secret,
            roomId,
            serverMuted,
            onKick: () => actions.onKick(participantIdentity),
            onBan: () => actions.onBan(participantIdentity),
            onToggleMute: () => actions.onToggleMute(participantIdentity, serverMuted),
        };
    }, [rooms]);

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

                {rooms.length === 0 && visibleTemplates.length === 0 && (
                    roomsError
                        ? <div className="sidebar-reconnecting">
                            <div className="sidebar-reconnecting-spinner" />
                            <span>{t('sidebar.reconnecting')}</span>
                        </div>
                        : <div className="sidebar-empty">{t('sidebar.noChannels')}</div>
                )}

                {roomsError && (rooms.length > 0 || visibleTemplates.length > 0) && (
                    <div className="sidebar-reconnecting sidebar-reconnecting-banner">
                        <div className="sidebar-reconnecting-spinner" />
                        <span>{t('sidebar.reconnecting')}</span>
                    </div>
                )}

                {rooms.map((room) => (
                    <div key={room.id}>
                        <div
                            className={`channel-item ${activeRoom === room.id ? 'active' : ''}`}
                            onClick={() => onJoinRoom(room.id)}
                            onContextMenu={(e) => handleRoomContextMenu(e, room.id, room.displayName)}
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
                                className={`channel-copy-btn${copiedRoom === room.id ? ' copied' : ''}`}
                                onClick={(e) => handleCopyInvite(e, room.id, room.hasPassword)}
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
                            const isActiveRoom = room.id === activeRoom;
                            return participants.length > 0 && (
                            <div className="channel-users">
                                {participants.map((p) => (
                                    <ChannelUserRow
                                        key={p.identity}
                                        identity={p.identity}
                                        name={p.name}
                                        roomId={room.id}
                                        isActiveRoom={isActiveRoom}
                                        isSelf={p.identity === identity}
                                        isRoomAdmin={p.identity === room.adminIdentity}
                                        serverMuted={room.serverMutedParticipants?.includes(p.identity) ?? false}
                                        staticMuted={room.mutedParticipants?.includes(p.identity) ?? false}
                                        staticDeafened={room.deafenedParticipants?.includes(p.identity) ?? false}
                                        isScreenSharing={room.screenSharingParticipants?.includes(p.identity) ?? false}
                                        onContextMenu={(e) => handleUserContextMenu(e, p.identity, p.name, room.id)}
                                    />
                                ))}
                            </div>
                        );
                        })()}
                    </div>
                ))}

                {visibleTemplates.length > 0 && (
                    <div className="channel-templates">
                        {visibleTemplates.map(template => (
                            <div
                                key={template.name}
                                className={`channel-item channel-item-template${templateError === template.name ? ' channel-item-error' : ''}`}
                                onClick={async () => {
                                    try {
                                        setTemplateError(null);
                                        await onCreateRoom({ name: template.name, password: template.password, maxParticipants: template.maxParticipants });
                                    } catch {
                                        setTemplateError(template.name);
                                        setTimeout(() => setTemplateError(null), 3000);
                                    }
                                }}
                                title={t('sidebar.recreateRoom')}
                            >
                                <svg className="channel-template-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="1 4 1 10 7 10" />
                                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                                </svg>
                                <span className="channel-name">{template.name}</span>
                                {template.password && (
                                    <svg className="channel-lock-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                    </svg>
                                )}
                                <button
                                    className="channel-template-remove"
                                    onClick={(e) => { e.stopPropagation(); removeTemplate(template.name); setTemplateVersion(v => v + 1); }}
                                    title={t('sidebar.removeTemplate')}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
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

            {roomContextMenu && (
                <RoomContextMenu
                    roomId={roomContextMenu.roomId}
                    roomName={roomContextMenu.roomName}
                    adminSecret={roomContextMenu.adminSecret}
                    x={roomContextMenu.x}
                    y={roomContextMenu.y}
                    onOpenBans={(roomId, adminSecret) => setBansModal({ roomId, adminSecret })}
                    onClose={() => setRoomContextMenu(null)}
                />
            )}

            {bansModal && (
                <BannedUsersModal
                    roomId={bansModal.roomId}
                    adminSecret={bansModal.adminSecret}
                    onClose={() => setBansModal(null)}
                />
            )}
        </div>
    );
});
