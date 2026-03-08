import { useDisconnectButton } from '@livekit/components-react';
import { useTranslation } from 'react-i18next';
import { useLocalControls } from '../hooks/useLocalControls';
import { useScreenShare } from '../hooks/useScreenShare';
import { playMuteSound, playUnmuteSound } from '../../../lib/sounds'; // speaker button only — mic sound handled by useMicSound hook in RoomShell
import type { AppSettings } from '../../settings/types';
import {
    MicIcon, MicOffIcon,
    VideoIcon, VideoOffIcon,
    ScreenShareIcon, ScreenShareOffIcon,
    ChatIcon,
    SpeakerIcon, SpeakerOffIcon,
    PhoneOffIcon,
} from '../icons/Icons';
import './control-bar.css';

const isTouchDevice = () => navigator.maxTouchPoints > 0;
const canScreenShare = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

interface ControlBarProps {
    audioMuted: boolean;
    onToggleAudio: () => void;
    chatOpen: boolean;
    onToggleChat: () => void;
    unreadCount?: number;
    settings: AppSettings;
    onUpdateSettings: (patch: Partial<AppSettings>) => void;
    onScreenShareClick?: () => void;
}

export function ControlBar({ audioMuted, onToggleAudio, chatOpen, onToggleChat, unreadCount = 0, settings, onUpdateSettings, onScreenShareClick }: ControlBarProps) {
    const { t } = useTranslation();
    const { mic, cam } = useLocalControls();
    const { enabled: screenEnabled, pending: screenPending } = useScreenShare();
    const { buttonProps: leaveProps } = useDisconnectButton({});

    return (
        <div className="cb-wrap">
            <div className="cb-pill">
                <button
                    className={`cb-btn cb-anim-pulse${!mic.enabled ? ' cb-off' : ''}`}
                    onClick={() => mic.toggle()}
                    disabled={mic.pending}
                    title={mic.enabled ? t('controls.mute') : t('controls.unmute')}
                >
                    {mic.enabled ? <MicIcon /> : <MicOffIcon />}
                </button>

                <button
                    className={`cb-btn cb-anim-pulse${audioMuted ? ' cb-off' : ''}`}
                    onClick={() => { audioMuted ? playUnmuteSound() : playMuteSound(); onToggleAudio(); }}
                    title={audioMuted ? t('controls.undeafen') : t('controls.deafen')}
                >
                    {audioMuted ? <SpeakerOffIcon /> : <SpeakerIcon />}
                </button>

                <div className="cb-divider" />

                {(canScreenShare || isElectron) && (
                    <button
                        className={`cb-btn cb-anim-rise${screenEnabled ? ' cb-active' : ''}`}
                        onClick={onScreenShareClick}
                        disabled={screenPending}
                        title={screenEnabled ? t('controls.screenShareStop') : t('controls.screenShareStart')}
                    >
                        {screenEnabled ? <ScreenShareOffIcon /> : <ScreenShareIcon />}
                    </button>
                )}

                <button
                    className={`cb-btn cb-anim-pulse${cam.enabled ? '' : ' cb-off-soft'}`}
                    onClick={() => cam.toggle()}
                    disabled={cam.pending}
                    title={cam.enabled ? t('controls.cameraOff') : t('controls.cameraOn')}
                >
                    {cam.enabled ? <VideoOffIcon /> : <VideoIcon />}
                </button>

                <div className="cb-divider" />

                <button
                    className={`cb-btn cb-anim-bounce${chatOpen ? ' cb-active' : ''}`}
                    onClick={onToggleChat}
                    title={t('controls.chat')}
                >
                    <ChatIcon />
                    {unreadCount > 0 && (
                        <span className="cb-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
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
