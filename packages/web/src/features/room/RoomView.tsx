import { LiveKitRoom } from '@livekit/components-react';
import { AudioPresets, VideoPresets, ScreenSharePresets, ExternalE2EEKeyProvider, isE2EESupported, Room, createLocalAudioTrack, Track } from 'livekit-client';
import type { AudioCaptureOptions, RoomOptions, LocalAudioTrack } from 'livekit-client';
import E2EEWorker from 'livekit-client/e2ee-worker?worker';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getRoom, getToken } from '../../lib/api';
import { ApiError } from '../../lib/types';
import type { TokenResponse } from '../../lib/types';
import { getPassPool, saveToPool, saveRoomPassword, getRoomPassword } from '../../lib/passwords';
import { deriveRoomKeys } from '../../lib/roomKeys';
import type { AppSettings } from '../settings/types';
import { RoomShell } from './RoomShell';
import './RoomView.css';

interface RoomViewProps {
    roomName: string;  // opaque room ID
    name: string;      // display name
    hashPassword?: string | null;  // password from URL hash fragment (#pw=...)
    myAvatarUrl?: string | null;
    settings: AppSettings;
    onUpdateSettings: (patch: Partial<AppSettings>) => void;
    onLeave: () => void;
    onOpenSettings: () => void;
    volumes: Map<string, number>;
    onVolumeChange: (identity: string, vol: number) => void;
}

/** Join failures that get their own explanation instead of the bare error code. */
const ERROR_SCREENS: Record<string, { title: string; desc: string }> = {
    room_not_found: { title: 'room.notFound', desc: 'room.notFoundDesc' },
    room_full: { title: 'room.full', desc: 'room.fullDesc' },
    banned: { title: 'room.banned', desc: 'room.bannedDesc' },
    not_allowed: { title: 'room.notAllowed', desc: 'room.notAllowedDesc' },
};

