import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import './lib/i18n';
import { ChannelSidebar } from './features/channels';
import { RoomView } from './features/room';
import { WaveformWelcome } from './features/welcome/WaveformWelcome';
import { RoomHeader } from './features/room/RoomHeader';
import { ProfileCardHost } from './features/profile/ProfileCard';
import { useSettings } from './features/settings';
import { useTheme } from './features/settings/ThemeProvider';
import { useRooms } from './hooks/useRooms';
import { useMe } from './hooks/useMe';
import { MeContext } from './lib/meContext';
import { useRoute } from './hooks/useRoute';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useSidebarShortcut } from './hooks/useSidebarShortcut';
import { SidebarIcon } from './features/room/icons/Icons';
import { useDisplayName } from './hooks/useDisplayName';
import { usePersistedVolumes } from './hooks/usePersistedVolumes';
import type { NewRoom } from './lib/types';
import { deriveRoomKeys, newRoomSalt } from './lib/roomKeys';
import { MAX_NAME_LENGTH } from './lib/constants';
import { getMyAvatar, saveMyAvatar, clearMyAvatar, dropLegacyAvatarCache } from './lib/avatarUtils';
import { deleteAvatar, uploadAvatar } from './lib/api';
import { usePublishAvatars } from './hooks/usePublishAvatars';
import { saveRoomPassword, getRoomPassword } from './lib/passwords';
import { getTemplates, saveTemplate } from './lib/roomTemplates';
import { resetRoomSession, setModerationInRoom } from './lib/roomStatusStore';
import { setListedRooms } from './lib/moving';
import './App.css';

const SettingsModal = lazy(() => import('./features/settings/SettingsModal').then(m => ({ default: m.SettingsModal })));

