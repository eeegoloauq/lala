import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import './lib/i18n';
import { ChannelSidebar } from './features/channels';
import { RoomView } from './features/room';
import { WaveformWelcome } from './features/welcome/WaveformWelcome';
import { RoomHeader } from './features/room/RoomHeader';
import { ProfileCardHost } from './features/profile/ProfileCard';
import { ActivityPrompt } from './features/profile/ActivityPrompt';
import { useSettings } from './features/settings';
import { useTheme } from './features/settings/ThemeProvider';
import { useRooms } from './hooks/useRooms';
import { useMe } from './hooks/useMe';
import { MeContext } from './lib/meContext';
import { useRoute } from './hooks/useRoute';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useSidebarShortcut } from './hooks/useSidebarShortcut';
import { PeopleIcon, SidebarIcon } from './features/room/icons/Icons';
import { PeoplePanel } from './features/people/PeoplePanel';
import { usePresenceSync } from './hooks/usePresenceSync';
import { usePresence } from './lib/presence';
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
import { useTextChatSync } from './hooks/useTextChatSync';
import { loadChannels, openInCall, RULES_IN_CALL, useChannels, useRulesPending } from './lib/textChat';
import { setNotifyContext } from './lib/chatNotify';
import { useMyStatus } from './lib/presence';
import { presenceChanged } from './lib/presence';
import { RULES_REQUIRED_EVENT } from './lib/api';
import { TextChannelView } from './features/text/TextChannelView';
import { RulesView } from './features/text/RulesView';
import type { TextTarget } from './features/text/TextChannelList';
import './App.css';

const SettingsModal = lazy(() => import('./features/settings/SettingsModal').then(m => ({ default: m.SettingsModal })));

export default function App() {
    const { t } = useTranslation();
    const { rooms, error: roomsError, addRoom, refresh: refreshRooms } = useRooms();
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
    useTextChatSync(me?.identity, !!me?.textChats);
    // The server wants its rules agreed to first: until then the rules are all there is.
    const rulesPending = useRulesPending();
    usePresenceSync(me?.identity, displayName, settings.presenceStatus, rulesPending, {
        about: settings.profileAbout,
        shareLocalTime: settings.shareLocalTime,
        shareActivity: settings.shareActivity,
        shareBrowserMedia: settings.shareBrowserMedia,
    });
    useEffect(() => {
        // Only a server with text chats has rules to ask for.
        const onRequired = () => loadChannels();
        window.addEventListener(RULES_REQUIRED_EVENT, onRequired);
        return () => window.removeEventListener(RULES_REQUIRED_EVENT, onRequired);
    }, []);
    const handleRulesAgreed = useCallback(() => {
        loadChannels();
        refreshRooms();
        presenceChanged();
    }, [refreshRooms]);
    // The people list sits beside the call. Wide screens show it unless hidden (remembered);
    // narrower ones start without it, and phones open it as a drawer over the page.
    // A server without presence has no list and no button for it.
    const hasPresence = usePresence() !== null;
    const isWide = useMediaQuery('(min-width: 1100px)');
    const [peopleOpen, setPeopleOpen] = useState(false);
    const peopleDocked = hasPresence && !isPhone && (isWide ? !settings.peopleHidden : peopleOpen);
    const peopleOverlay = hasPresence && isPhone && peopleOpen;
    const togglePeople = () => {
        if (isWide) updateSettings({ peopleHidden: !settings.peopleHidden });
        else setPeopleOpen(open => !open);
    };
    const closePeople = useCallback(() => setPeopleOpen(false), []);
    useEffect(() => {
        if (!peopleOverlay) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePeople(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [peopleOverlay, closePeople]);
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

    const activeRoom = rulesPending ? null : route.roomId;
    // Outside a call the main area may show a text chat or the rules; in a call, chats open
    // in its side panel so the call stays on screen.
    const textView = rulesPending ? { kind: 'rules' as const } : activeRoom ? null : route.text;
    const textKey = textView?.kind === 'chat' ? textView.id : textView?.kind;

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

    const handleOpenText = useCallback((target: TextTarget) => {
        setSidebarOpen(false);
        // In a call both open in its side panel: picking one never leaves the call.
        if (activeRoom) openInCall(target.kind === 'rules' ? RULES_IN_CALL : target.id);
        else route.navigate(target.kind === 'rules' ? '/rules' : `/chat/${target.id}`);
    }, [activeRoom, route]);

    // What chat notifications need from here: settings, Do Not Disturb, names, and a way to open a chat.
    const channels = useChannels();
    const presenceList = usePresence();
    const myStatus = useMyStatus();
    useEffect(() => {
        setNotifyContext({
            me: me?.identity,
            sound: settings.soundChat,
            desktop: settings.chatNotifications,
            doNotDisturb: myStatus === 'dnd',
            open: (id) => handleOpenText({ kind: 'chat', id }),
            channelName: (id) => channels?.find(c => c.id === id)?.name,
            personName: (id) => presenceList?.get(id)?.name,
        });
    }, [me?.identity, settings.soundChat, settings.chatNotifications, myStatus, handleOpenText, channels, presenceList]);

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
                    <div className="sidebar-header panel-header" style={{ border: 'none', justifyContent: 'center', marginBottom: '16px' }}>
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
            <div className={`app-layout${!activeRoom && !textView ? ' no-room' : ''}${sidebarHidden ? ' sidebar-hidden' : ''}`}>
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
                        presenceStatus={hasPresence ? settings.presenceStatus : undefined}
                        onPresenceStatusChange={(presenceStatus) => updateSettings({ presenceStatus })}
                        textView={textView}
                        onOpenText={handleOpenText}
                        gated={rulesPending}
                    />
                </div>

                <main className={`main-content${hasPresence ? ' has-people-toggle' : ''}`}>
                    {hasPresence && (
                        <button
                            className={`people-toggle${peopleDocked || peopleOverlay ? ' active' : ''}`}
                            onClick={togglePeople}
                            title={peopleDocked || peopleOverlay ? t('people.hide') : t('people.show')}
                            aria-label={peopleDocked || peopleOverlay ? t('people.hide') : t('people.show')}
                            aria-pressed={peopleDocked || peopleOverlay}
                        >
                            <PeopleIcon size={18} />
                        </button>
                    )}
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
                    ) : textView?.kind === 'rules' ? (
                        <RulesView onAgreed={handleRulesAgreed} />
                    ) : textView?.kind === 'chat' ? (
                        <TextChannelView key={textKey} channel={textView.id} />
                    ) : (
                        <WaveformWelcome rooms={rooms} onJoinRoom={handleJoinRoom} onCreateRoom={handleCreateRoom} />
                    )}
                </main>

                {peopleDocked && <PeoplePanel rooms={rooms} displayName={displayName} />}
                {peopleOverlay && (
                    <>
                        <div className="people-backdrop" onClick={closePeople} />
                        <PeoplePanel rooms={rooms} displayName={displayName} onClose={closePeople} />
                    </>
                )}

                <ProfileCardHost rooms={rooms} onEditProfile={() => setSettingsOpen(true)} />
                {settings.shareActivity === 'ask' && <ActivityPrompt onAnswer={shareActivity => updateSettings({ shareActivity })} />}

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
