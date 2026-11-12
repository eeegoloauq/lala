import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomInfo, NewRoom, PresenceChoice } from '../../lib/types';
import { APP_NAME, MAX_NAME_LENGTH } from '../../lib/constants';
import { Avatar } from '../room/VideoGrid/Avatar';
import { getTemplates, removeTemplate } from '../../lib/roomTemplates';
import { openProfile } from '../../lib/profileCard';
import { SidebarIcon, SettingsIcon, MoonIcon, SpeakerIcon, LockIcon, EarIcon, PlusIcon } from '../room/icons/Icons';
import { AddBotMenu } from './AddBotMenu';
import { ParticipantContextMenu } from '../room/VideoGrid/ParticipantContextMenu';
import { floorAction } from '../../lib/floor';
import { moveErrorMessage, moveTargets } from '../../lib/moving';
import { moveParticipant } from '../../lib/api';
import { CreateRoomModal } from './CreateRoomModal';
import { RoomContextMenu } from './RoomContextMenu';
import { BannedUsersModal } from './BannedUsersModal';
import { ChannelUserRow } from './ChannelUserRow';
import { useTheme } from '../settings/ThemeProvider';
import { THEMES } from '../../themes';
import { useLiveParticipants } from '../../lib/roomStatusStore';
import { buildAdminActions } from '../room/hooks/useAdminActions';
import { useMeContext } from '../../lib/meContext';
import { useTimedValue } from '../../hooks/useTimedValue';
import { useLongPress } from '../../hooks/useLongPress';
import { useMyStatus } from '../../lib/presence';
import { TextChannelList, type TextTarget } from '../text/TextChannelList';
import { WithStatus } from '../../ui/StatusDot';
import { StatusMenu } from '../people/StatusMenu';
import '../settings/settings.css';
import '../../ui/panel.css';
import './channel-sidebar.css';
import { IS_TOUCH as isTouchDevice } from '../../lib/env';

interface ChannelSidebarProps {
    rooms: RoomInfo[];
    roomsError?: string | null;
    activeRoom: string | null;
    displayName: string;    // display name shown in footer
    myAvatarUrl?: string | null;
    onRename: (name: string) => void;
    onJoinRoom: (id: string) => void;
    onCreateRoom: (req: NewRoom) => Promise<void>;
    onOpenSettings: () => void;
    onClose?: () => void;
    /** Wider screens: hides the docked room list. */
    onHide?: () => void;
    volumes?: Map<string, number>;
    onVolumeChange?: (identity: string, vol: number) => void;
    /** The status picked in the footer; absent when the server has no presence. */
    presenceStatus?: PresenceChoice;
    onPresenceStatusChange?: (status: PresenceChoice) => void;
    /** What the main area shows outside a call: a text chat or the rules. */
    textView: TextTarget | null;
    onOpenText: (target: TextTarget) => void;
    /** The rules come first: rooms stay out of the list until they are agreed to. */
    gated?: boolean;
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
    hasPassword: boolean;
    canModerate: boolean;
    permanent: boolean;
    x: number;
    y: number;
}

