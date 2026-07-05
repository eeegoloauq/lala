import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useTracks, useParticipants, useLocalParticipant, VideoTrack, isTrackReference } from '@livekit/components-react';
import type { TrackReferenceOrPlaceholder, TrackReference } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { ParticipantTile } from '../VideoGrid/ParticipantTile';
import { ParticipantContextMenu } from '../VideoGrid/ParticipantContextMenu';
import { useParticipantContextMenu } from '../hooks/useParticipantContextMenu';
import { useCameraFlip } from '../hooks/useCameraFlip';
import { findTileIdentity } from '../lib/findTileIdentity';
import { useRoomUIContext } from '../RoomUIContext';
import './focus-layout.css';
import { IS_TOUCH as isTouchDevice } from '../../../lib/env';

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
}

export function FocusLayout({ initialIdentity, onExit }: FocusLayoutProps) {
    const { t } = useTranslation();
    const { audioMuted, avatarCache, settings } = useRoomUIContext();
    const ambientMode = settings.ambientMode;
    const participants = useParticipants();
    const screenTracks = useTracks([Track.Source.ScreenShare]);
    const cameraTracks = useTracks([Track.Source.Camera]);
    const screenAudioTracks = useTracks([Track.Source.ScreenShareAudio]);
    const { localParticipant } = useLocalParticipant();
    const [selectedIdentity, setSelectedIdentity] = useState<string | null>(initialIdentity ?? null);
    // When the focused participant has BOTH an active screen share and camera, this
    // flips which one is shown big (screen, by default) vs. as the PiP overlay.
    const [preferCameraId, setPreferCameraId] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const { contextMenuProps, openContextMenu: openContextMenuForIdentity, closeContextMenu } = useParticipantContextMenu({
        participants,
        screenAudioTracks,
    });
    const mainRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const handleFlip = useCameraFlip(localParticipant);

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

    const participantsRef = useRef(participants);
    useEffect(() => { participantsRef.current = participants; });

    // Manual pin: set when the user explicitly clicks a strip tile. Blocks auto-focus
    // from stealing the view until the pinned participant leaves, or (if they were
    // pinned while sharing) their share ends.
    const manualPinRef = useRef<{ identity: string; wasSharing: boolean } | null>(null);
    // Tracks screen-share identities seen on the previous run, so we can tell which
    // ones are brand new (for "newest share auto-focuses" below).
    const prevScreenKeysRef = useRef<Set<string>>(new Set());
    const mountedRef = useRef(false);

    const participantIds = participants.map((p) => p.identity).join(',');
    const screenKeys = [...screenMap.keys()].join(',');
    useEffect(() => {
        const fresh = participantsRef.current;
        const currentScreenIds = [...screenMap.keys()];
        const currentScreenSet = new Set(currentScreenIds);
        const prevScreenSet = prevScreenKeysRef.current;
        const isFirstRun = !mountedRef.current;
        mountedRef.current = true;
        // On mount, don't treat pre-existing shares as "newly appeared" — that would
        // override an explicit initialIdentity (e.g. focusing a specific camera tile).
        const newlyAppeared = isFirstRun ? [] : currentScreenIds.filter((id) => !prevScreenSet.has(id));
        prevScreenKeysRef.current = currentScreenSet;

        setSelectedIdentity((current) => {
            // Respect an active manual pin, unless the pinned participant left, or
            // their pinned share just ended.
            const pin = manualPinRef.current;
            if (pin) {
                const stillPresent = fresh.some((p) => p.identity === pin.identity);
                const pinnedShareEnded = pin.wasSharing && !currentScreenSet.has(pin.identity);
                if (stillPresent && !pinnedShareEnded) {
                    return current;
                }
                manualPinRef.current = null;
            }

            if (!isFirstRun) {
                // A brand-new REMOTE share always steals focus (newest wins if several
                // appear at once). Your own new share only steals focus if nothing else
                // is currently shared — you can already see your own screen.
                const ownIdentity = localParticipant.identity;
                const newRemoteShares = newlyAppeared.filter((id) => id !== ownIdentity);
                const remoteShareExists = currentScreenIds.some((id) => id !== ownIdentity);
                if (newRemoteShares.length > 0) {
                    return newRemoteShares[newRemoteShares.length - 1];
                }
                if (newlyAppeared.includes(ownIdentity) && !remoteShareExists) {
                    return ownIdentity;
                }
            }

            if (current && fresh.some((p) => p.identity === current)) {
                return current;
            }
            return currentScreenIds[0] ?? initialIdentity ?? fresh[0]?.identity ?? null;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [participantIds, screenKeys]);

    // Reset the camera/screen swap preference whenever the focused participant changes —
    // it's meaningless carried over to someone else.
    useEffect(() => {
        setPreferCameraId(null);
    }, [selectedIdentity]);

    // ...and when the preferred participant's share or camera ends.
    const activeCameraKeys = [...cameraMap.entries()].filter(([, t]) => !!asActiveTrack(t)).map(([id]) => id).join(',');
    useEffect(() => {
        setPreferCameraId((current) => {
            if (!current) return current;
            const stillScreen = screenMap.has(current);
            const stillCam = !!asActiveTrack(cameraMap.get(current));
            return stillScreen && stillCam ? current : null;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screenKeys, activeCameraKeys]);

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

    const stripRef = useRef<HTMLDivElement>(null);

    const handleStripContextMenu = (e: React.MouseEvent, identity: string) => {
        e.preventDefault();
        openContextMenuForIdentity(identity, e.clientX, e.clientY);
    };

    // Touch devices: tap opens context menu via event delegation
    const handleStripTap = useCallback((e: React.MouseEvent) => {
        if (!isTouchDevice) return;
        const identity = findTileIdentity(e.target, stripRef.current);
        if (identity) openContextMenuForIdentity(identity, e.clientX, e.clientY);
    }, [openContextMenuForIdentity]);

    // Resolve main track: prefer screen share for selected, fallback to camera.
    // When both are active, `preferCameraId` (set by clicking the PiP) swaps them.
    const resolveMainTrack = (): { track: TrackReference; type: 'screen' | 'camera' } | null => {
        const identity = selectedIdentity;
        if (identity) {
            const screen = screenMap.get(identity);
            const cam = asActiveTrack(cameraMap.get(identity));
            if (screen && cam) {
                return preferCameraId === identity ? { track: cam, type: 'camera' } : { track: screen, type: 'screen' };
            }
            if (screen) return { track: screen, type: 'screen' };
            if (cam) return { track: cam, type: 'camera' };
        }
        const firstScreen = [...screenMap.values()][0];
        if (firstScreen) return { track: firstScreen, type: 'screen' };
        return null;
    };

    const focused = resolveMainTrack();

    // Picture-in-picture: whichever of screen/camera ISN'T the main view, for the same
    // participant — only relevant when they have both active at once.
    const pip: { track: TrackReference; type: 'screen' | 'camera'; identity: string } | null = (() => {
        if (!focused) return null;
        const identity = focused.track.participant.identity;
        if (focused.type === 'screen') {
            const cam = asActiveTrack(cameraMap.get(identity));
            return cam ? { track: cam, type: 'camera', identity } : null;
        }
        const screen = screenMap.get(identity);
        return screen ? { track: screen, type: 'screen', identity } : null;
    })();

    // Clicking the PiP swaps it with the main view (and back again on a second click).
    const handlePipClick = () => {
        if (!focused) return;
        const identity = focused.track.participant.identity;
        setPreferCameraId((current) => (current === identity ? null : identity));
    };

    // Touch devices: tap on main view opens context menu
    const handleMainTap = useCallback((e: React.MouseEvent) => {
        if (!isTouchDevice || !focused) return;
        openContextMenuForIdentity(focused.track.participant.identity, e.clientX, e.clientY);
    }, [focused, openContextMenuForIdentity]);

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
                onClick={isTouchDevice ? handleMainTap : undefined}
                onContextMenu={(e) => {
                    if (!focused) return;
                    e.preventDefault();
                    openContextMenuForIdentity(focused.track.participant.identity, e.clientX, e.clientY);
                }}
            >
                {focused && (
                    <>
                        <canvas ref={canvasRef} width={64} height={36} className={`fl-ambient-canvas${ambientMode ? '' : ' fl-ambient-hidden'}`} />
                        <VideoTrack trackRef={focused.track} />
                        {pip && (
                            <div
                                className="fl-pip"
                                role="button"
                                tabIndex={0}
                                title={pip.type === 'camera' ? t('focus.showCameraLarge') : t('focus.showScreenLarge')}
                                aria-label={pip.type === 'camera' ? t('focus.showCameraLarge') : t('focus.showScreenLarge')}
                                onClick={(e) => { e.stopPropagation(); handlePipClick(); }}
                                onDoubleClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                    if (e.key !== 'Enter' && e.key !== ' ') return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handlePipClick();
                                }}
                            >
                                <VideoTrack trackRef={pip.track} />
                            </div>
                        )}
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
            <div
                className="fl-strip"
                ref={stripRef}
                onClick={isTouchDevice ? handleStripTap : undefined}
            >
                {participants.map((p) => {
                    const isSelected = p.identity === selectedIdentity;
                    const hasScreenShare = screenMap.has(p.identity);
                    const hasCamera = !!asActiveTrack(cameraMap.get(p.identity));
                    const hasContent = hasScreenShare || hasCamera;
                    // Their camera is already visible inside .fl-main (as the main view or
                    // the PiP overlay) — showing it again here would just be duplication.
                    const cameraShownInMain = pip?.identity === p.identity;
                    return (
                        <div
                            key={p.identity}
                            className={`fl-strip-tile${isSelected ? ' fl-strip-active' : ''}${hasContent ? ' fl-strip-clickable' : ''}`}
                            onClick={() => {
                                if (!hasContent) return;
                                manualPinRef.current = { identity: p.identity, wasSharing: hasScreenShare };
                                setSelectedIdentity(p.identity);
                            }}
                            onContextMenu={(e) => handleStripContextMenu(e, p.identity)}
                            title={hasContent ? t('focus.focusOn', { name: p.name || p.identity }) : undefined}
                        >
                            <ParticipantTile
                                participant={p}
                                trackRef={cameraShownInMain ? undefined : cameraMap.get(p.identity)}
                                audioMuted={p.identity === localParticipant.identity ? audioMuted : undefined}
                                avatarUrl={avatarCache?.get(p.identity)}
                            />
                        </div>
                    );
                })}
            </div>

            {contextMenuProps && (
                <ParticipantContextMenu {...contextMenuProps} onClose={closeContextMenu} />
            )}
        </div>
    );
}
