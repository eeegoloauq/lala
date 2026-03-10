import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { useTracks, RoomAudioRenderer, useLocalParticipant, useRoomContext, useParticipants, useConnectionState } from '@livekit/components-react';
import { isTrackReference } from '@livekit/components-react';
import { Track, RoomEvent, RemoteParticipant, ConnectionState } from 'livekit-client';
import type { Participant, RemoteAudioTrack, RemoteTrackPublication } from 'livekit-client';
import { VideoGrid } from './VideoGrid/VideoGrid';
import { FocusLayout } from './FocusLayout/FocusLayout';
import { ControlBar } from './ControlBar/ControlBar';
import { ChatPanel } from './ChatPanel/ChatPanel';
import type { ChatEntry } from './ChatPanel/ChatPanel';
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
import { playJoinSound, playChatSound } from '../../lib/sounds';
import { speak } from '../../lib/tts';
import { kickParticipant, banParticipant, muteParticipant } from '../../lib/api';
import { ApiError } from '../../lib/types';
import { useAvatarSync } from '../../hooks/useAvatarSync';
import { getCachedAvatar, setCachedAvatar, clearCachedAvatar } from '../../lib/avatarUtils';
import type { AppSettings } from '../settings/types';

const ScreenShareModal = lazy(() => import('./ScreenShareModal/ScreenShareModal').then(m => ({ default: m.ScreenShareModal })));
const DEFAULT_VOLUME = 50;
const SCREEN_SHARE_TRACKS = [Track.Source.ScreenShare];

