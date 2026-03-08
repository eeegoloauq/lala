import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useTracks, useParticipants, useLocalParticipant, VideoTrack, isTrackReference } from '@livekit/components-react';
import type { TrackReferenceOrPlaceholder, TrackReference } from '@livekit/components-react';
import { Track, RemoteParticipant } from 'livekit-client';
import type { LocalVideoTrack, RemoteTrackPublication } from 'livekit-client';
import { ParticipantTile } from '../VideoGrid/ParticipantTile';
import { ParticipantContextMenu } from '../VideoGrid/ParticipantContextMenu';
import type { AdminActions } from '../VideoGrid/ParticipantContextMenu';
import './focus-layout.css';

const isTouchDevice = typeof window !== 'undefined' && navigator.maxTouchPoints > 0;
const fullscreenSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled;

function asActiveTrack(ref: TrackReferenceOrPlaceholder | undefined): TrackReference | null {
    if (ref && isTrackReference(ref) && ref.publication.isSubscribed && !ref.publication.isMuted) {
        return ref;
    }
    return null;
}

interface FocusLayoutProps {
    initialIdentity?: string | null;
    onExit?: () => void;
    audioMuted?: boolean;
    avatarCache?: Map<string, string>;
    volumes: Map<string, number>;
    onVolumeChange: (identity: string, vol: number) => void;
    screenVolumes: Map<string, number>;
    onScreenVolumeChange: (identity: string, vol: number) => void;
    ambientMode?: boolean;
    admin?: Omit<AdminActions, 'serverMuted' | 'onKick' | 'onBan' | 'onToggleMute'> & {
        onKick: (identity: string) => void;
        onBan: (identity: string) => void;
        onToggleMute: (identity: string, serverMuted: boolean) => void;
    };
    onOpenSettings?: () => void;
}

interface ContextMenuState {
    identity: string;
    name: string;
    isRemote: boolean;
    hasScreenAudio: boolean;
    hasScreenSharePub: boolean;
    screenShareHidden: boolean;
    serverMuted: boolean;
    x: number;
    y: number;
}

