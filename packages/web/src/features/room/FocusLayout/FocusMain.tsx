import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VideoTrack, useLocalParticipant } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import { useCameraFlip } from '../hooks/useCameraFlip';
import { FlipCameraIcon, ScreenShareStatusIcon, VideoIcon } from '../icons/Icons';
import { IS_TOUCH as isTouchDevice } from '../../../lib/env';
import { AmbientCanvas } from './AmbientCanvas';
import type { FocusView } from './useFocus';

const fullscreenSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled;

interface FocusMainProps {
    focused: FocusView | null;
    pip: FocusView | null;
    ambient: boolean;
    onSwap: () => void;
    onExit?: () => void;
    onMenu: (participant: Participant, e: React.MouseEvent) => void;
}

/** The large view of the focus layout: a screen share or camera, with the other one as a PiP. */
export function FocusMain({ focused, pip, ambient, onSwap, onExit, onMenu }: FocusMainProps) {
    const { t } = useTranslation();
    const { localParticipant } = useLocalParticipant();
    const handleFlip = useCameraFlip(localParticipant);
    const mainRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

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

    const participant = focused?.track.participant;
    const openMenu = (e: React.MouseEvent) => {
        if (participant) onMenu(participant, e);
    };
    const pipLabel = pip?.type === 'camera' ? t('focus.showCameraLarge') : t('focus.showScreenLarge');

    return (
        <div
            className={`fl-main${focused?.type === 'camera' ? ' fl-main-camera' : ''}`}
            ref={mainRef}
            onDoubleClick={fullscreenSupported ? toggleFullscreen : undefined}
            // A tap has no right button, so on touch screens it opens the menu.
            onClick={isTouchDevice ? openMenu : undefined}
            onContextMenu={openMenu}
        >
            {focused && participant && (
                <>
                    {ambient && <AmbientCanvas videoRef={videoRef} />}
                    <VideoTrack ref={videoRef} trackRef={focused.track} />
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
                            <VideoTrack trackRef={pip.track} />
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
                            {participant.name || participant.identity}
                        </span>
                        {isTouchDevice && focused.type === 'camera' && participant.identity === localParticipant.identity && (
                            <button className="fl-fullscreen-btn" onClick={handleFlip} title={t('focus.flipCamera')}>
                                <FlipCameraIcon size={16} strokeWidth={2} />
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
    );
}