export const ChannelSidebar = memo(function ChannelSidebar({
    rooms,
    roomsError,
    activeRoom,
    displayName,
    myAvatarUrl,
    onRename,
    onJoinRoom,
    onCreateRoom,
    onOpenSettings,
    onClose,
    onHide,
    volumes,
    onVolumeChange,
    presenceStatus,
    onPresenceStatusChange,
    textView,
    onOpenText,
    gated = false,
}: ChannelSidebarProps) {
    const { t } = useTranslation();
    const me = useMeContext();
    const identity = me?.identity ?? '';
    const canCreateRooms = me?.canCreateRooms ?? true;
    // Live participant list for the active room — lives in the external room-status
    // store (lib/roomStatusStore.ts) instead of being prop-drilled through
    // App -> RoomView -> RoomShell -> useRoomStatusSync -> App -> here. Speaking/
    // muted/deafened/avatar per participant are read individually by ChannelUserRow
    // so a voice-activity change only re-renders that one row, not this component.
    const liveParticipants = useLiveParticipants();
    const myStatus = useMyStatus();
    const { theme, setChoice } = useTheme();
    const cycleTheme = () => {
        const idx = THEMES.indexOf(theme);
        setChoice(THEMES[(idx + 1) % THEMES.length]);
    };

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [roomContextMenu, setRoomContextMenu] = useState<RoomContextMenuState | null>(null);
    const [bansRoomId, setBansRoomId] = useState<string | null>(null);
    // Dragging someone onto another room moves them (mouse only; touch uses the menu).
    const [dragging, setDragging] = useState<{ identity: string; from: string } | null>(null);
    const [dropRoom, setDropRoom] = useState<string | null>(null);
    const [moveError, showMoveError] = useTimedValue<{ roomId: string; text: string }>(4000);
    const canDropOn = (roomId: string) => !!dragging && moveTargets(rooms, dragging.from, dragging.identity).some(r => r.id === roomId);
    const endDrag = () => { setDragging(null); setDropRoom(null); };
    const dropOn = (roomId: string) => {
        if (!dragging || !canDropOn(roomId)) return;
        const { identity: who, from } = dragging;
        endDrag();
        moveParticipant(from, who, roomId).catch(err => showMoveError({ roomId, text: moveErrorMessage(t, err) }));
    };
    const [addBotMenu, setAddBotMenu] = useState<{ roomId: string; locked: boolean; x: number; y: number } | null>(null);
    const closeAddBotMenu = useCallback(() => setAddBotMenu(null), []);
    const [statusMenu, setStatusMenu] = useState<DOMRect | null>(null);
    const closeStatusMenu = useCallback(() => setStatusMenu(null), []);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const renameInputRef = useRef<HTMLInputElement>(null);
    const [templateVersion, setTemplateVersion] = useState(0);
    const [templateError, showTemplateError, clearTemplateError] = useTimedValue<string>(3000);

    const visibleTemplates = useMemo(() => {
        const templates = getTemplates();
        const liveNames = new Set(rooms.map(r => r.displayName.toLowerCase()));
        return canCreateRooms ? templates.filter(t => !liveNames.has(t.name.toLowerCase())) : [];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rooms, templateVersion, canCreateRooms]);

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

    const openProfileBeside = (e: React.MouseEvent, participantIdentity: string, participantName: string) => {
        const rect = e.currentTarget.getBoundingClientRect();
        openProfile({ identity: participantIdentity, name: participantName, x: rect.right + 8, y: rect.top });
    };

    const handleUserContextMenu = useCallback((e: React.MouseEvent, participantIdentity: string, participantName: string, roomId: string) => {
        e.preventDefault();
        setContextMenu({ identity: participantIdentity, name: participantName, roomId, x: e.clientX, y: e.clientY });
    }, []);

    // Room menu: the invite link for everyone, banned users and delete for moderators.
    // Right-click on desktop and Android, long press on iOS (which fires no contextmenu).
    const openRoomMenu = useCallback((room: RoomInfo, x: number, y: number) => {
        setRoomContextMenu({
            roomId: room.id, roomName: room.displayName, hasPassword: !!room.passwordSalt,
            canModerate: room.canModerate, permanent: room.permanent, x, y,
        });
    }, []);
    const handleRoomContextMenu = useCallback((e: React.MouseEvent, room: RoomInfo) => {
        e.preventDefault();
        e.stopPropagation();
        openRoomMenu(room, e.clientX, e.clientY);
    }, [openRoomMenu]);
    const longPress = useLongPress();
    const closeRoomMenu = useCallback(() => setRoomContextMenu(null), []);

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

    const getAdminProps = useCallback((roomId: string, participantIdentity: string) => {
        const room = rooms.find(r => r.id === roomId);
        if (!room?.canModerate) return undefined;
        const serverMuted = room.serverMutedParticipants.includes(participantIdentity);
        const voice = floorAction(participantIdentity, room);
        const actions = buildAdminActions(roomId, me?.role === 'admin');
        return {
            roomId,
            serverMuted,
            onKick: () => actions.onKick(participantIdentity),
            onBan: () => actions.onBan(participantIdentity),
            onToggleMute: () => actions.onToggleMute(participantIdentity, serverMuted),
            voice,
            onToggleVoice: () => actions.onToggleVoice(participantIdentity, voice === 'take'),
            moveTargets: moveTargets(rooms, roomId, participantIdentity),
            onMove: (to: string) => actions.onMove(participantIdentity, to),
            onServerBan: actions.onServerBan && (() => actions.onServerBan!(participantIdentity)),
        };
    }, [rooms, me?.role]);

    return (
        <div className="sidebar">
            {/* Header */}
            <div className="sidebar-header panel-header">
                <span className="logo">{me?.serverName ?? APP_NAME}</span>
                {onHide && (
                    <button className="sidebar-hide-btn" onClick={onHide} title={t('sidebar.hide')} aria-label={t('sidebar.hide')}>
                        <SidebarIcon size={18} />
                    </button>
                )}
                {onClose && (
                    <button className="sidebar-close-btn panel-close" onClick={onClose} title={t('sidebar.close')}>✕</button>
                )}
            </div>

            {/* Channel List */}
            <div
                className="sidebar-section"
                style={{ flex: 1, overflowY: 'auto' }}
                ref={channelListRef}
                onClick={handleUserCardClick}
            >
                <TextChannelList current={textView} inCall={!!activeRoom} onOpen={onOpenText} />
                {gated ? <p className="sidebar-gated">{t('rules.roomsLocked')}</p> : (<>
                <div className="sidebar-section-header">
                    <span className="sidebar-section-title section-title">{t('sidebar.rooms')}</span>
                    {canCreateRooms && (
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
                    )}
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
                            className={`channel-item ${activeRoom === room.id ? 'active' : ''}${room.canJoin ? '' : ' channel-item-locked'}${dropRoom === room.id ? ' channel-item-drop' : ''}`}
                            onClick={() => room.canJoin && onJoinRoom(room.id)}
                            onDragOver={(e) => {
                                if (!canDropOn(room.id)) return;
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                                if (dropRoom !== room.id) setDropRoom(room.id);
                            }}
                            onDragLeave={() => dropRoom === room.id && setDropRoom(null)}
                            onDrop={(e) => { e.preventDefault(); dropOn(room.id); }}
                            title={room.canJoin ? undefined : t('sidebar.membersOnly')}
                            onContextMenu={(e) => handleRoomContextMenu(e, room)}
                            {...longPress((x, y) => openRoomMenu(room, x, y))}
                        >
                            <SpeakerIcon className="channel-icon" size={14} />
                            <span className="channel-name">{room.displayName}</span>
                            {room.listeningParticipants?.length > 0 && (
                                <span className="channel-listens" title={t('bot.roomListens')} aria-label={t('bot.roomListens')} role="img">
                                    <EarIcon size={12} strokeWidth={2.2} />
                                </span>
                            )}
                            {room.passwordSalt && (
                                <span title={t('sidebar.passwordProtected')} style={{ display: 'flex', flexShrink: 0 }}>
                                    <LockIcon size={11} strokeWidth={2.5} style={{ opacity: 0.5 }} />
                                </span>
                            )}
                            {((room.id === activeRoom ? liveParticipants.size : room.numParticipants) > 0 || room.maxParticipants > 0) && (
                                <span className="channel-count">
                                    {room.id === activeRoom ? liveParticipants.size : room.numParticipants}
                                    {room.maxParticipants > 0 ? `/${room.maxParticipants}` : ''}
                                </span>
                            )}
                        </div>

                        {moveError?.roomId === room.id && <div className="channel-move-error" role="alert">{moveError.text}</div>}

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
                                        serverMuted={room.serverMutedParticipants?.includes(p.identity) ?? false}
                                        staticMuted={room.mutedParticipants?.includes(p.identity) ?? false}
                                        staticDeafened={room.deafenedParticipants?.includes(p.identity) ?? false}
                                        isScreenSharing={room.screenSharingParticipants?.includes(p.identity) ?? false}
                                        listens={room.listeningParticipants?.includes(p.identity) ?? false}
                                        onContextMenu={(e) => handleUserContextMenu(e, p.identity, p.name, room.id)}
                                        onDragStart={!isTouchDevice && p.identity !== identity && moveTargets(rooms, room.id, p.identity).length > 0
                                            ? (e) => {
                                                e.dataTransfer.effectAllowed = 'move';
                                                e.dataTransfer.setData('text/plain', p.name);
                                                setDragging({ identity: p.identity, from: room.id });
                                            }
                                            : undefined}
                                        onDragEnd={endDrag}
                                        onOpenProfile={isTouchDevice ? undefined : (e) => openProfileBeside(e, p.identity, p.name)}
                                    />
                                ))}
                                {isActiveRoom && room.canAddBots && (
                                    <button
                                        className="channel-user-card person-row channel-add-bot"
                                        onClick={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            setAddBotMenu({ roomId: room.id, locked: !!room.passwordSalt, x: rect.right + 8, y: rect.top });
                                        }}
                                    >
                                        <span className="channel-add-bot-plus"><PlusIcon size={14} strokeWidth={2.2} /></span>
                                        <span className="person-name">{t('addBot.row')}</span>
                                    </button>
                                )}
                            </div>
                        );
                        })()}
                    </div>
                ))}

                {visibleTemplates.length > 0 && (
                    <div className="channel-templates">
                        <div className="sidebar-section-header">
                            <span className="sidebar-section-title section-title">{t('sidebar.saved')}</span>
                        </div>
                        {visibleTemplates.map(template => (
                            <div
                                key={template.name}
                                className={`channel-item channel-item-template${templateError === template.name ? ' channel-item-error' : ''}`}
                                onClick={async () => {
                                    try {
                                        clearTemplateError();
                                        await onCreateRoom({ name: template.name, password: template.password, maxParticipants: template.maxParticipants, stage: template.stage });
                                    } catch {
                                        showTemplateError(template.name);
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
                                    <LockIcon className="channel-lock-icon" size={10} strokeWidth={2.5} />
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
                </>)}
            </div>

            {/* Footer */}
            <div className="sidebar-footer">
                {presenceStatus && onPresenceStatusChange ? (
                    <button
                        className="sidebar-footer-avatar sidebar-status-btn"
                        onClick={(e) => setStatusMenu(statusMenu ? null : e.currentTarget.getBoundingClientRect())}
                        title={t('status.change')}
                        aria-label={t('status.change')}
                        aria-haspopup="menu"
                    >
                        <WithStatus status={myStatus}>
                            <Avatar name={displayName || '?'} identity={identity} size={32} avatarUrl={myAvatarUrl ?? undefined} />
                        </WithStatus>
                    </button>
                ) : (
                    <div className="sidebar-footer-avatar">
                        <Avatar name={displayName || '?'} identity={identity} size={32} avatarUrl={myAvatarUrl ?? undefined} />
                    </div>
                )}
                {renaming ? (
                    <input
                        ref={renameInputRef}
                        className="sidebar-rename-input"
                        value={renameValue}
                        maxLength={MAX_NAME_LENGTH}
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

            {statusMenu && presenceStatus && onPresenceStatusChange && (
                <StatusMenu current={presenceStatus} anchor={statusMenu} onPick={onPresenceStatusChange} onClose={closeStatusMenu} />
            )}

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
                    onOpenProfile={() => openProfile({ identity: contextMenu.identity, name: contextMenu.name, x: contextMenu.x, y: contextMenu.y })}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {roomContextMenu && (
                <RoomContextMenu
                    roomId={roomContextMenu.roomId}
                    roomName={roomContextMenu.roomName}
                    hasPassword={roomContextMenu.hasPassword}
                    canModerate={roomContextMenu.canModerate}
                    permanent={roomContextMenu.permanent}
                    x={roomContextMenu.x}
                    y={roomContextMenu.y}
                    onOpenBans={setBansRoomId}
                    onClose={closeRoomMenu}
                />
            )}

            {addBotMenu && <AddBotMenu {...addBotMenu} onClose={closeAddBotMenu} />}

            {bansRoomId && (
                <BannedUsersModal
                    roomId={bansRoomId}
                    onClose={() => setBansRoomId(null)}
                />
            )}
        </div>
    );
});
