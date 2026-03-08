import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScreenShareQuality } from '../hooks/useScreenShare';
import type { AppSettings } from '../../settings/types';
import type { DesktopSource } from '../../../types/electron';
import { useEscapeKey } from '../../../hooks/useEscapeKey';
import { Select } from '../../../ui/Select';
import { SCREEN_SHARE_FPS_STEPS, SCREEN_SHARE_BITRATE_STEPS, screenShareBitrateLabel } from '../../../lib/constants';
import './screen-share-modal.css';

interface ScreenShareModalProps {
    settings: AppSettings;
    onUpdateSettings: (patch: Partial<AppSettings>) => void;
    onConfirm: (quality: ScreenShareQuality, sourceId?: string, audio?: boolean) => void;
    onCancel: () => void;
}

const REFRESH_INTERVAL = 8000;
const SKELETON_COUNT = 4;

const QUALITY_OPTIONS = SCREEN_SHARE_BITRATE_STEPS.map((v, i) => ({
    value: String(i),
    label: screenShareBitrateLabel(v),
}));

const FPS_OPTIONS = SCREEN_SHARE_FPS_STEPS.map((v, i) => ({
    value: String(i),
    label: `${v} FPS`,
}));

export function ScreenShareModal({ settings, onUpdateSettings, onConfirm, onCancel }: ScreenShareModalProps) {
    const { t } = useTranslation();
    useEscapeKey(onCancel);
    const [fpsIdx, setFpsIdx] = useState(settings.screenShareFpsIdx);
    const [brIdx, setBrIdx] = useState(settings.screenShareBrIdx);
    const [skipDialog, setSkipDialog] = useState(settings.screenShareSkipDialog);
    const [audio, setAudio] = useState(settings.screenShareAudio ?? true);

    const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
    const [sources, setSources] = useState<DesktopSource[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedSourceId, setSelectedSourceId] = useState<string | undefined>();
    const [activeTab, setActiveTab] = useState<'window' | 'screen'>('window');

    const mountedRef = useRef(true);

    const fetchSources = useCallback(() => {
        if (!window.electronAPI) return;
        window.electronAPI.getDesktopSources().then(fetched => {
            if (!mountedRef.current) return;
            setSources(fetched);
            setLoading(false);
            setSelectedSourceId(prev => {
                if (prev && fetched.some(s => s.id === prev)) return prev;
                const firstWindow = fetched.find(s => s.id.startsWith('window:'));
                return firstWindow?.id ?? fetched[0]?.id;
            });
        }).catch(() => { if (mountedRef.current) setLoading(false); });
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        fetchSources();
        const timer = setInterval(fetchSources, REFRESH_INTERVAL);
        return () => { mountedRef.current = false; clearInterval(timer); };
    }, [fetchSources]);

    const fps = SCREEN_SHARE_FPS_STEPS[fpsIdx];
    const mbps = SCREEN_SHARE_BITRATE_STEPS[brIdx];

    const handleConfirm = () => {
        const quality: ScreenShareQuality = {
            id: `${mbps}mbps${fps}fps`,
            label: `${screenShareBitrateLabel(mbps)} · ${fps}fps`,
            description: `${mbps} Mbps`,
            encoding: {
                maxBitrate: mbps * 1_000_000,
                maxFramerate: fps,
            },
        };
        onUpdateSettings({
            screenShareFpsIdx: fpsIdx,
            screenShareBrIdx: brIdx,
            screenShareSkipDialog: skipDialog,
            screenShareAudio: audio,
        });
        onConfirm(quality, selectedSourceId, audio);
    };

    const screens = useMemo(() => sources.filter(s => s.id.startsWith('screen:')), [sources]);
    const windows = useMemo(() => sources.filter(s => s.id.startsWith('window:')), [sources]);
    const visibleSources = activeTab === 'screen' ? screens : windows;

    const audioToggle = (
        <button
            className={`ss-audio-toggle ${audio ? 'active' : ''}`}
            onClick={() => setAudio(a => !a)}
            title={audio ? t('screenShare.audioOn') : t('screenShare.audioOff')}
        >
            {audio ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
            ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
            )}
        </button>
    );

    return (
        <div className="ss-backdrop" onClick={onCancel}>
            <div className={`ss-modal ${isElectron ? 'ss-modal-large' : ''}`} onClick={(e) => e.stopPropagation()}>
                <h3 className="ss-title">{t('screenShare.title')}</h3>

                {isElectron ? (
                    <>
                        <div className="ss-desktop-picker">
                            <div className="ss-tabs">
                                <button
                                    className={`ss-tab ${activeTab === 'window' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('window')}
                                >
                                    {t('screenShare.windowsTab')} ({loading ? '—' : windows.length})
                                </button>
                                <button
                                    className={`ss-tab ${activeTab === 'screen' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('screen')}
                                >
                                    {t('screenShare.screensTab')} ({loading ? '—' : screens.length})
                                </button>
                            </div>

                            <div className="ss-source-grid">
                                {loading ? (
                                    Array.from({ length: SKELETON_COUNT }, (_, i) => (
                                        <div key={i} className="ss-source-tile ss-skeleton">
                                            <div className="ss-source-thumbnail ss-skeleton-thumb" />
                                            <div className="ss-source-name">
                                                <div className="ss-skeleton-text" />
                                            </div>
                                        </div>
                                    ))
                                ) : visibleSources.length > 0 ? (
                                    visibleSources.map(source => (
                                        <div
                                            key={source.id}
                                            className={`ss-source-tile ${selectedSourceId === source.id ? 'selected' : ''}`}
                                            onClick={() => setSelectedSourceId(source.id)}
                                        >
                                            <div className="ss-source-thumbnail">
                                                <img src={source.thumbnail} alt={source.name} />
                                            </div>
                                            <div className="ss-source-name" title={source.name}>
                                                {source.appIcon && (
                                                    <img src={source.appIcon} alt="" className="ss-source-icon" />
                                                )}
                                                <span>{source.name}</span>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="ss-no-sources">
                                        {t('screenShare.noSources', { type: t(activeTab === 'screen' ? 'screenShare.noScreens' : 'screenShare.noWindows') })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="ss-bottom-bar">
                            <div className="ss-controls">
                                <Select
                                    value={String(brIdx)}
                                    onChange={(v) => setBrIdx(Number(v))}
                                    options={QUALITY_OPTIONS}
                                    className="ss-select-compact"
                                />
                                <Select
                                    value={String(fpsIdx)}
                                    onChange={(v) => setFpsIdx(Number(v))}
                                    options={FPS_OPTIONS}
                                    className="ss-select-compact"
                                />
                                {audioToggle}
                            </div>
                            <div className="ss-actions">
                                <button className="ss-btn-cancel" onClick={onCancel}>{t('screenShare.cancel')}</button>
                                <button
                                    className="ss-btn-confirm"
                                    onClick={handleConfirm}
                                    disabled={!selectedSourceId}
                                >
                                    {t('screenShare.start')}
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    /* Browser mode — no source picker, centered controls */
                    <>
                        <div className="ss-browser-hint">
                            {t('screenShare.browserHint')}
                        </div>
                        <div className="ss-browser-controls">
                            <div className="ss-browser-row">
                                <label className="ss-browser-label">{t('screenShare.quality')}</label>
                                <Select
                                    value={String(brIdx)}
                                    onChange={(v) => setBrIdx(Number(v))}
                                    options={QUALITY_OPTIONS}
                                />
                            </div>
                            <div className="ss-browser-row">
                                <label className="ss-browser-label">{t('screenShare.frameRate')}</label>
                                <Select
                                    value={String(fpsIdx)}
                                    onChange={(v) => setFpsIdx(Number(v))}
                                    options={FPS_OPTIONS}
                                />
                            </div>
                            <div className="ss-browser-row">
                                <label className="ss-browser-label">{t('screenShare.audio')}</label>
                                {audioToggle}
                            </div>
                        </div>
                        <div className="ss-bottom-bar">
                            <label className="ss-skip">
                                <input
                                    type="checkbox"
                                    checked={skipDialog}
                                    onChange={(e) => setSkipDialog(e.target.checked)}
                                />
                                {t('screenShare.dontAsk')}
                            </label>
                            <div className="ss-actions">
                                <button className="ss-btn-cancel" onClick={onCancel}>{t('screenShare.cancel')}</button>
                                <button className="ss-btn-confirm" onClick={handleConfirm}>
                                    {t('screenShare.start')}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
