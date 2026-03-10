import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import './lib/i18n';
import { ChannelSidebar } from './features/channels';
import { RoomView } from './features/room';
import { WaveformWelcome } from './features/welcome/WaveformWelcome';
import { useSettings } from './features/settings';
import { useRooms } from './hooks/useRooms';
import { useRoute } from './hooks/useRoute';
import { useDisplayName } from './hooks/useDisplayName';
import { usePersistedVolumes } from './hooks/usePersistedVolumes';
import { getOrCreateIdentity, getCachedHmacIdentity, saveCachedHmacIdentity } from './lib/identity';
import type { CreateRoomRequest } from './lib/types';
import { MAX_NAME_LENGTH } from './lib/constants';
import { getMyAvatar, saveMyAvatar, clearMyAvatar, setCachedAvatar, clearCachedAvatar } from './lib/avatarUtils';
import { saveRoomPassword } from './lib/passwords';
import './App.css';

const SettingsModal = lazy(() => import('./features/settings/SettingsModal').then(m => ({ default: m.SettingsModal })));

export default function App() {
    const { t } = useTranslation();
    const { rooms, error: roomsError, addRoom } = useRooms();
    const { displayName, setDisplayName } = useDisplayName();
    const [identity] = useState(getOrCreateIdentity);
    const { settings, updateSettings } = useSettings();
    const route = useRoute();
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());
    const [mutedInRoom, setMutedInRoom] = useState<Set<string>>(new Set());
    const [deafenedInRoom, setDeafenedInRoom] = useState<Set<string>>(new Set());
    const [liveParticipants, setLiveParticipants] = useState<Map<string, string>>(new Map());
    const [liveAvatarCache, setLiveAvatarCache] = useState<Map<string, string>>(new Map());
    const handleRoomAvatarReceived = useCallback((identity: string, dataUrl: string | null) => {
        setLiveAvatarCache(prev => {
            const next = new Map(prev);
            if (dataUrl) next.set(identity, dataUrl);
            else next.delete(identity);
            return next;
        });
    }, []);
    const { volumes, handleVolumeChange } = usePersistedVolumes();
    const [myAvatar, setMyAvatar] = useState(getMyAvatar);
    const [liveIdentity, setLiveIdentity] = useState<string | null>(() => getCachedHmacIdentity(identity));

    const handleIdentityAssigned = useCallback((id: string) => {
        saveCachedHmacIdentity(identity, id);
        setLiveIdentity(id);
    }, [identity]);

    const handleAvatarChange = useCallback((dataUrl: string | null) => {
        if (dataUrl) {
            saveMyAvatar(dataUrl);
            setCachedAvatar(identity, dataUrl);
        } else {
            clearMyAvatar();
            clearCachedAvatar(identity);
        }
        setMyAvatar(dataUrl);
    }, [identity]);


    useEffect(() => {
        const color = settings.accentColor;
        const root = document.documentElement;
        if (!color) {
            ['--accent', '--accent-hover', '--accent-glow', '--accent-gradient', '--text-accent']
                .forEach(v => root.style.removeProperty(v));
            return;
        }
        const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
        const darker = (n: number) => Math.round(n * 0.82).toString(16).padStart(2, '0');
        const lighter = (n: number) => Math.min(255, Math.round(n + (255 - n) * 0.35)).toString(16).padStart(2, '0');
        const light = `#${lighter(r)}${lighter(g)}${lighter(b)}`;
        root.style.setProperty('--accent', color);
        root.style.setProperty('--accent-hover', `#${darker(r)}${darker(g)}${darker(b)}`);
        root.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.3)`);
        root.style.setProperty('--accent-gradient', `linear-gradient(135deg,${color},${light})`);
        root.style.setProperty('--text-accent', light);
    }, [settings.accentColor]);

    const activeRoom = route.roomId;

    const handleJoinRoom = (id: string) => {
        route.navigate('/room/' + id);
        setSidebarOpen(false);
    };

    const handleLeave = () => {
        route.navigate('/');
        setSpeakingUsers(new Set());
        setMutedInRoom(new Set());
        setDeafenedInRoom(new Set());
        setLiveParticipants(new Map());
        setLiveAvatarCache(new Map());
        // Clear session for crash recovery
        window.electronAPI?.saveSession?.(null);
    };

    const handleCreateRoom = async (req: CreateRoomRequest) => {
        const room = await addRoom({ ...req, identity });
        if (room.adminSecret) {
            localStorage.setItem(`lala_admin_${room.id}`, room.adminSecret);
        }
        if (req.password) {
            saveRoomPassword(room.id, req.password);
        }
        route.navigate('/room/' + room.id);
        setSidebarOpen(false);
    };

    if (!displayName) {
        return (
            <div className="app-layout" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <div className="home-card">
                    <div className="sidebar-header" style={{ border: 'none', justifyContent: 'center', marginBottom: '16px' }}>
                        <span className="logo" style={{ fontSize: '32px' }}>lala</span>
                    </div>
                    <p>{t('welcome.enterName')}</p>
                    <div className="input-group">
                        <input
                            className="input"
                            placeholder={t('welcome.namePlaceholder')}
                            autoFocus
                            maxLength={MAX_NAME_LENGTH}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    const val = (e.target as HTMLInputElement).value.trim();
                                    if (val) setDisplayName(val);
                                }
                            }}
                        />
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {t('welcome.pressEnter')}
                    </p>
                </div>
            </div>
        );
    }

    const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

    return (
        <div className={`app-layout${!activeRoom ? ' no-room' : ''}`}>
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
                    identity={liveIdentity || identity}
                    avatarCache={liveAvatarCache}
                    displayName={displayName}
                    myAvatarUrl={myAvatar}
                    liveParticipants={liveParticipants}
                    onRename={setDisplayName}
                    speakingUsers={speakingUsers}
                    mutedInRoom={mutedInRoom}
                    deafenedInRoom={deafenedInRoom}
                    onJoinRoom={handleJoinRoom}
                    onCreateRoom={handleCreateRoom}
                    onOpenSettings={() => { setSettingsOpen(true); setSidebarOpen(false); }}
                    onClose={() => setSidebarOpen(false)}
                    volumes={volumes}
                    onVolumeChange={handleVolumeChange}
                />
            </div>

            <main className="main-content">
                <button
                    className="sidebar-hamburger"
                    onClick={() => setSidebarOpen(true)}
                    title={t('app.openSidebar')}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <line x1="3" y1="6" x2="21" y2="6" />
                        <line x1="3" y1="12" x2="21" y2="12" />
                        <line x1="3" y1="18" x2="21" y2="18" />
                    </svg>
                </button>

                {activeRoom ? (
                    <RoomView
                        roomName={activeRoom}
                        name={displayName}
                        identity={identity}
                        hashPassword={route.hashPassword}
                        myAvatarUrl={myAvatar}
                        settings={settings}
                        onUpdateSettings={updateSettings}
                        onLeave={handleLeave}
                        onIdentityAssigned={handleIdentityAssigned}
                        onAvatarReceived={handleRoomAvatarReceived}
                        onSpeakersChange={(ids) => setSpeakingUsers(new Set(ids))}
                        onMutedChange={setMutedInRoom}
                        onDeafenedChange={setDeafenedInRoom}
                        onLiveParticipantsChange={setLiveParticipants}
                        onOpenSettings={() => setSettingsOpen(true)}
                        volumes={volumes}
                        onVolumeChange={handleVolumeChange}
                    />
                ) : (
                    <WaveformWelcome />
                )}
            </main>

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
    );
}