export function RoomView({ roomName, name, hashPassword, myAvatarUrl, settings, onUpdateSettings, onLeave, onOpenSettings, volumes, onVolumeChange }: RoomViewProps) {
    const { t } = useTranslation();
    const [connection, setConnection] = useState<{ token: string; url: string; canModerate: boolean } | null>(null);
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

    // Terminate E2EE worker on unmount
    useEffect(() => {
        return () => { e2eeSetup?.worker.terminate(); };
    }, [e2eeSetup]);

    // Hoisted into useMemo (and placed before any early return below, so the hook
    // itself always runs) so <LiveKitRoom> gets referentially-stable `audio`/`options`
    // objects across re-renders instead of a fresh object every render — LiveKitRoom
    // otherwise has no way to tell "same settings" from "settings changed".
    //
    // AEC defaults on — disabling it in a voice room creates echo that every
    // other listener hears (speakerphone/laptop speakers), so the settings UI
    // warns to only turn it off with headphones. Exposing the toggle matters
    // because starting/stopping an echoCancellation:true capture retriggers
    // Chromium's ChromeWideEchoCancellation feature: the audio service stops
    // and reopens ALL of Chrome's currently-playing output streams as one
    // mixed stream (OutputDeviceMixerImpl::StartListening), then switches back
    // ~1s after the last AEC capture stops. On Linux/PipeWire that close/reopen
    // is audible as a harsh ~0.5-1s glitch in whatever's playing. The join-time
    // occurrence of this is mitigated below by pre-acquiring the mic track
    // before any call audio plays; toggling AEC or switching the mic device
    // mid-call still pays this cost, and headphone users gain quality with it
    // off. Music / screen-share-audio uses a separate path with AEC always off.
    const audioOptions: AudioCaptureOptions = useMemo(() => ({
        autoGainControl: settings.autoGainControl,
        noiseSuppression: settings.noiseSuppressionMode === 'browser',
        echoCancellation: settings.echoCancellation,
        deviceId: settings.audioInputDeviceId || undefined,
    }), [settings.autoGainControl, settings.noiseSuppressionMode, settings.echoCancellation, settings.audioInputDeviceId]);

    const roomOptions: RoomOptions = useMemo(() => {
        const videoResolutionMap: Record<string, typeof VideoPresets.h720.resolution> = {
            h1080: VideoPresets.h1080.resolution,
            h720: VideoPresets.h720.resolution,
            vga: VideoPresets.h360.resolution,
        };
        return {
            ...(e2eeSetup ? { e2ee: { keyProvider: e2eeSetup.keyProvider, worker: e2eeSetup.worker } } : {}),
            audioOutput: settings.audioOutputDeviceId ? { deviceId: settings.audioOutputDeviceId } : undefined,
            audioCaptureDefaults: audioOptions,
            videoCaptureDefaults: {
                resolution: videoResolutionMap[settings.videoResolution] ?? VideoPresets.h720.resolution,
                deviceId: settings.videoInputDeviceId || undefined,
            },
            publishDefaults: {
                audioPreset: AudioPresets[settings.audioQuality],
                // DTX (discontinuous transmission) stops sending audio packets during
                // silence. On the music-quality presets, receivers' Opus decoders fill
                // those gaps with comfort noise — audible as hiss right after a silent
                // participant joins. Only the speech preset (voice-tuned, mono, lower
                // bitrate) is worth the tradeoff; music presets keep the stream live.
                dtx: settings.audioQuality === 'speech',
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
    }, [e2eeSetup, audioOptions, settings.audioOutputDeviceId, settings.videoResolution, settings.videoInputDeviceId, settings.audioQuality, settings.simulcast]);

    // We construct the Room ourselves (instead of letting <LiveKitRoom> do it via
    // `options`) so we can call `prepareConnection` on it as soon as the token
    // arrives — warming up DNS/TLS while the E2EE setup is still in flight. Passing a `room` instance makes the `options` prop a
    // no-op (per @livekit/components-react's LiveKitRoomProps doc), so options
    // must be — and are, via roomOptions above — set at construction time here.
    // Recreating the Room when roomOptions changes is correct: e2ee must be
    // configured at construction, and this mirrors the prior behavior where
    // <LiveKitRoom> itself recreated its internal Room whenever `options` changed
    // identity. <LiveKitRoom> handles disconnecting the previous Room instance
    // when the `room` prop changes, so no manual disconnect is needed here.
    const room = useMemo(() => new Room(roomOptions), [roomOptions]);

    // Bumped on every (re)connect attempt and on unmount; async work compares
    // its captured generation to detect it went stale mid-flight (fast room
    // switch), so a late token/E2EE worker can't attach to an abandoned attempt.
    const connectGenRef = useRef(0);

    // Pre-acquired mic track for the CWAEC join-glitch mitigation (see the
    // audioOptions comment above). Populated by the join-flow effect below as
    // soon as a join attempt starts, consumed once by handleConnected on the
    // first real connect. `micPublishedRef` gates that one-time hand-off:
    // once true, later Connected events (e.g. the Room-recreation-on-settings-
    // change path — see the `room` useMemo comment) fall back to the normal
    // acquire+publish path instead of re-touching this ref.
    const micTrackRef = useRef<LocalAudioTrack | null>(null);
    const micPublishedRef = useRef(false);
    // Guards against handling the same Room's Connected event twice (e.g. a
    // stray duplicate event) — only re-runs the publish/fallback logic when
    // Connected fires for a *different* Room instance than last time.
    const handledRoomRef = useRef<Room | null>(null);

    // Settings mirrored into a ref so handleConnected (registered once per
    // `room`/`audioOptions` identity) can read the *current* push-to-talk
    // setting without becoming a dependency that would recreate the callback
    // (and re-fire LiveKitRoom's onConnected wiring) on every settings change.
    const settingsRef = useRef(settings);
    useEffect(() => { settingsRef.current = settings; });

    // The room's password salt, read at the start of each join attempt.
    const saltRef = useRef<string | undefined>(undefined);

    /** Asks for a token, proving the password with a key derived from it when there is one. */
    const fetchToken = async (pw?: string) => {
        const keys = pw && saltRef.current ? await deriveRoomKeys(pw, saltRef.current) : undefined;
        const data = await getToken({ room: roomName, name, passwordKey: keys?.authKey });
        return { data, e2eeKey: keys?.e2eeKey };
    };

    const applyToken = async ({ token, url, canModerate }: TokenResponse, e2eeKey?: ArrayBuffer, pw?: string) => {
        const gen = connectGenRef.current;
        room.prepareConnection(url, token).catch(err => {
            console.warn('[RoomView] prepareConnection failed:', err instanceof Error ? err.message : err);
        });
        if (e2eeKey && isE2EESupported()) {
            const keyProvider = new ExternalE2EEKeyProvider();
            await keyProvider.setKey(e2eeKey);
            if (connectGenRef.current !== gen) return;
            const worker = new E2EEWorker();
            setE2eeSetup({ keyProvider, worker });
        }
        if (connectGenRef.current !== gen) return;
        // Remember working password for this room (for invite links)
        if (pw) saveRoomPassword(roomName, pw);
        setConnection({ token, url, canModerate });
        // Save session for crash recovery
        window.electronAPI?.saveSession?.({ serverUrl: window.location.origin, roomId: roomName });
        // Activate power save blocker
        window.electronAPI?.setInCall?.(true);
    };

    useEffect(() => {
        connectGenRef.current++;
        const gen = connectGenRef.current;
        const mounted = () => connectGenRef.current === gen;
        setConnection(null);
        setErrorCode(null);
        setNeedsPassword(false);
        setPassword('');
        setPasswordError(null);
        setE2eeSetup(null);
        micPublishedRef.current = false;

        // Pre-acquire the mic track for this join attempt now, in parallel with
        // the token fetch below (see the audioOptions comment above for why this
        // timing matters — CWAEC's output-mixer reroute needs to happen while
        // the app is still silent). Not awaited: acquisition races the token
        // fetch/password flow, and the track is only actually published once
        // <LiveKitRoom> reports a real connection, in handleConnected. Reads
        // `audioOptions` from the enclosing closure rather than as a dependency
        // (see the eslint-disable below) — if settings change between mount and
        // this connect, the track may end up with stale constraints, which is
        // acceptable; the existing settings-change path (the `room` useMemo
        // recreating on `roomOptions` change) fixes that up after connect.
        createLocalAudioTrack(audioOptions).then(track => {
            if (!mounted()) { track.stop(); return; }
            micTrackRef.current = track;
        }).catch(err => {
            // Mic permission denied or no device — join proceeds without a
            // pre-published mic, exactly as it would if getUserMedia had
            // instead failed at LiveKitRoom's normal (later) publish time.
            console.warn('[RoomView] Pre-acquiring microphone track failed:', err instanceof Error ? err.message : err);
        });

        // Fatal (non-password) error — rate limit gets its own countdown UI.
        const handleFatalError = (err: unknown) => {
            if (err instanceof ApiError && err.code === 'rate_limited') {
                const secs = err.retryAfter ?? 60;
                countdownInitRef.current = secs;
                setCountdown(secs);
                setErrorCode('rate_limited');
                return;
            }
            setErrorCode(err instanceof ApiError ? err.code : 'server_error');
        };

        const tryPassword = async (pw?: string) => {
            const { data, e2eeKey } = await fetchToken(pw);
            if (!mounted()) return;
            await applyToken(data, e2eeKey, pw);
        };
        const isPasswordError = (err: unknown) =>
            err instanceof ApiError && (err.code === 'wrong_password' || err.code === 'password_required');

        const start = async () => {
            try {
                const info = await getRoom(roomName);
                if (!mounted()) return;
                saltRef.current = info.passwordSalt;
                if (!info.passwordSalt) {
                    await tryPassword();
                    return;
                }
                // The invite link's password and the one saved for this room first, then the pool.
                const candidates = new Set([hashPassword, getRoomPassword(roomName), ...getPassPool()]);
                for (const pw of candidates) {
                    if (!pw) continue;
                    try {
                        await tryPassword(pw);
                        return;
                    } catch (err) {
                        if (!mounted()) return;
                        if (!isPasswordError(err)) throw err;
                    }
                }
                if (mounted()) setNeedsPassword(true);
            } catch (err) {
                if (mounted()) handleFatalError(err);
            }
        };

        start();
        return () => {
            // Invalidate in-flight async work from this attempt
            connectGenRef.current++;
            // Release power save blocker on leave/unmount
            window.electronAPI?.setInCall?.(false);
            // Never leak a live capture: if this attempt's pre-acquired track
            // never made it to a real publish (attempt aborted, room switched,
            // or component unmounted/left), stop it here. Once published,
            // LiveKit's own disconnect handling owns the track's lifecycle,
            // same as it always has for a normally-published mic track.
            if (micTrackRef.current && !micPublishedRef.current) {
                micTrackRef.current.stop();
                micTrackRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomName, retryKey]);

    // A join failure (including a rate-limit backoff, which parks us here for
    // up to 60s) means we're not about to connect for a while — release the
    // pre-acquired, unpublished mic rather than holding a live capture with
    // nothing happening. The next attempt (new retryKey/roomName, handled by
    // the join-flow effect above) re-acquires a fresh track. `needsPassword`
    // is deliberately NOT treated the same way here: that's an interactive
    // prompt, not a failure, and the whole point is for the track acquired at
    // the start of this attempt to still be there once the password succeeds.
    useEffect(() => {
        if (!errorCode) return;
        if (micTrackRef.current && !micPublishedRef.current) {
            micTrackRef.current.stop();
            micTrackRef.current = null;
        }
    }, [errorCode]);

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

    // Called once <LiveKitRoom> reports a real connection (RoomEvent.Connected,
    // not just SignalConnected) — hands the pre-acquired track off to the now-
    // live Room. `audio={false}` on <LiveKitRoom> below means its own internal
    // auto-publish logic never touches the microphone, so this is the sole
    // publisher for it.
    const handleConnected = useCallback(() => {
        // Guard against a stray duplicate Connected event for the same Room —
        // there's nothing new to do for it either way.
        if (handledRoomRef.current === room) return;
        handledRoomRef.current = room;

        const track = micTrackRef.current;
        if (track && !micPublishedRef.current) {
            micPublishedRef.current = true;
            room.localParticipant.publishTrack(track, { source: Track.Source.Microphone })
                .then(() => {
                    // Push-to-talk starts muted: usePushToTalk's mount-time
                    // setMicrophoneEnabled(false) call may already have run (and
                    // no-op'd, since no publication existed yet) before this
                    // publish landed, so enforce the muted start here too.
                    if (settingsRef.current.pushToTalk) track.mute().catch(() => {});
                })
                .catch(err => {
                    console.warn('[RoomView] Failed to publish pre-acquired microphone track:', err instanceof Error ? err.message : err);
                    micPublishedRef.current = false;
                    // Fall back to the normal acquire+publish path so this
                    // connect isn't left silently mic-less because of it.
                    room.localParticipant.setMicrophoneEnabled(true, audioOptions).catch(() => {});
                });
        } else if (!track) {
            // No pre-acquired track available for this connect — either mic
            // permission was denied/no device at acquisition time (join
            // proceeds mic-less, as before this change), or this Connected
            // event belongs to a Room recreated by a mid-call settings change
            // (see the `room` useMemo above): that Room's own pre-acquired
            // track was already consumed by the previous Room. Acquire+publish
            // the normal way so device/setting changes keep working exactly as
            // they did before this change.
            room.localParticipant.setMicrophoneEnabled(true, audioOptions).catch(err => {
                console.warn('[RoomView] Microphone publish failed:', err instanceof Error ? err.message : err);
            });
        }
        // `track && micPublishedRef.current` (both true) falls through with no
        // action: a reconnect on the *same* Room, whose already-published
        // track LiveKit keeps alive/republishes on its own.
    }, [room, audioOptions]);

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password || passwordLoading) return;
        setPasswordLoading(true);
        setPasswordError(null);
        try {
            const { data, e2eeKey } = await fetchToken(password);
            if (savePassword) saveToPool(password);
            await applyToken(data, e2eeKey, password);
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
                        autoFocus
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

    const errorScreen = errorCode ? ERROR_SCREENS[errorCode] : undefined;
    if (errorScreen) {
        return (
            <div className="empty-state">
                <h2 className="empty-state-title">{t(errorScreen.title)}</h2>
                <p className="empty-state-sub">{t(errorScreen.desc)}</p>
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

    if (!connection) {
        return <div className="empty-state"><p style={{ color: 'var(--text-muted)' }}>{t('room.connecting')}</p></div>;
    }

    return (
        <div className="main-content">
            <LiveKitRoom
                room={room}
                token={connection.token}
                serverUrl={connection.url}
                connect={true}
                video={false}
                // Mic publish is handled entirely by handleConnected below (the
                // pre-acquired-track hand-off, falling back to a normal publish
                // when there's no pre-acquired track) — LiveKitRoom itself must
                // never auto-publish the microphone, hence `false` here.
                audio={false}
                onConnected={handleConnected}
                onDisconnected={onLeave}
                style={{ height: '100%' }}
            >
                <RoomShell canModerate={connection.canModerate} name={name} myAvatarUrl={myAvatarUrl} onOpenSettings={onOpenSettings} settings={settings} onUpdateSettings={onUpdateSettings} volumes={volumes} onVolumeChange={onVolumeChange} />
            </LiveKitRoom>
        </div>
    );
}
