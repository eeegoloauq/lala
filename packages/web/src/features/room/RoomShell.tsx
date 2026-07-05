import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useTracks, RoomAudioRenderer, useLocalParticipant, useRoomContext, useParticipants, useConnectionState } from '@livekit/components-react';
import { isTrackReference } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { VideoGrid } from './VideoGrid/VideoGrid';
import { FocusLayout } from './FocusLayout/FocusLayout';
import { ControlBar } from './ControlBar/ControlBar';
import { ChatPanel } from './ChatPanel/ChatPanel';
import { useJoinLeaveSound, useScreenShareSound } from './hooks/useJoinLeaveSound';
import { useMicSound, useTalkingWhileMuted } from './hooks/useMicSounds';
import { useIosAudioKeepAlive } from './hooks/useIosAudioKeepAlive';
import { useRoomChat } from './hooks/useRoomChat';
import { usePushToTalk } from './hooks/usePushToTalk';
import { useAudioProcessor } from './hooks/useAudioProcessor';
import { usePersistedVolumes } from '../../hooks/usePersistedVolumes';
import { useRoomKeyboard } from '../../hooks/useRoomKeyboard';
import { useLocalControls } from './hooks/useLocalControls';
import { useScreenShare, getScreenShareQuality } from './hooks/useScreenShare';
import type { ScreenShareQuality } from './hooks/useScreenShare';
import { useAvatarCache } from './hooks/useAvatarCache';
import { useRoomStatusSync } from './hooks/useRoomStatusSync';
import { useRoomSystemMessages } from './hooks/useRoomSystemMessages';
import { useAdminActions } from './hooks/useAdminActions';
import { useParticipantVolumeSync } from './hooks/useParticipantVolumeSync';
import { useChatNotifications } from './hooks/useChatNotifications';
import { useReconnectingBanner } from './hooks/useReconnectingBanner';
import { RoomUIProvider } from './RoomUIContext';
import type { AppSettings } from '../settings/types';
import { IS_ELECTRON as isElectron } from '../../lib/env';

const ScreenShareModal = lazy(() => import('./ScreenShareModal/ScreenShareModal').then(m => ({ default: m.ScreenShareModal })));
const SCREEN_SHARE_TRACKS = [Track.Source.ScreenShare];

interface RoomShellProps {
    name: string;  // display name — used to call setName on join/change
    myAvatarUrl?: string | null;
    onSpeakersChange: (identities: string[]) => void;
    onMutedChange: (mutedIds: Set<string>) => void;
    onDeafenedChange: (deafenedIds: Set<string>) => void;
    onLiveParticipantsChange?: (participants: Map<string, string>) => void;
    onIdentityAssigned?: (identity: string) => void;
    onAvatarReceived?: (identity: string, dataUrl: string | null) => void;
    onOpenSettings?: () => void;
    settings: AppSettings;
    onUpdateSettings: (patch: Partial<AppSettings>) => void;
    volumes: Map<string, number>;
    onVolumeChange: (identity: string, vol: number) => void;
}

