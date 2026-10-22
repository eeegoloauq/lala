import { useCallback, useEffect } from 'react';
import { useDisconnectButton, useLocalParticipant, useLocalParticipantPermissions, useParticipantAttributes } from '@livekit/components-react';
import { useTranslation } from 'react-i18next';
import {
    MicIcon, MicOffIcon,
    VideoIcon, VideoOffIcon,
    ScreenShareIcon, ScreenShareOffIcon,
    ChatIcon,
    SpeakerIcon, SpeakerOffIcon,
    PhoneOffIcon,
} from '../icons/Icons';
import './control-bar.css';
import { IS_ELECTRON as isElectron } from '../../../lib/env';
import { CAMERA, MICROPHONE, SCREEN_SHARE, canPublishSource } from '../lib/permissions';

const canScreenShare = typeof navigator.mediaDevices?.getDisplayMedia === 'function';

type Toggle = { enabled: boolean; pending: boolean };

interface ControlBarProps {
    mic: Toggle & { toggle: () => void };
    cam: Toggle & { toggle: () => void };
    screen: Toggle;
    audioMuted: boolean;
    onToggleAudio: () => void;
    chatOpen: boolean;
    onToggleChat: () => void;
    unreadCount?: number;
    onScreenShareClick?: () => void;
}

export function ControlBar({ mic, cam, screen, audioMuted, onToggleAudio, chatOpen, onToggleChat, unreadCount = 0, onScreenShareClick }: ControlBarProps) {
    const { t } = useTranslation();
    const { buttonProps: leaveProps } = useDisconnectButton({});
    // What the server lets us publish here; a button for something we may not do stays off.
    const permissions = useLocalParticipantPermissions();
    const mayPublish = (source: number) => canPublishSource(permissions, source);
    const mayTalk = mayPublish(MICROPHONE);

    // Without the right to speak, the mic button becomes a raised hand; it goes down by
    // itself once a moderator gives the floor.
    const { localParticipant } = useLocalParticipant();
    const handRaised = useParticipantAttributes({ participant: localParticipant }).attributes?.['lala.hand'] === '1';
    const setHand = useCallback((raised: boolean) => {
        localParticipant.setAttributes({ 'lala.hand': raised ? '1' : '' })
            .catch(err => console.warn('[ControlBar] Raising the hand failed:', err));
    }, [localParticipant]);
    useEffect(() => {
        if (mayTalk && handRaised) setHand(false);
    }, [mayTalk, handRaised, setHand]);

    return (
        <div className="cb-wrap">
            <div className="cb-pill">
                {mayTalk ? (
                    <button
                        className={`cb-btn cb-anim-pulse${!mic.enabled ? ' cb-off' : ''}`}
                        onClick={() => mic.toggle()}
                        disabled={mic.pending}
                        title={mic.enabled ? t('controls.mute') : t('controls.unmute')}
                    >
                        {mic.enabled ? <MicIcon /> : <MicOffIcon />}
                    </button>
                ) : (
                    <button
                        className={`cb-btn cb-anim-pulse${handRaised ? ' cb-active' : ''}`}
                        onClick={() => setHand(!handRaised)}
                        title={handRaised ? t('ctx.lowerHand') : t('ctx.raiseHand')}
                    >
                        <span aria-hidden="true">✋</span>
                    </button>
                )}

                <button
                    className={`cb-btn cb-anim-pulse${audioMuted ? ' cb-off' : ''}`}
                    onClick={onToggleAudio}
                    title={audioMuted ? t('controls.undeafen') : t('controls.deafen')}
                >
                    {audioMuted ? <SpeakerOffIcon /> : <SpeakerIcon />}
                </button>

                <div className="cb-divider" />

                {(canScreenShare || isElectron) && (
                    <button
                        className={`cb-btn cb-anim-rise${screen.enabled ? ' cb-active' : ''}`}
                        onClick={onScreenShareClick}
                        disabled={screen.pending || !mayPublish(SCREEN_SHARE)}
                        title={!mayPublish(SCREEN_SHARE) ? t('controls.notAllowed') : screen.enabled ? t('controls.screenShareStop') : t('controls.screenShareStart')}
                    >
                        {screen.enabled ? <ScreenShareOffIcon /> : <ScreenShareIcon />}
                    </button>
                )}

                <button
                    className={`cb-btn cb-anim-pulse${cam.enabled ? '' : ' cb-off-soft'}`}
                    onClick={() => cam.toggle()}
                    disabled={cam.pending || !mayPublish(CAMERA)}
                    title={!mayPublish(CAMERA) ? t('controls.notAllowed') : cam.enabled ? t('controls.cameraOff') : t('controls.cameraOn')}
                >
                    {cam.enabled ? <VideoIcon /> : <VideoOffIcon />}
                </button>

                <div className="cb-divider" />

                <button
                    className={`cb-btn cb-anim-bounce${chatOpen ? ' cb-active' : ''}`}
                    onClick={onToggleChat}
                    title={t('controls.chat')}
                    aria-label={t('controls.chat')}
                >
                    <ChatIcon />
                    {unreadCount > 0 && (
                        <span className="cb-badge" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>
                    )}
                </button>

                <div className="cb-divider" />

                <button
                    className="cb-btn cb-leave cb-anim-shake"
                    onClick={leaveProps.onClick}
                    title={t('controls.leave')}
                >
                    <PhoneOffIcon />
                </button>
            </div>
        </div>
    );
}