function formatAdminMsg(action: string, target: string, by: string): string {
    const key = `admin.${action}`;
    if (i18next.exists(key)) {
        return i18next.t(key, { by, target });
    }
    return `${by}: ${action} → ${target}`;
}

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
    const [avatarCache, setAvatarCache] = useState<Map<string, string>>(new Map());
    const micWasEnabledRef = useRef(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);

    // System entries carry insertion order for correct chat interleaving
    const [systemEntries, setSystemEntries] = useState<ChatEntry[]>([]);

    // Screen share volumes persisted separately
    const { volumes: screenVolumes, handleVolumeChange: handleScreenVolumeChange } =
        usePersistedVolumes('lala_screen_volumes');

    // Keep settings in a ref so event handlers registered once don't go stale
    const settingsRef = useRef(settings);
    useEffect(() => { settingsRef.current = settings; });

    // Insertion-order counter shared by system entries and chat messages
    // Ensures correct interleaving regardless of server vs client clock skew
    const orderCounterRef = useRef(0);
    const msgOrderRef = useRef(new Map<string, number>());

    const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
    const participants = useParticipants();
    const room = useRoomContext();
    const connectionState = useConnectionState();

    // Keep LiveKit display name in sync with app display name
    useEffect(() => {
        localParticipant.setName(name);
    }, [name, localParticipant]);

    // Keep active participants in sync for sidebar
    useEffect(() => {
        if (!onLiveParticipantsChange) return;
        const live = new Map<string, string>();
        participants.forEach(p => {
            if (p.identity) live.set(p.identity, p.name || p.identity);
        });
        onLiveParticipantsChange(live);
    }, [participants, onLiveParticipantsChange]);

    // Pre-populate avatarCache from localStorage for participants already in the room.
    // Uses name-based fallback so avatars survive identity rotation across page refreshes.
    useEffect(() => {
        setAvatarCache(prev => {
            let changed = false;
            const next = new Map(prev);
            for (const p of participants) {
                if (!next.has(p.identity)) {
                    const cached = getCachedAvatar(p.identity);
                    if (cached) { next.set(p.identity, cached); changed = true; }
                }
            }
            return changed ? next : prev;
        });
    }, [participants]);

    // Track real-time mic mute state for all participants → sidebar
    // Uses room.remoteParticipants directly (live Map) to avoid stale closure from useParticipants() snapshot
    useEffect(() => {
        const buildMuted = () => {
            const s = new Set<string>();
            room.remoteParticipants.forEach(p => {
                if (!p.isMicrophoneEnabled) s.add(p.identity);
            });
            if (!room.localParticipant.isMicrophoneEnabled) s.add(room.localParticipant.identity);
            return s;
        };
        onMutedChange(buildMuted());
        const update = () => onMutedChange(buildMuted());
        room.on(RoomEvent.TrackMuted, update);
        room.on(RoomEvent.TrackUnmuted, update);
        room.on(RoomEvent.TrackPublished, update);
        room.on(RoomEvent.TrackUnpublished, update);
        room.on(RoomEvent.LocalTrackPublished, update);
        room.on(RoomEvent.LocalTrackUnpublished, update);
        room.on(RoomEvent.ParticipantConnected, update);
        room.on(RoomEvent.ParticipantDisconnected, update);
        return () => {
            room.off(RoomEvent.TrackMuted, update);
            room.off(RoomEvent.TrackUnmuted, update);
            room.off(RoomEvent.TrackPublished, update);
            room.off(RoomEvent.TrackUnpublished, update);
            room.off(RoomEvent.LocalTrackPublished, update);
            room.off(RoomEvent.LocalTrackUnpublished, update);
            room.off(RoomEvent.ParticipantConnected, update);
            room.off(RoomEvent.ParticipantDisconnected, update);
        };
    }, [room]);

    // Deafen state: track via participant metadata (setMetadata broadcasts to all clients)
    // Local participant: use immediate audioMuted state (no async round-trip)
    // Remotes: read room.remoteParticipants directly to avoid stale snapshot from useParticipants()
    useEffect(() => {
        const buildDeafened = () => {
            const s = new Set<string>();
            if (audioMuted) s.add(room.localParticipant.identity);
            room.remoteParticipants.forEach(p => {
                try { if (JSON.parse(p.metadata || '{}').deafened) s.add(p.identity); } catch { /* ignore malformed */ }
            });
            return s;
        };
        onDeafenedChange(buildDeafened());
        const update = () => onDeafenedChange(buildDeafened());
        room.on(RoomEvent.ParticipantMetadataChanged, update);
        room.on(RoomEvent.ParticipantConnected, update);
        room.on(RoomEvent.ParticipantDisconnected, update);
        return () => {
            room.off(RoomEvent.ParticipantMetadataChanged, update);
            room.off(RoomEvent.ParticipantConnected, update);
            room.off(RoomEvent.ParticipantDisconnected, update);
        };
    }, [room, audioMuted]);

    const handleAvatarReceived = useCallback((identity: string, dataUrl: string | null) => {
        setAvatarCache(prev => {
            const next = new Map(prev);
            if (dataUrl) next.set(identity, dataUrl);
            else next.delete(identity);
            return next;
        });
        onAvatarReceived?.(identity, dataUrl);
    }, [onAvatarReceived]);

    useAvatarSync({ room, myAvatarUrl: myAvatarUrl ?? null, onAvatarReceived: handleAvatarReceived });

    // Keep own avatar in the cache so local participant tile shows it too.
    // Also persist to localStorage (sidebar reads from there) and notify parent of LiveKit identity.
    useEffect(() => {
        const id = localParticipant.identity;
        if (!id) return;
        onIdentityAssigned?.(id);
        setAvatarCache(prev => {
            if (prev.get(id) === (myAvatarUrl ?? undefined)) return prev;
            const next = new Map(prev);
            if (myAvatarUrl) {
                next.set(id, myAvatarUrl);
            } else {
                next.delete(id);
            }
            return next;
        });
        // Persist to localStorage so ChannelSidebar can find own avatar by LiveKit identity
        if (myAvatarUrl) setCachedAvatar(id, myAvatarUrl);
        else clearCachedAvatar(id);
    }, [myAvatarUrl, localParticipant.identity]);

    const adminSecret = localStorage.getItem(`lala_admin_${room.name}`) ?? undefined;

    // Identities that were kicked or banned — suppress the redundant "left" system message for them.
    // Cleared after 10s to avoid stale entries if the disconnect never arrives.
    const suppressLeaveRef = useRef(new Set<string>());
    const suppressLeave = (identity: string) => {
        suppressLeaveRef.current.add(identity);
        setTimeout(() => suppressLeaveRef.current.delete(identity), 10_000);
    };

    const addSystem = (text: string, id: string) => {
        setSystemEntries(prev => [...prev, {
            kind: 'system' as const,
            id,
            timestamp: Date.now(),
            order: orderCounterRef.current++,
            text,
        }]);
    };

    // Broadcast admin action to all participants via data channel.
    // Sender doesn't receive their own DataReceived, so we also add locally.
    const broadcastAdminAction = useCallback((action: string, targetIdentity: string) => {
        const targetName = participants.find(p => p.identity === targetIdentity)?.name || targetIdentity;
        const byName = localParticipant.name || localParticipant.identity;
        // Include identity so receivers can also suppress the redundant "left" message
        const payload = new TextEncoder().encode(JSON.stringify({
            type: 'lala_admin', action, target: targetName, by: byName, identity: targetIdentity,
        }));
        room.localParticipant.publishData(payload, { reliable: true });
        // Kick/ban will trigger ParticipantDisconnected — suppress "left" for that user on this client
        if (action === 'kicked' || action === 'banned') suppressLeave(targetIdentity);
        const text = formatAdminMsg(action, targetName, byName);
        addSystem(text, `admin-${action}-${targetIdentity}-${Date.now()}`);
        if (settingsRef.current.chatTTS) speak(text, ttsOpts());
    }, [room, localParticipant, participants]);

    // Receive admin events from other clients
    useEffect(() => {
        const onData = (data: Uint8Array, sender?: { identity: string; name?: string }) => {
            try {
                const msg = JSON.parse(new TextDecoder().decode(data));
                if (msg.type !== 'lala_admin') return;
                // Use sender's actual name from LiveKit (not msg.by which could be spoofed)
                const byName = sender?.name || sender?.identity || msg.by;
                // Suppress the upcoming "left" message for kicked/banned users on all clients
                if ((msg.action === 'kicked' || msg.action === 'banned') && msg.identity) {
                    suppressLeave(msg.identity);
                }
                const text = formatAdminMsg(msg.action, msg.target, byName);
                addSystem(text, `admin-${msg.action}-${msg.target}-${Date.now()}`);
                if (settingsRef.current.chatTTS) speak(text, ttsOpts());
            } catch { /* ignore malformed data */ }
        };
        room.on(RoomEvent.DataReceived, onData);
        return () => { room.off(RoomEvent.DataReceived, onData); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [room]);

    const handleAdminError = useCallback((err: unknown) => {
        if (err instanceof ApiError && err.code === 'rate_limited') {
            addSystem(t('admin.rateLimited'), `admin-ratelimit-${Date.now()}`);
        }
    }, [t]);

    const adminProps = useMemo(() => adminSecret ? {
        adminSecret,
        roomId: room.name,
        onKick: async (identity: string) => {
            broadcastAdminAction('kicked', identity);
            try { await kickParticipant(room.name, identity, adminSecret); }
            catch (e) { handleAdminError(e); }
        },
        onBan: async (identity: string) => {
            broadcastAdminAction('banned', identity);
            try { await banParticipant(room.name, identity, adminSecret); }
            catch (e) { handleAdminError(e); }
        },
        onToggleMute: async (identity: string, serverMuted: boolean) => {
            broadcastAdminAction(serverMuted ? 'unmuted' : 'muted', identity);
            try { await muteParticipant(room.name, identity, adminSecret, !serverMuted); }
            catch (e) { handleAdminError(e); }
        },
    } : undefined, [adminSecret, room.name, broadcastAdminAction, handleAdminError]);
    usePushToTalk(settings.pushToTalk, settings.pushToTalkKey);
    useAudioProcessor({ noiseSuppressionMode: settings.noiseSuppressionMode, silenceGate: settings.silenceGate });

    const { mic, cam } = useLocalControls();
    const { enabled: screenEnabled, start: startScreen, stop: stopScreen } = useScreenShare();

    const { messages, send, isSending } = useRoomChat();
    const prevMsgCountRef = useRef(0);

    useJoinLeaveSound(settings.soundJoinLeave ?? true);
    useScreenShareSound(settings.soundScreenShare ?? true);
    useMicSound(settings.soundMicFeedback ?? true);
    useTalkingWhileMuted(settings.audioInputDeviceId || undefined, settings.soundTalkingWhileMuted ?? true);
    useIosAudioKeepAlive(true);

    // Rebuild sorted chat entries whenever messages or system entries change.
    // Must be useEffect (not useMemo) so msgOrderRef is always populated before we read it.
    useEffect(() => {
        // Assign insertion order to new messages (sort within batch by server timestamp)
        const newMsgs = messages.filter(m => !msgOrderRef.current.has(m.id));
        if (newMsgs.length > 0) {
            newMsgs.sort((a, b) => a.timestamp - b.timestamp);
            for (const m of newMsgs) {
                msgOrderRef.current.set(m.id, orderCounterRef.current++);
            }
        }

        const all: Array<{ entry: ChatEntry; order: number }> = [
            ...messages.map(m => ({
                entry: { kind: 'chat' as const, msg: m },
                order: msgOrderRef.current.get(m.id) ?? 0,
            })),
            ...systemEntries.map(e => ({
                entry: e,
                order: (e as ChatEntry & { order?: number }).order ?? 0,
            })),
        ];
        setChatEntries(all.sort((a, b) => a.order - b.order).map(x => x.entry));
    }, [messages, systemEntries]);

    // Initialize new remote participants with default volume
    useEffect(() => {
        participants.forEach(p => {
            if (!(p instanceof RemoteParticipant)) return;
            if (!volumes.has(p.identity)) {
                p.setVolume(DEFAULT_VOLUME / 100);
                onVolumeChange(p.identity, DEFAULT_VOLUME);
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [participants]);

    // Sync mic volumes to LiveKit when they change
    useEffect(() => {
        participants.forEach(p => {
            if (!(p instanceof RemoteParticipant)) return;
            const vol = volumes.get(p.identity);
            if (vol !== undefined) p.setVolume(vol / 100);
        });
    }, [volumes, participants]);

    // Sync screen audio volumes to LiveKit when they change
    useEffect(() => {
        participants.forEach(p => {
            if (!(p instanceof RemoteParticipant)) return;
            const vol = screenVolumes.get(p.identity);
            if (vol !== undefined) {
                const pub = p.getTrackPublication(Track.Source.ScreenShareAudio);
                const track = pub?.audioTrack as RemoteAudioTrack | undefined;
                if (track) track.setVolume(vol / 100);
            }
        });
    }, [screenVolumes, participants]);

    const ttsOpts = () => ({
        volume: settingsRef.current.ttsVolume,
        voice: settingsRef.current.ttsVoice,
        maxLength: settingsRef.current.ttsMaxLength,
    });

    // Self-join sound + initial system message
    useEffect(() => {
        playJoinSound();
        setSystemEntries([{
            kind: 'system',
            id: 'self-join',
            timestamp: Date.now(),
            order: orderCounterRef.current++,
            text: t('system.youJoined'),
        }]);
    }, []);

    // Participant join/leave system messages + TTS
    // Using settingsRef avoids stale closure (this effect runs once on mount)
    useEffect(() => {
        const onJoin = (p: Participant) => {
            const displayName = p.name || p.identity;
            if (settingsRef.current.chatTTS) speak(t('system.joined', { name: displayName }), ttsOpts());
            addSystem(t('system.joined', { name: displayName }), `join-${p.identity}-${Date.now()}`);
        };
        const onLeave = (p: Participant) => {
            // Suppressed when this disconnect is caused by a kick/ban (already announced)
            if (suppressLeaveRef.current.has(p.identity)) return;
            const displayName = p.name || p.identity;
            if (settingsRef.current.chatTTS) speak(t('system.left', { name: displayName }), ttsOpts());
            addSystem(t('system.left', { name: displayName }), `leave-${p.identity}-${Date.now()}`);
        };
        room.on(RoomEvent.ParticipantConnected, onJoin);
        room.on(RoomEvent.ParticipantDisconnected, onLeave);
        return () => {
            room.off(RoomEvent.ParticipantConnected, onJoin);
            room.off(RoomEvent.ParticipantDisconnected, onLeave);
        };
    }, [room]);

    // Screen share start/stop system messages + TTS
    useEffect(() => {
        const onScreenStart = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
            if (pub.source !== Track.Source.ScreenShare) return;
            const name = p.name || p.identity;
            const text = t('system.screenShareStarted', { name });
            addSystem(text, `screenshare-start-${p.identity}-${Date.now()}`);
            if (settingsRef.current.chatTTS) speak(text, ttsOpts());
        };
        const onScreenStop = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
            if (pub.source !== Track.Source.ScreenShare) return;
            const name = p.name || p.identity;
            const text = t('system.screenShareStopped', { name });
            addSystem(text, `screenshare-stop-${p.identity}-${Date.now()}`);
            if (settingsRef.current.chatTTS) speak(text, ttsOpts());
        };
        room.on(RoomEvent.TrackPublished, onScreenStart);
        room.on(RoomEvent.TrackUnpublished, onScreenStop);
        return () => {
            room.off(RoomEvent.TrackPublished, onScreenStart);
            room.off(RoomEvent.TrackUnpublished, onScreenStop);
        };
    }, [room]);


    // Track unread messages, play sounds, TTS
    useEffect(() => {
        const newMsgs = messages.slice(prevMsgCountRef.current);
        const s = settingsRef.current;
        const incoming = newMsgs.filter((m) => m.from?.identity !== localParticipant.identity);
        const allNew = s.ttsReadOwn ? newMsgs : incoming;

        if (incoming.length > 0) {
            if (!chatOpen) setUnreadCount((c) => c + incoming.length);
            if (s.soundChat ?? true) playChatSound();
        }
        if (s.chatTTS && allNew.length > 0) {
            for (const m of allNew) {
                const sender = m.from?.name || m.from?.identity || t('system.someone');
                speak(`${sender}: ${m.message}`, ttsOpts());
            }
        }
        prevMsgCountRef.current = messages.length;
    }, [messages, localParticipant.identity, chatOpen]);

    // Sync unread count to Electron badge
    useEffect(() => {
        window.electronAPI?.setBadgeCount?.(unreadCount);
    }, [unreadCount]);

    const handleOpenChat = useCallback(() => {
        setChatOpen((v) => {
            if (!v) setUnreadCount(0);
            return !v;
        });
    }, []);

    const handleFullscreen = useCallback(() => {
        if (!document.fullscreenEnabled) return;
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen();
        }
    }, []);

    const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

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
        } else if (settingsRef.current.screenShareSkipDialog && (!isElectron || isWayland)) {
            console.log('[Lala] Screen share: skip dialog');
            startScreen(getScreenShareQuality(settingsRef.current.screenShareFpsIdx, settingsRef.current.screenShareBrIdx));
        } else {
            console.log('[Lala] Screen share: opening modal (isElectron:', isElectron, ', isWayland:', isWayland, ')');
            setScreenShareModalOpen(true);
        }
    }, [screenEnabled, startScreen, stopScreen, isElectron, isWayland]);

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

    const handleSpeakers = useCallback(
        (speakers: Participant[]) => {
            onSpeakersChange(speakers.map((s) => s.identity));
        },
        [onSpeakersChange],
    );

    useEffect(() => {
        room.on(RoomEvent.ActiveSpeakersChanged, handleSpeakers);
        return () => { room.off(RoomEvent.ActiveSpeakersChanged, handleSpeakers); };
    }, [room, handleSpeakers]);

    const screenTracks = useTracks(SCREEN_SHARE_TRACKS);
    const isScreenSharing = screenTracks.some(
        (t) => isTrackReference(t) && t.publication.isSubscribed && !t.publication.isMuted,
    );

    const volumeProps = useMemo(() => ({ volumes, onVolumeChange, screenVolumes, onScreenVolumeChange: handleScreenVolumeChange }), [volumes, onVolumeChange, screenVolumes, handleScreenVolumeChange]);

    // Debounce reconnecting banner — don't flash for sub-second hiccups
    const [showReconnecting, setShowReconnecting] = useState(false);
    useEffect(() => {
        if (connectionState === ConnectionState.Reconnecting) {
            const id = setTimeout(() => setShowReconnecting(true), 1500);
            return () => clearTimeout(id);
        }
        setShowReconnecting(false);
    }, [connectionState]);

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
                {isScreenSharing || focusedIdentity
                    ? <FocusLayout
                        initialIdentity={focusedIdentity}
                        onExit={focusedIdentity && !isScreenSharing ? () => setFocusedIdentity(null) : undefined}
                        audioMuted={audioMuted}
                        avatarCache={avatarCache}
                        ambientMode={settings.ambientMode}
                        admin={adminProps}
                        onOpenSettings={onOpenSettings}
                        {...volumeProps}
                    />
                    : <VideoGrid onFocusTile={setFocusedIdentity} onCamEnabled={setFocusedIdentity} audioMuted={audioMuted} avatarCache={avatarCache} admin={adminProps} onOpenSettings={onOpenSettings} {...volumeProps} />
                }
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
