import { LiveKitRoom } from '@livekit/components-react';
import { AudioPresets, VideoPresets, ScreenSharePresets, ExternalE2EEKeyProvider, isE2EESupported } from 'livekit-client';
import type { AudioCaptureOptions, RoomOptions } from 'livekit-client';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LIVEKIT_URL } from '../../lib/constants';
import { getToken } from '../../lib/api';
import { ApiError } from '../../lib/types';
import { getPassPool, saveToPool } from '../../lib/passwords';
import type { AppSettings } from '../settings/types';
import { RoomShell } from './RoomShell';
import './RoomView.css';

interface RoomViewProps {
    roomName: string;  // opaque room ID
    name: string;      // display name
    identity: string;  // stable device UUID — server derives LiveKit identity via HMAC
    myAvatarUrl?: string | null;
    settings: AppSettings;
    onUpdateSettings: (patch: Partial<AppSettings>) => void;
    onLeave: () => void;
    onIdentityAssigned?: (identity: string) => void;
    onAvatarReceived?: (identity: string, dataUrl: string | null) => void;
    onSpeakersChange: (identities: string[]) => void;
    onMutedChange: (mutedIds: Set<string>) => void;
    onDeafenedChange: (deafenedIds: Set<string>) => void;
    onLiveParticipantsChange: (participants: Map<string, string>) => void;
    onOpenSettings: () => void;
    volumes: Map<string, number>;
    onVolumeChange: (identity: string, vol: number) => void;
}