export function RoomShell({ name, myAvatarUrl, onSpeakersChange, onMutedChange, onDeafenedChange, onLiveParticipantsChange, onIdentityAssigned, onAvatarReceived, onOpenSettings, settings, onUpdateSettings, volumes, onVolumeChange }: RoomShellProps) {
    const { t } = useTranslation();
    const [chatOpen, setChatOpen] = useState(false);
    const [audioMuted, setAudioMuted] = useState(false);
    const [screenShareModalOpen, setScreenShareModalOpen] = useState(false);
    const [focusedIdentity, setFocusedIdentity] = useState<string | null>(null);
    const micWasEnabledRef = useRef(false);

    // Screen share volumes persisted separately
    const { volumes: screenVolumes, handleVolumeChange: handleScreenVolumeChange } =
        usePersistedVolumes('lala_screen_volumes');

    const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
    const participants = useParticipants();
    const room = useRoomContext();
    const connectionState = useConnectionState();

    // Keep LiveKit display name in sync with app display name
    useEffect(() => {
        localParticipant.setName(name);
    }, [name, localParticipant]);

    const avatarCache = useAvatarCache({
        room,
        participants,
        localParticipant,
        myAvatarUrl,
        onIdentityAssigned,
        onAvatarReceived,
    });

    useRoomStatusSync({
        room,
        participants,
        audioMuted,
        onMutedChange,
        onDeafenedChange,
        onSpeakersChange,
        onLiveParticipantsChange,
    });

    const { messages, send, isSending } = useRoomChat();

    const { chatEntries, addSystem, suppressLeave } = useRoomSystemMessages(room, t, settings, messages);

    const adminProps = useAdminActions({
        room,
        participants,
        localParticipant,
        t,
        settings,
        addSystem,
        suppressLeave,
    });

    usePushToTalk(settings.pushToTalk, settings.pushToTalkKey);
    useAudioProcessor({ noiseSuppressionMode: settings.noiseSuppressionMode, silenceGate: settings.silenceGate });

    const { mic, cam } = useLocalControls();
    const { enabled: screenEnabled, start: startScreen, stop: stopScreen } = useScreenShare();

    useJoinLeaveSound(settings.soundJoinLeave ?? true);
    useScreenShareSound(settings.soundScreenShare ?? true);
    useMicSound(settings.soundMicFeedback ?? true);
    useTalkingWhileMuted(settings.audioInputDeviceId || undefined, settings.soundTalkingWhileMuted ?? true);
    useIosAudioKeepAlive(true);

    useParticipantVolumeSync({ participants, volumes, onVolumeChange, screenVolumes });

    const { unreadCount, resetUnread } = useChatNotifications(settings, messages, chatOpen, localParticipant.identity, t);

    const handleOpenChat = useCallback(() => {
        setChatOpen((v) => {
            if (!v) resetUnread();
            return !v;
        });
    }, [resetUnread]);

    const handleFullscreen = useCallback(() => {
        if (!document.fullscreenEnabled) return;
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen();
        }
    }, []);


    // Wayland detection: on Wayland, the XDG portal handles source selection natively,
    // so we skip our custom source picker and don't call setScreenShareSource IPC.
    const [isWayland, setIsWayland] = useState(false);
    useEffect(() => {
        if (!isElectron) return;
        window.electronAPI!.getAppInfo().then(info => {
            if (info.isWayland) setIsWayland(true);
        }).catch(() => {});
    }, [isElectron]);

    const handleScreenShareToggle = useCallback(() => {
        if (screenEnabled) {
            stopScreen();
        } else if (settings.screenShareSkipDialog && (!isElectron || isWayland)) {
            console.log('[Lala] Screen share: skip dialog');
            startScreen(getScreenShareQuality(settings.screenShareFpsIdx, settings.screenShareBrIdx));
        } else {
            console.log('[Lala] Screen share: opening modal (isElectron:', isElectron, ', isWayland:', isWayland, ')');
            setScreenShareModalOpen(true);
        }
    }, [screenEnabled, startScreen, stopScreen, isElectron, isWayland, settings.screenShareSkipDialog, settings.screenShareFpsIdx, settings.screenShareBrIdx]);

    const handleScreenShareModalConfirm = useCallback((quality: ScreenShareQuality, sourceId?: string, audio?: boolean) => {
        setScreenShareModalOpen(false);
        startScreen(quality, sourceId, audio);
    }, [startScreen]);

    const handleToggleAudio = useCallback(() => {
        setAudioMuted((prev) => {
            const nextMuted = !prev;
            if (nextMuted) {
                micWasEnabledRef.current = isMicrophoneEnabled;
                if (isMicrophoneEnabled) localParticipant.setMicrophoneEnabled(false);
            } else {
                if (micWasEnabledRef.current) localParticipant.setMicrophoneEnabled(true);
            }
            const meta = JSON.stringify({ deafened: nextMuted });
            localParticipant.setMetadata(meta).catch(() => {
                setTimeout(() => localParticipant.setMetadata(meta).catch(console.warn), 1500);
            });
            return nextMuted;
        });
    }, [isMicrophoneEnabled, localParticipant]);

    useRoomKeyboard({
        onMicToggle: mic.toggle,
        onCamToggle: cam.toggle,
        onDeafen: handleToggleAudio,
        onChat: handleOpenChat,
        onFullscreen: handleFullscreen,
        onScreenShare: handleScreenShareToggle,
        onEscape: () => setChatOpen(false),
        pttKey: settings.pushToTalk ? settings.pushToTalkKey : undefined,
        enabled: settings.shortcutsEnabled ?? true,
        keyMic: settings.keyMic,
        keyCam: settings.keyCam,
        keyDeafen: settings.keyDeafen,
        keyChat: settings.keyChat,
        keyFullscreen: settings.keyFullscreen,
        keyScreenShare: settings.keyScreenShare,
    });

    const screenTracks = useTracks(SCREEN_SHARE_TRACKS);
    const isScreenSharing = screenTracks.some(
        (t) => isTrackReference(t) && t.publication.isSubscribed && !t.publication.isMuted,
    );

    const roomUIValue = useMemo(() => ({
        audioMuted,
        avatarCache,
        volumes,
        onVolumeChange,
        screenVolumes,
        onScreenVolumeChange: handleScreenVolumeChange,
        admin: adminProps,
        settings,
        onOpenSettings,
    }), [audioMuted, avatarCache, volumes, onVolumeChange, screenVolumes, handleScreenVolumeChange, adminProps, settings, onOpenSettings]);

    const showReconnecting = useReconnectingBanner(connectionState);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
            <RoomAudioRenderer muted={audioMuted} />

            {showReconnecting && (
                <div className="reconnecting-banner">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="reconnecting-spinner">
                        <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                    </svg>
                    {t('room.reconnecting')}
                </div>
            )}

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' }}>
                <RoomUIProvider value={roomUIValue}>
                    {isScreenSharing || focusedIdentity
                        ? <FocusLayout
                            initialIdentity={focusedIdentity}
                            onExit={focusedIdentity && !isScreenSharing ? () => setFocusedIdentity(null) : undefined}
                        />
                        : <VideoGrid onFocusTile={setFocusedIdentity} onCamEnabled={setFocusedIdentity} />
                    }
                </RoomUIProvider>
            </div>

            {chatOpen && (
                <ChatPanel
                    entries={chatEntries}
                    send={send}
                    isSending={isSending}
                    onClose={() => setChatOpen(false)}
                    overlay
                />
            )}

            {screenShareModalOpen && (
                <Suspense fallback={null}>
                    <ScreenShareModal
                        settings={settings}
                        onUpdateSettings={onUpdateSettings}
                        onConfirm={handleScreenShareModalConfirm}
                        onCancel={() => setScreenShareModalOpen(false)}
                        skipSourcePicker={isWayland}
                    />
                </Suspense>
            )}

            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
                <ControlBar
                    audioMuted={audioMuted}
                    onToggleAudio={handleToggleAudio}
                    chatOpen={chatOpen}
                    onToggleChat={handleOpenChat}
                    unreadCount={unreadCount}
                    settings={settings}
                    onUpdateSettings={onUpdateSettings}
                    onScreenShareClick={handleScreenShareToggle}
                />
            </div>
        </div>
    );
}