export function FocusLayout({ initialIdentity, onExit, audioMuted, avatarCache, volumes, onVolumeChange, screenVolumes, onScreenVolumeChange, ambientMode = true, admin, onOpenSettings }: FocusLayoutProps) {
    const { t } = useTranslation();
    const participants = useParticipants();
    const screenTracks = useTracks([Track.Source.ScreenShare]);
    const cameraTracks = useTracks([Track.Source.Camera]);
    const screenAudioTracks = useTracks([Track.Source.ScreenShareAudio]);
    const { localParticipant } = useLocalParticipant();
    const [selectedIdentity, setSelectedIdentity] = useState<string | null>(initialIdentity ?? null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const mainRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const handleFlip = useCallback(async () => {
        const next: 'user' | 'environment' = facingMode === 'user' ? 'environment' : 'user';
        setFacingMode(next);
        const pub = localParticipant.getTrackPublication(Track.Source.Camera);
        const track = pub?.track as LocalVideoTrack | undefined;
        if (track) await track.restartTrack({ facingMode: next });
    }, [facingMode, localParticipant]);

    // Build maps
    const screenMap = new Map<string, TrackReference>();
    for (const t of screenTracks) {
        const active = asActiveTrack(t);
        if (active) screenMap.set(active.participant.identity, active);
    }

    const cameraMap = new Map<string, TrackReferenceOrPlaceholder>();
    for (const t of cameraTracks) {
        cameraMap.set(t.participant.identity, t);
    }

    const screenAudioSet = new Set<string>();
    for (const t of screenAudioTracks) {
        if (isTrackReference(t) && t.publication.isSubscribed && !t.publication.isMuted) {
            screenAudioSet.add(t.participant.identity);
        }
    }

    const participantsRef = useRef(participants);
    useEffect(() => { participantsRef.current = participants; });

    const participantIds = participants.map((p) => p.identity).join(',');
    const screenKeys = [...screenMap.keys()].join(',');
    useEffect(() => {
        const firstScreen = [...screenMap.keys()][0];
        setSelectedIdentity((current) => {
            const fresh = participantsRef.current;
            if (current && fresh.some((p) => p.identity === current)) {
                return current;
            }
            return firstScreen ?? initialIdentity ?? fresh[0]?.identity ?? null;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [participantIds, screenKeys]);

    // Fullscreen
    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    const toggleFullscreen = () => {
        if (!document.fullscreenElement && mainRef.current) {
            mainRef.current.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    };

    // Ambient mode: draw video frames to canvas at ~10fps
    useEffect(() => {
        if (!ambientMode) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let raf: number;
        let lastDraw = 0;
        const INTERVAL = 1000 / 10;

        const draw = (now: number) => {
            raf = requestAnimationFrame(draw);
            if (now - lastDraw < INTERVAL) return;
            lastDraw = now;
            const video = mainRef.current?.querySelector('video');
            if (!video || (video as HTMLVideoElement).readyState < 2) return;
            // Blend new frame at low alpha over previous — creates natural trailing/lag effect
            try {
                ctx.globalAlpha = 0.35;
                ctx.drawImage(video as HTMLVideoElement, 0, 0, canvas.width, canvas.height);
                ctx.globalAlpha = 1;
            } catch { /* noop */ }
        };
        raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(raf);
    }, [ambientMode, selectedIdentity]);

    const getScreenSharePubInfo = (identity: string, p?: typeof participants[0]) => {
        const participant = p ?? participants.find(p => p.identity === identity);
        const screenPub = participant instanceof RemoteParticipant
            ? participant.getTrackPublication(Track.Source.ScreenShare) as RemoteTrackPublication | undefined
            : undefined;
        return { hasScreenSharePub: !!screenPub, screenShareHidden: !!screenPub && !screenPub.isSubscribed };
    };

    const handleStripContextMenu = (e: React.MouseEvent, identity: string) => {
        e.preventDefault();
        const p = participants.find(p => p.identity === identity);
        setContextMenu({
            identity,
            name: p?.name || identity,
            isRemote: identity !== localParticipant.identity,
            hasScreenAudio: screenAudioSet.has(identity),
            ...getScreenSharePubInfo(identity, p),
            serverMuted: p?.permissions?.canPublish === false,
            x: e.clientX,
            y: e.clientY,
        });
    };

    // Resolve main track: prefer screen share for selected, fallback to camera
    const resolveMainTrack = (): { track: TrackReference; type: 'screen' | 'camera' } | null => {
        const identity = selectedIdentity;
        if (identity) {
            const screen = screenMap.get(identity);
            if (screen) return { track: screen, type: 'screen' };

            const cam = asActiveTrack(cameraMap.get(identity));
            if (cam) return { track: cam, type: 'camera' };
        }
        const firstScreen = [...screenMap.values()][0];
        if (firstScreen) return { track: firstScreen, type: 'screen' };
        return null;
    };

    const focused = resolveMainTrack();

    // Auto-exit focus mode when the focused participant has no active tracks
    // (e.g. they turned off camera after being auto-focused)
    useEffect(() => {
        if (focused || !onExit) return;
        const timer = setTimeout(onExit, 400);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focused]);

    return (
        <div className="fl-area">
            {/* Main view: screen share or focused camera */}
            <div
                className={`fl-main${focused?.type === 'camera' ? ' fl-main-camera' : ''}`}
                ref={mainRef}
                onDoubleClick={fullscreenSupported ? toggleFullscreen : undefined}
                onContextMenu={(e) => {
                    if (!focused) return;
                    e.preventDefault();
                    const identity = focused.track.participant.identity;
                    const p = participants.find(p => p.identity === identity);
                    setContextMenu({
                        identity,
                        name: p?.name || identity,
                        isRemote: identity !== localParticipant.identity,
                        hasScreenAudio: screenAudioSet.has(identity),
                        ...getScreenSharePubInfo(identity, p),
                        serverMuted: p?.permissions?.canPublish === false,
                        x: e.clientX,
                        y: e.clientY,
                    });
                }}
            >
                {focused && (
                    <>
                        <canvas ref={canvasRef} width={64} height={36} className={`fl-ambient-canvas${ambientMode ? '' : ' fl-ambient-hidden'}`} />
                        <VideoTrack trackRef={focused.track} />
                        <div className="fl-main-bar">
                            {onExit && (
                                <button className="fl-back-btn" onClick={onExit} title={t('focus.backToGrid')}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="15 18 9 12 15 6" />
                                    </svg>
                                </button>
                            )}
                            <span className="fl-main-label">
                                {focused.type === 'screen' ? (
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                        <rect x="2" y="3" width="20" height="14" rx="2" />
                                        <line x1="8" y1="21" x2="16" y2="21" />
                                        <line x1="12" y1="17" x2="12" y2="21" />
                                    </svg>
                                ) : (
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                        <polygon points="23 7 16 12 23 17 23 7" />
                                        <rect x="1" y="5" width="15" height="14" rx="2" />
                                    </svg>
                                )}
                                {focused.track.participant.name || focused.track.participant.identity}
                            </span>
                            {isTouchDevice && focused.type === 'camera' &&
                                focused.track.participant.identity === localParticipant.identity && (
                                    <button className="fl-fullscreen-btn" onClick={handleFlip} title={t('focus.flipCamera')}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M20 7h-3.5l-1.5-2h-6L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z" />
                                            <circle cx="12" cy="13" r="3.5" />
                                            <path d="M17 4l2 3-2 3" />
                                        </svg>
                                    </button>
                                )}
                            {fullscreenSupported && (
                                <button
                                    className="fl-fullscreen-btn"
                                    onClick={toggleFullscreen}
                                    title={isFullscreen ? t('focus.exitFullscreen') : t('focus.fullscreen')}
                                >
                                    {isFullscreen ? (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                            <polyline points="4 14 10 14 10 20" />
                                            <polyline points="20 10 14 10 14 4" />
                                            <line x1="10" y1="14" x2="3" y2="21" />
                                            <line x1="21" y1="3" x2="14" y2="10" />
                                        </svg>
                                    ) : (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                            <polyline points="15 3 21 3 21 9" />
                                            <polyline points="9 21 3 21 3 15" />
                                            <line x1="21" y1="3" x2="14" y2="10" />
                                            <line x1="3" y1="21" x2="10" y2="14" />
                                        </svg>
                                    )}
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Side strip — all participants, all clickable */}
            <div className="fl-strip">
                {participants.map((p) => {
                    const isSelected = p.identity === selectedIdentity;
                    const hasScreenShare = screenMap.has(p.identity);
                    const hasCamera = !!asActiveTrack(cameraMap.get(p.identity));
                    const hasContent = hasScreenShare || hasCamera;
                    return (
                        <div
                            key={p.identity}
                            className={`fl-strip-tile${isSelected ? ' fl-strip-active' : ''}${hasContent ? ' fl-strip-clickable' : ''}`}
                            onClick={() => hasContent && setSelectedIdentity(p.identity)}
                            onContextMenu={(e) => handleStripContextMenu(e, p.identity)}
                            title={hasContent ? t('focus.focusOn', { name: p.identity }) : undefined}
                        >
                            <ParticipantTile
                                participant={p}
                                trackRef={cameraMap.get(p.identity)}
                                audioMuted={p.identity === localParticipant.identity ? audioMuted : undefined}
                                avatarUrl={avatarCache?.get(p.identity)}
                            />
                        </div>
                    );
                })}
            </div>

            {contextMenu && (
                <ParticipantContextMenu
                    identity={contextMenu.identity}
                    name={contextMenu.name}
                    isRemote={contextMenu.isRemote}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    volume={volumes.get(contextMenu.identity) ?? 50}
                    onVolumeChange={(vol) => onVolumeChange(contextMenu.identity, vol)}
                    screenVolume={contextMenu.hasScreenAudio ? (screenVolumes.get(contextMenu.identity) ?? 100) : undefined}
                    onScreenVolumeChange={contextMenu.hasScreenAudio ? (vol) => onScreenVolumeChange(contextMenu.identity, vol) : undefined}
                    admin={admin && contextMenu.isRemote ? {
                        adminSecret: admin.adminSecret,
                        roomId: admin.roomId,
                        serverMuted: contextMenu.serverMuted,
                        onKick: () => admin.onKick(contextMenu.identity),
                        onBan: () => admin.onBan(contextMenu.identity),
                        onToggleMute: () => admin.onToggleMute(contextMenu.identity, contextMenu.serverMuted),
                    } : undefined}
                    screenShareHidden={contextMenu.screenShareHidden}
                    onToggleScreenShare={contextMenu.hasScreenSharePub ? () => {
                        const p = participants.find(p => p.identity === contextMenu.identity);
                        if (!(p instanceof RemoteParticipant)) return;
                        const pub = p.getTrackPublication(Track.Source.ScreenShare) as RemoteTrackPublication | undefined;
                        const audioPub = p.getTrackPublication(Track.Source.ScreenShareAudio) as RemoteTrackPublication | undefined;
                        const newSub = !pub?.isSubscribed;
                        if (pub) pub.setSubscribed(newSub);
                        if (audioPub) audioPub.setSubscribed(newSub);
                    } : undefined}
                    onOpenSettings={onOpenSettings}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}