export function RoomView({ roomName, name, identity, myAvatarUrl, settings, onUpdateSettings, onLeave, onIdentityAssigned, onAvatarReceived, onSpeakersChange, onMutedChange, onDeafenedChange, onLiveParticipantsChange, onOpenSettings, volumes, onVolumeChange }: RoomViewProps) {
    const { t } = useTranslation();
    const [token, setToken] = useState<string | null>(null);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [countdown, setCountdown] = useState(0);
    const countdownInitRef = useRef(0);
    const [retryKey, setRetryKey] = useState(0);
    const [needsPassword, setNeedsPassword] = useState(false);
    const [password, setPassword] = useState('');
    const [savePassword, setSavePassword] = useState(true);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [e2eeSetup, setE2eeSetup] = useState<{ keyProvider: ExternalE2EEKeyProvider; worker: Worker } | null>(null);
    const passwordRef = useRef<HTMLInputElement>(null);

    // Terminate E2EE worker on unmount
    useEffect(() => {
        return () => { e2eeSetup?.worker.terminate(); };
    }, [e2eeSetup]);

    const adminSecret = localStorage.getItem(`lala_admin_${roomName}`) ?? undefined;

    const fetchToken = (pw?: string) => {
        return getToken({ room: roomName, name, deviceId: identity, password: pw, adminSecret });
    };

    const applyToken = async (tokenStr: string, pw?: string) => {
        if (pw && isE2EESupported()) {
            const keyProvider = new ExternalE2EEKeyProvider();
            await keyProvider.setKey(pw);
            const worker = new Worker('/lala-e2ee-worker.js', { type: 'module' });
            setE2eeSetup({ keyProvider, worker });
        }
        setToken(tokenStr);
        // Save session for crash recovery
        window.electronAPI?.saveSession?.({ serverUrl: window.location.origin, roomId: roomName });
        // Activate power save blocker
        window.electronAPI?.setInCall?.(true);
    };

    useEffect(() => {
        let mounted = true;
        setToken(null);
        setErrorCode(null);
        setNeedsPassword(false);
        setPassword('');
        setPasswordError(null);
        setE2eeSetup(null);

        const tryPool = async () => {
            const pool = getPassPool();
            for (const pw of pool) {
                try {
                    const data = await fetchToken(pw);
                    if (!mounted) return;
                    onIdentityAssigned?.(data.identity);
                    await applyToken(data.token, pw);
                    return;
                } catch (err) {
                    if (!mounted) return;
                    // Wrong password — try next in pool
                    if (err instanceof ApiError && (err.code === 'wrong_password' || err.code === 'password_required')) continue;
                    // Rate limited or other error — stop pool iteration, show error
                    if (err instanceof ApiError && err.code === 'rate_limited') {
                        const secs = err.retryAfter ?? 60;
                        countdownInitRef.current = secs;
                        setCountdown(secs);
                        setErrorCode('rate_limited');
                        return;
                    }
                    setErrorCode(err instanceof ApiError ? err.code : 'server_error');
                    return;
                }
            }
            if (mounted) {
                setNeedsPassword(true);
                setTimeout(() => passwordRef.current?.focus(), 50);
            }
        };

        fetchToken()
            .then(async (data) => {
                if (mounted) {
                    onIdentityAssigned?.(data.identity);
                    await applyToken(data.token);
                }
            })
            .catch((err) => {
                if (!mounted) return;
                if (err instanceof ApiError && (err.code === 'password_required' || err.code === 'wrong_password')) {
                    tryPool();
                } else {
                    const code = err instanceof ApiError ? err.code : 'server_error';
                    if (code === 'rate_limited' && err instanceof ApiError) {
                        const secs = err.retryAfter ?? 60;
                        countdownInitRef.current = secs;
                        setCountdown(secs);
                    }
                    setErrorCode(code);
                }
            });
        return () => {
            mounted = false;
            // Release power save blocker on leave/unmount
            window.electronAPI?.setInCall?.(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomName, retryKey]);

    // Countdown + auto-retry for rate limiting
    useEffect(() => {
        if (errorCode !== 'rate_limited') return;
        if (countdown <= 0) {
            setErrorCode(null);
            setRetryKey(k => k + 1);
            return;
        }
        const id = setTimeout(() => setCountdown(c => c - 1), 1000);
        return () => clearTimeout(id);
    }, [errorCode, countdown]);

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password || passwordLoading) return;
        setPasswordLoading(true);
        setPasswordError(null);
        try {
            const data = await fetchToken(password);
            if (savePassword) saveToPool(password);
            onIdentityAssigned?.(data.identity);
            await applyToken(data.token, password);
            setNeedsPassword(false);
        } catch (err) {
            if (err instanceof ApiError && err.code === 'wrong_password') {
                setPasswordError(t('room.wrongPassword'));
            } else {
                setPasswordError(err instanceof Error ? err.message : t('room.error'));
            }
        } finally {
            setPasswordLoading(false);
        }
    };

    // Password prompt
    if (needsPassword) {
        return (
            <div className="empty-state">
                <div className="empty-state-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                </div>
                <h2 className="empty-state-title">{t('room.protected')}</h2>
                <p className="empty-state-sub">{t('room.enterPassword')}</p>
                <form onSubmit={handlePasswordSubmit} style={{ width: '100%', maxWidth: '280px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <input
                        ref={passwordRef}
                        className="input"
                        type="password"
                        placeholder={t('room.passwordPlaceholder')}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                    />
                    {passwordError && (
                        <p style={{ fontSize: '13px', color: 'var(--color-danger)', margin: 0 }}>{passwordError}</p>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={savePassword} onChange={e => setSavePassword(e.target.checked)} />
                        {t('room.rememberPassword')}
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="button" className="btn btn-ghost" onClick={onLeave} style={{ flex: 1 }}>
                            {t('room.back')}
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={!password || passwordLoading} style={{ flex: 1 }}>
                            {passwordLoading ? '...' : t('room.enter')}
                        </button>
                    </div>
                </form>
            </div>
        );
    }

    if (errorCode === 'rate_limited') {
        const r = 28;
        const circ = 2 * Math.PI * r;
        const progress = countdownInitRef.current > 0 ? countdown / countdownInitRef.current : 0;
        return (
            <div className="empty-state">
                <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto 20px' }}>
                    <svg width="80" height="80" viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--border-color)" strokeWidth="3" />
                        <circle
                            cx="40" cy="40" r={r} fill="none"
                            stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
                            strokeDasharray={circ}
                            strokeDashoffset={circ * (1 - progress)}
                            style={{ transition: 'stroke-dashoffset 0.9s linear' }}
                        />
                    </svg>
                    <span style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 22, fontWeight: 700, color: 'var(--accent)',
                    }}>
                        {countdown}
                    </span>
                </div>
                <h2 className="empty-state-title">{t('room.tooManyRequests')}</h2>
                <p className="empty-state-sub">{t('room.retryIn', { seconds: countdown })}</p>
            </div>
        );
    }

    if (errorCode === 'room_not_found') {
        return (
            <div className="empty-state">
                <h2 className="empty-state-title">{t('room.notFound')}</h2>
                <p className="empty-state-sub">{t('room.notFoundDesc')}</p>
                <button className="empty-state-cta" onClick={onLeave}>{t('room.back')}</button>
            </div>
        );
    }

    if (errorCode === 'room_full') {
        return (
            <div className="empty-state">
                <h2 className="empty-state-title">{t('room.full')}</h2>
                <p className="empty-state-sub">{t('room.fullDesc')}</p>
                <button className="empty-state-cta" onClick={onLeave}>{t('room.back')}</button>
            </div>
        );
    }

    if (errorCode === 'banned') {
        return (
            <div className="empty-state">
                <h2 className="empty-state-title">{t('room.banned')}</h2>
                <p className="empty-state-sub">{t('room.bannedDesc')}</p>
                <button className="empty-state-cta" onClick={onLeave}>{t('room.back')}</button>
            </div>
        );
    }

    if (errorCode) {
        return (
            <div className="empty-state">
                <p style={{ color: 'var(--color-danger)' }}>{t('room.errorCode', { code: errorCode })}</p>
                <button className="empty-state-cta" onClick={onLeave}>{t('room.back')}</button>
            </div>
        );
    }

    if (!token) {
        return <div className="empty-state"><p style={{ color: 'var(--text-muted)' }}>{t('room.connecting')}</p></div>;
    }

    const audioOptions: AudioCaptureOptions = {
        autoGainControl: settings.autoGainControl,
        noiseSuppression: settings.noiseSuppressionMode === 'browser',
        echoCancellation: settings.echoCancellation,
        deviceId: settings.audioInputDeviceId || undefined,
    };

    const videoResolutionMap: Record<string, typeof VideoPresets.h720.resolution> = {
        h1080: VideoPresets.h1080.resolution,
        h720: VideoPresets.h720.resolution,
        vga: VideoPresets.h360.resolution,
    };

    const roomOptions: RoomOptions = {
        ...(e2eeSetup ? { e2ee: { keyProvider: e2eeSetup.keyProvider, worker: e2eeSetup.worker } } : {}),
        audioOutput: settings.audioOutputDeviceId ? { deviceId: settings.audioOutputDeviceId } : undefined,
        audioCaptureDefaults: audioOptions,
        videoCaptureDefaults: {
            resolution: videoResolutionMap[settings.videoResolution] ?? VideoPresets.h720.resolution,
            deviceId: settings.videoInputDeviceId || undefined,
        },
        publishDefaults: {
            audioPreset: AudioPresets[settings.audioQuality],
            dtx: true,
            forceStereo: settings.audioQuality.includes('Stereo'),
            videoEncoding: {
                maxBitrate: 1_500_000,
                maxFramerate: 30,
            },
            screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
            simulcast: settings.simulcast,
        },
        adaptiveStream: true,
        dynacast: true,
    };

    return (
        <div className="main-content">
            <LiveKitRoom
                token={token}
                serverUrl={LIVEKIT_URL}
                connect={true}
                video={false}
                audio={audioOptions}
                options={roomOptions}
                onDisconnected={onLeave}
                style={{ height: '100%' }}
            >
                <RoomShell name={name} myAvatarUrl={myAvatarUrl} onSpeakersChange={onSpeakersChange} onMutedChange={onMutedChange} onDeafenedChange={onDeafenedChange} onLiveParticipantsChange={onLiveParticipantsChange} onIdentityAssigned={onIdentityAssigned} onAvatarReceived={onAvatarReceived} onOpenSettings={onOpenSettings} settings={settings} onUpdateSettings={onUpdateSettings} volumes={volumes} onVolumeChange={onVolumeChange} />
            </LiveKitRoom>
        </div>
    );
}
