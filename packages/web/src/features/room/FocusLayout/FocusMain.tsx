import { useEffect, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { VideoTrack, useLocalParticipant } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import { useCameraFlip } from '../hooks/useCameraFlip';
import { FlipCameraIcon, ScreenShareStatusIcon, VideoIcon } from '../icons/Icons';
import { IS_TOUCH as isTouchDevice } from '../../../lib/env';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { useLongPress } from '../../../hooks/useLongPress';
import { AmbientCanvas } from './AmbientCanvas';
import type { FocusView } from './useFocus';

/** WebKit's own fullscreen player, not in the DOM typings: iPhone Safari has no element fullscreen. */
type WebKitVideoElement = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

const elementFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;
/** iPhone: only a video can go fullscreen, in the system player; its Done button exits. */
const videoFullscreen = !elementFullscreen && typeof HTMLVideoElement !== 'undefined'
    && 'webkitEnterFullscreen' in HTMLVideoElement.prototype;
const fullscreenSupported = elementFullscreen || videoFullscreen;

interface FocusMainProps {
    focused: FocusView | null;
    pip: FocusView | null;
    ambient: boolean;
    onSwap: () => void;
    onExit?: () => void;
    /** Opens the participant menu at a point on the page. */
    onMenu: (participant: Participant, x: number, y: number) => void;
    onStopShare: () => void;
}

/** The large view of the focus layout: a screen share or camera, with the other one as a PiP. */
export function FocusMain({ focused, pip, ambient, onSwap, onExit, onMenu, onStopShare }: FocusMainProps) {
    const { localParticipant } = useLocalParticipant();
    const handleFlip = useCameraFlip(localParticipant);
    const participant = focused?.track.participant;
    return (
        <FocusMainView
            focused={focused && participant ? {
                type: focused.type,
                name: participant.name || participant.identity,
                video: (ref) => <VideoTrack ref={ref} trackRef={focused.track} />,
            } : null}
            pip={pip && { type: pip.type, video: <VideoTrack trackRef={pip.track} /> }}
            ambient={ambient}
            onStopShare={focused?.type === 'screen' && participant?.identity === localParticipant.identity ? onStopShare : undefined}
            onSwap={onSwap}
            onExit={onExit}
            onMenu={participant && ((x, y) => onMenu(participant, x, y))}
            onFlip={isTouchDevice && focused?.type === 'camera' && participant?.identity === localParticipant.identity ? handleFlip : undefined}
        />
    );
}

interface FocusMainViewProps {
    /** `video` renders the main video into the given ref, which the ambient glow reads. */
    focused: { type: FocusView['type']; name: string; video: (ref: Ref<HTMLVideoElement>) => ReactNode } | null;
    pip: { type: FocusView['type']; video: ReactNode } | null;
    ambient: boolean;
    /** Set when the main view is your own screen share. */
    onStopShare?: () => void;
    onSwap: () => void;
    onExit?: () => void;
    onMenu?: (x: number, y: number) => void;
    onFlip?: () => void;
}

/** Phones and tablets share their whole screen, so showing it back is only a mirror of the mirror. */
export const OWN_SHARE_PLACEHOLDER_QUERY = '(pointer: coarse)';

/** A phone on its side: a screen share fills the screen, over the page (`.fl-main-fill`). */
export const SHARE_FILL_QUERY = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)';

/** How long the controls stay over a filling share after the last touch. */
const CHROME_MS = 3500;

/** The large view from plain content; FocusMain fills it from LiveKit tracks. */
export function FocusMainView({ focused, pip, ambient, onStopShare, onSwap, onExit, onMenu, onFlip }: FocusMainViewProps) {
    const { t } = useTranslation();
    const placeholder = useMediaQuery(OWN_SHARE_PLACEHOLDER_QUERY) && !!onStopShare;
    const fill = useMediaQuery(SHARE_FILL_QUERY) && focused?.type === 'screen' && !placeholder;
    // Over a filling share, the call's controls show after a tap and hide again by themselves.
    const [chrome, setChrome] = useState(false);
    useEffect(() => {
        if (!fill || !chrome) return;
        let timer = setTimeout(() => setChrome(false), CHROME_MS);
        const keep = () => {
            clearTimeout(timer);
            timer = setTimeout(() => setChrome(false), CHROME_MS);
        };
        document.addEventListener('pointerdown', keep, true);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('pointerdown', keep, true);
        };
    }, [fill, chrome]);
    const longPress = useLongPress();
    const mainRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    const toggleFullscreen = () => {
        if (videoFullscreen) {
            (videoRef.current as WebKitVideoElement | null)?.webkitEnterFullscreen?.();
        } else if (!document.fullscreenElement && mainRef.current) {
            mainRef.current.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    };

    const pipLabel = pip?.type === 'camera' ? t('focus.showCameraLarge') : t('focus.showScreenLarge');

    return (
        <div
            className={`fl-main${focused?.type === 'camera' ? ' fl-main-camera' : ''}${fill ? ' fl-main-fill' : ''}${fill && chrome ? ' fl-chrome' : ''}`}
            ref={mainRef}
            // A filling share takes a tap for its controls, so a long press opens the menu (iOS fires no contextmenu).
            {...(fill && onMenu ? longPress(onMenu) : {})}
            onDoubleClick={fullscreenSupported && !placeholder ? toggleFullscreen : undefined}
            // A tap has no right button, so on touch screens it opens the menu.
            onClick={!isTouchDevice ? undefined : fill ? () => setChrome(c => !c) : onMenu && ((e) => onMenu(e.clientX, e.clientY))}
            onContextMenu={onMenu && ((e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); })}
        >
            {focused && (
                <>
                    {placeholder ? (
                        <div className="fl-own-share">
                            <ScreenShareStatusIcon size={28} strokeWidth={1.75} />
                            <span>{t('focus.youAreSharing')}</span>
                            <button className="btn" onClick={(e) => { e.stopPropagation(); onStopShare?.(); }}>
                                {t('controls.screenShareStop')}
                            </button>
                        </div>
                    ) : (
                        <>
                            {ambient && <AmbientCanvas videoRef={videoRef} />}
                            {focused.video(videoRef)}
                        </>
                    )}
                    {pip && (
                        <div
                            className="fl-pip"
                            role="button"
                            tabIndex={0}
                            title={pipLabel}
                            aria-label={pipLabel}
                            onClick={(e) => { e.stopPropagation(); onSwap(); }}
                            onDoubleClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                                if (e.key !== 'Enter' && e.key !== ' ') return;
                                e.preventDefault();
                                e.stopPropagation();
                                onSwap();
                            }}
                        >
                            {pip.video}
                        </div>
                    )}
                    {/* Its buttons must not also open the menu or toggle fullscreen on the view behind. */}
                    <div className="fl-main-bar" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                        {onExit && (
                            <button className="fl-back-btn" onClick={onExit} title={t('focus.backToGrid')}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="15 18 9 12 15 6" />
                                </svg>
                            </button>
                        )}
                        <span className="fl-main-label">
                            {focused.type === 'screen'
                                ? <ScreenShareStatusIcon size={12} strokeWidth={2} style={{ flexShrink: 0 }} />
                                : <VideoIcon size={12} strokeWidth={2} style={{ flexShrink: 0 }} />}
                            {focused.name}
                        </span>
                        {onFlip && (
                            <button className="fl-fullscreen-btn" onClick={onFlip} title={t('focus.flipCamera')}>
                                <FlipCameraIcon size={16} strokeWidth={2} />
                            </button>
                        )}
                        {fullscreenSupported && !placeholder && (
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
    );
}