export default function App() {
    const { t } = useTranslation();
    const { rooms, error: roomsError, addRoom } = useRooms();
    const { displayName, setDisplayName } = useDisplayName();
    const me = useMe();
    const { settings, updateSettings } = useSettings();
    const route = useRoute();
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [nameDraft, setNameDraft] = useState('');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    // The phone drawer is a history entry, so the Back button closes it as people expect.
    // Closing it any other way drops that entry again; joining a room from it pushes the
    // room's URL over the entry instead, which then needs no cleanup.
    useEffect(() => {
        if (!sidebarOpen) return;
        window.history.pushState({ lalaDrawer: true }, '');
        const onPop = () => setSidebarOpen(false);
        window.addEventListener('popstate', onPop);
        return () => {
            window.removeEventListener('popstate', onPop);
            if (window.history.state?.lalaDrawer) window.history.back();
        };
    }, [sidebarOpen]);
    // Phones open the room list as a drawer over the call; wider screens dock it and may hide it.
    const isPhone = useMediaQuery('(max-width: 640px)');
    const sidebarHidden = settings.sidebarHidden && !isPhone;
    const toggleSidebar = useCallback(() => {
        if (isPhone) setSidebarOpen(open => !open);
        else updateSettings({ sidebarHidden: !settings.sidebarHidden });
    }, [isPhone, settings.sidebarHidden, updateSettings]);
    useSidebarShortcut(settings, toggleSidebar);
    const { volumes, handleVolumeChange } = usePersistedVolumes();
    const [myAvatar, setMyAvatar] = useState(getMyAvatar);
    // The server is where others get the avatar from; this device's copy is the original.
    // Rejected (offline, too large) means nothing changed, and the caller shows the error.
    const handleAvatarChange = useCallback(async (dataUrl: string | null) => {
        if (dataUrl) await uploadAvatar(dataUrl);
        else await deleteAvatar();
        if (dataUrl) saveMyAvatar(dataUrl);
        else clearMyAvatar();
        setMyAvatar(dataUrl);
    }, []);
    // The server drops an avatar unused for 90 days (or loses Redis); this device then
    // uploads its copy again. Also moves avatars set before they were kept on the server.
    const avatarChecked = useRef(false);
    useEffect(() => {
        if (!me || avatarChecked.current) return;
        avatarChecked.current = true;
        dropLegacyAvatarCache();
        const local = getMyAvatar();
        if (local && !me.avatar) uploadAvatar(local).catch(err => console.warn('[App] Uploading the avatar failed:', err));
    }, [me]);
    usePublishAvatars(rooms, me?.identity, myAvatar);
    // The call's tiles and menus read server mutes, the floor and the rooms to move people
    // to from the same list as the sidebar.
    useEffect(() => {
        setModerationInRoom(rooms.find(r => r.id === route.roomId));
        setListedRooms(rooms);
    }, [rooms, route.roomId]);


    // The server's default theme and the user's accent reach the theme from here.
    const { setInputs: setThemeInputs } = useTheme();
    // Until /api/me answers, the theme the server sent last time stays.
    useEffect(() => {
        if (me) setThemeInputs({ serverTheme: me.theme });
    }, [setThemeInputs, me]);
    useEffect(() => {
        setThemeInputs({ accent: settings.accentColor });
    }, [setThemeInputs, settings.accentColor]);

    const activeRoom = route.roomId;

    // Keep a ref to rooms so the auto-save timer can read latest data
    const roomsRef = useRef(rooms);
    roomsRef.current = rooms;

    // Auto-save room as template after 30s of being in the room
    useEffect(() => {
        if (!activeRoom) return;
        const timer = setTimeout(() => {
            const room = roomsRef.current.find(r => r.id === activeRoom);
            if (!room) return;
            const password = getRoomPassword(room.id) || undefined;
            saveTemplate({
                name: room.displayName,
                password,
                maxParticipants: room.maxParticipants || undefined,
            });
        }, 30_000);
        return () => clearTimeout(timer);
    }, [activeRoom]);

    const handleJoinRoom = (id: string) => {
        route.navigate('/room/' + id);
        setSidebarOpen(false);
    };

    const handleLeave = () => {
        route.navigate('/');
        resetRoomSession();
    };

    const { navigate } = route;
    const handleCreateRoom = useCallback(async (req: NewRoom) => {
        const salt = req.password ? newRoomSalt() : undefined;
        const password = req.password && salt
            ? { salt, key: (await deriveRoomKeys(req.password, salt)).authKey }
            : undefined;
        const room = await addRoom({ name: req.name, maxParticipants: req.maxParticipants, stage: req.stage, password });
        if (req.password) {
            saveRoomPassword(room.id, req.password);
        }
        saveTemplate({
            name: req.name,
            password: req.password || undefined,
            maxParticipants: req.maxParticipants || undefined,
            stage: req.stage || undefined,
        });
        navigate('/room/' + room.id);
        setSidebarOpen(false);
    }, [addRoom, navigate]);

    // Desktop option: on launch, go into the most recent room, created again if it has
    // ended. Creating by name returns the live room, so friends launching together meet
    // in one room. Once per launch, and a room link opened at launch wins.
    const autoJoinTried = useRef(false);
    useEffect(() => {
        if (autoJoinTried.current || !displayName) return;
        autoJoinTried.current = true;
        const last = getTemplates()[0];
        if (!settings.autoJoinLastRoom || route.roomId || !last) return;
        handleCreateRoom(last).catch(err => console.warn('[App] Joining the last room failed:', err));
    }, [displayName, settings.autoJoinLastRoom, route.roomId, handleCreateRoom]);

    if (!displayName) {
        return (
            <div className="app-layout" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <form
                    className="home-card"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (nameDraft.trim()) setDisplayName(nameDraft.trim());
                    }}
                >
                    <div className="sidebar-header" style={{ border: 'none', justifyContent: 'center', marginBottom: '16px' }}>
                        <span className="logo" style={{ fontSize: '32px' }}>lala</span>
                    </div>
                    <p>{t('welcome.enterName')}</p>
                    <div className="input-group">
                        <input
                            className="input"
                            placeholder={t('welcome.namePlaceholder')}
                            aria-label={t('welcome.namePlaceholder')}
                            autoFocus
                            maxLength={MAX_NAME_LENGTH}
                            value={nameDraft}
                            onChange={e => setNameDraft(e.target.value)}
                        />
                    </div>
                    <button className="btn btn-primary" type="submit" disabled={!nameDraft.trim()}>
                        {t('welcome.continue')}
                    </button>
                </form>
            </div>
        );
    }


    return (
        <MeContext.Provider value={me}>
            <div className={`app-layout${!activeRoom ? ' no-room' : ''}${sidebarHidden ? ' sidebar-hidden' : ''}`}>
                {sidebarOpen && (
                    <div
                        className="sidebar-mobile-overlay"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}

                <div className={`sidebar-wrapper${sidebarOpen ? ' sidebar-mobile-open' : ''}`}>
                    <ChannelSidebar
                        rooms={rooms}
                        roomsError={roomsError}
                        activeRoom={activeRoom}
                        displayName={displayName}
                        myAvatarUrl={myAvatar}
                        onRename={setDisplayName}
                        onJoinRoom={handleJoinRoom}
                        onCreateRoom={handleCreateRoom}
                        onOpenSettings={() => { setSettingsOpen(true); setSidebarOpen(false); }}
                        onClose={activeRoom ? () => setSidebarOpen(false) : undefined}
                        onHide={() => updateSettings({ sidebarHidden: true })}
                        volumes={volumes}
                        onVolumeChange={handleVolumeChange}
                    />
                </div>

                <main className="main-content">
                    <button
                        className="sidebar-hamburger"
                        onClick={isPhone ? () => setSidebarOpen(true) : toggleSidebar}
                        title={t('app.openSidebar')}
                        aria-label={t('app.openSidebar')}
                    >
                        {isPhone ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                                <line x1="3" y1="6" x2="21" y2="6" />
                                <line x1="3" y1="12" x2="21" y2="12" />
                                <line x1="3" y1="18" x2="21" y2="18" />
                            </svg>
                        ) : <SidebarIcon size={18} />}
                    </button>

                    {activeRoom && <RoomHeader room={rooms.find(r => r.id === activeRoom)} />}
                    {activeRoom ? (
                        <RoomView
                            roomName={activeRoom}
                            name={displayName}
                            hashPassword={route.hashPassword}
                            settings={settings}
                            onUpdateSettings={updateSettings}
                            onLeave={handleLeave}
                            onMoved={handleJoinRoom}
                            onOpenSettings={() => setSettingsOpen(true)}
                            volumes={volumes}
                            onVolumeChange={handleVolumeChange}
                        />
                    ) : (
                        <WaveformWelcome rooms={rooms} onJoinRoom={handleJoinRoom} />
                    )}
                </main>

                <ProfileCardHost rooms={rooms} />

                {settingsOpen && (
                    <Suspense fallback={null}>
                        <SettingsModal
                            settings={settings}
                            onUpdate={updateSettings}
                            onClose={() => setSettingsOpen(false)}
                            displayName={displayName}
                            onRename={setDisplayName}
                            myAvatar={myAvatar}
                            onAvatarChange={handleAvatarChange}
                        />
                    </Suspense>
                )}
            </div>
        </MeContext.Provider>
    );
}
