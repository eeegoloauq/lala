import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import type { AppSettings, AudioQualityPreset, NoiseSuppressionMode } from './types';
import { useTheme, type Theme } from './ThemeProvider';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { Select } from '../../ui/Select';
import type { SelectOption } from '../../ui/Select';
import { MicTester } from './MicTester';
import { getVoices, ttsSupported } from '../../lib/tts';
import { SCREEN_SHARE_FPS_STEPS, SCREEN_SHARE_BITRATE_STEPS, screenShareBitrateLabel } from '../../lib/constants';
import { compressAvatar } from '../../lib/avatarUtils';
import { getPassPool, removeFromPool, clearPool } from '../../lib/passwords';
import { ICON_VARIANTS } from '../../lib/iconVariants';
import './settings.css';
import '../room/ScreenShareModal/screen-share-modal.css';

type Section = 'profile' | 'security' | 'devices' | 'audio' | 'video' | 'appearance' | 'screenshare' | 'chat' | 'sounds' | 'keybinds' | 'desktop';

interface SettingsModalProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
  displayName?: string;
  onRename?: (name: string) => void;
  myAvatar?: string | null;
  onAvatarChange?: (dataUrl: string | null) => void;
}

const LANGUAGE_OPTIONS: SelectOption[] = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
];

const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
const isTouchDevice = typeof window !== 'undefined' && navigator.maxTouchPoints > 0;

// Load speech synthesis voices (they load async in some browsers)
function useTtsVoices() {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!ttsSupported) return;
    const onVoicesChanged = () => rerender(n => n + 1);
    window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
  }, []);
  return getVoices();
}

export function SettingsModal({ settings, onUpdate, onClose, displayName, onRename, myAvatar, onAvatarChange }: SettingsModalProps) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<Section>('profile');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micMonitor, setMicMonitor] = useState(false);
  const [savedPasswords, setSavedPasswords] = useState<string[]>(getPassPool);
  const { theme, setTheme } = useTheme();
  const ttsVoices = useTtsVoices();
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<Section, HTMLElement>>(new Map());
  const keybindCleanupRef = useRef<(() => void) | null>(null);

  // Clean up any dangling keybind listener on unmount
  useEffect(() => {
    return () => { keybindCleanupRef.current?.(); };
  }, []);

  const NS_OPTIONS: SelectOption[] = useMemo(() => [
    { value: 'disabled', label: t('settings.disabled') },
    { value: 'browser', label: t('settings.browserWebRTC') },
    { value: 'rnnoise', label: t('settings.rnnoiseAI') },
  ], [t]);

  const QUALITY_OPTIONS: SelectOption[] = useMemo(() => [
    { value: 'speech', label: t('settings.speech') },
    { value: 'music', label: t('settings.music') },
    { value: 'musicHighQuality', label: t('settings.musicHQ') },
    { value: 'musicHighQualityStereo', label: t('settings.musicHQStereo') },
  ], [t]);

  const THEME_OPTIONS: SelectOption[] = useMemo(() => [
    { value: 'dark', label: t('settings.themeDark') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'amoled', label: t('settings.themeAmoled') },
    { value: 'discord', label: t('settings.themeDiscord') },
    { value: 'retro', label: t('settings.themeRetro') },
    { value: 'winxp', label: t('settings.themeWinXP') },
  ], [t]);

  const RESOLUTION_OPTIONS: SelectOption[] = useMemo(() => [
    { value: 'h1080', label: t('settings.res1080') },
    { value: 'h720', label: t('settings.res720') },
    { value: 'vga', label: t('settings.res480') },
  ], [t]);

  const DEFAULT_DEVICE: SelectOption = useMemo(() => ({ value: '', label: t('settings.defaultDevice') }), [t]);

  const NAV: { group: string; items: { id: Section; label: string }[] }[] = useMemo(() => [
    {
      group: t('settings.account'),
      items: [
        { id: 'profile', label: t('settings.profile') },
        { id: 'security', label: t('settings.security') },
      ],
    },
    {
      group: t('settings.voiceVideo'),
      items: [
        { id: 'devices', label: t('settings.devices') },
        { id: 'audio', label: t('settings.audio') },
        { id: 'video', label: t('settings.video') },
      ],
    },
    {
      group: t('settings.app'),
      items: [
        { id: 'appearance', label: t('settings.appearance') },
        { id: 'screenshare', label: t('settings.screenShare') },
        { id: 'chat', label: t('settings.chat') },
        { id: 'sounds', label: t('settings.sounds') },
        ...(!isTouchDevice ? [{ id: 'keybinds' as Section, label: t('settings.keybinds') }] : []),
        ...(isElectron ? [{ id: 'desktop' as Section, label: t('settings.desktop') }] : []),
      ],
    },
  ], [t]);

  useEffect(() => {
    const fetchDevices = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        stream.getTracks().forEach(t => t.stop());
        const dev = await navigator.mediaDevices.enumerateDevices();
        setDevices(dev);
      } catch (err) {
        console.warn('Could not list devices', err);
      }
    };
    fetchDevices();
    navigator.mediaDevices.addEventListener('devicechange', fetchDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', fetchDevices);
  }, []);

  const handleClose = useCallback(() => {
    setMicMonitor(false);
    keybindCleanupRef.current?.();
    onClose();
  }, [onClose]);

  useEscapeKey(handleClose);

  // Update active nav item based on scroll position
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onScroll = () => {
      const scrollTop = el.scrollTop;
      let current: Section = 'devices';
      sectionRefs.current.forEach((ref, id) => {
        if (ref.offsetTop - 60 <= scrollTop) current = id;
      });
      setActiveSection(current);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const handleAvatarFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressAvatar(file);
      onAvatarChange?.(dataUrl);
    } catch (err) {
      console.warn('Avatar compression failed', err);
    }
    e.target.value = '';
  }, [onAvatarChange]);

  const removePassword = (idx: number) => {
    setSavedPasswords(removeFromPool(idx));
  };

  const clearPasswords = () => {
    setSavedPasswords([]);
    clearPool();
  };

  const scrollTo = useCallback((id: Section) => {
    const ref = sectionRefs.current.get(id);
    if (ref && contentRef.current) {
      contentRef.current.scrollTo({ top: ref.offsetTop - 16, behavior: 'smooth' });
    }
  }, []);

  const setSectionRef = (id: Section) => (el: HTMLElement | null) => {
    if (el) sectionRefs.current.set(id, el);
  };

  const audioInputOptions = useMemo<SelectOption[]>(() => [
    DEFAULT_DEVICE,
    ...devices.filter(d => d.kind === 'audioinput').map(d => ({
      value: d.deviceId,
      label: d.label || 'Unknown Microphone',
    })),
  ], [devices, DEFAULT_DEVICE]);

  const audioOutputOptions = useMemo<SelectOption[]>(() => [
    DEFAULT_DEVICE,
    ...devices.filter(d => d.kind === 'audiooutput').map(d => ({
      value: d.deviceId,
      label: d.label || 'Unknown Speaker',
    })),
  ], [devices, DEFAULT_DEVICE]);

  const videoInputOptions = useMemo<SelectOption[]>(() => [
    DEFAULT_DEVICE,
    ...devices.filter(d => d.kind === 'videoinput').map(d => ({
      value: d.deviceId,
      label: d.label || 'Unknown Camera',
    })),
  ], [devices, DEFAULT_DEVICE]);

  return (
    <div className="settings-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) handleClose();
    }}>
      <div className="settings-modal-box">

        {/* -- Sidebar -- */}
        <div className="settings-sidebar">
          <div className="settings-sidebar-nav">
            <div className="settings-sidebar-title">{t('settings.title')}</div>
            {NAV.map(group => (
              <div key={group.group} className="settings-nav-group">
                <div className="settings-nav-group-label">{group.group}</div>
                {group.items.map(item => (
                  <button
                    key={item.id}
                    className={`settings-nav-item${activeSection === item.id ? ' active' : ''}`}
                    onClick={() => scrollTo(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* -- Content -- */}
        <div className="settings-content-area" ref={contentRef}>
          <button className="settings-close-circle" onClick={handleClose} title="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <div className="settings-content-container">

            {/* -- Profile -- */}
            <h2 className="settings-header" ref={setSectionRef('profile')}>{t('settings.profile')}</h2>
            <div className="settings-section">
              <div className="settings-row">
                <div className="settings-row-label">{t('settings.displayName')}</div>
                <input
                  className="input"
                  defaultValue={displayName ?? ''}
                  maxLength={20}
                  placeholder={t('settings.namePlaceholder')}
                  onBlur={(e) => {
                    const val = e.target.value.trim();
                    if (val && val !== displayName && onRename) onRename(val);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
              </div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t('settings.avatar')}</div>
                  <div className="settings-row-desc">{t('settings.avatarHint')}</div>
                </div>
                <div className="avatar-upload-controls">
                  {myAvatar ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <img
                        src={myAvatar}
                        alt="Avatar preview"
                        style={{ width: 40, height: 40, borderRadius: 'var(--avatar-radius, 50%)', objectFit: 'cover', border: '1px solid var(--border-color)' }}
                      />
                      <button className="accent-reset-btn" onClick={() => onAvatarChange?.(null)}>
                        {t('settings.remove')}
                      </button>
                    </div>
                  ) : (
                    <label className="avatar-upload-btn">
                      {t('settings.uploadPhoto')}
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={handleAvatarFileChange}
                      />
                    </label>
                  )}
                </div>
              </div>
            </div>

            {/* -- Security -- */}
            <h2 className="settings-header" ref={setSectionRef('security')}>{t('settings.security')}</h2>
            <div className="settings-section">
              <div className="settings-section-title">{t('settings.savedPasswords')}</div>
              <p className="settings-row-desc" style={{ marginBottom: '16px' }}>{t('settings.savedPasswordsHint')}</p>
              {savedPasswords.length === 0 ? (
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('settings.noPasswords')}</p>
              ) : (<>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                  {savedPasswords.map((pw, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '120px', fontFamily: 'monospace', fontSize: '13px', letterSpacing: '0.15em', color: 'var(--text-secondary)', flexShrink: 0 }}>
                        {'•'.repeat(Math.min(pw.length, 12))}
                      </span>
                      <button className="accent-reset-btn" onClick={() => removePassword(i)}>{t('settings.remove')}</button>
                    </div>
                  ))}
                </div>
                <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={clearPasswords}>{t('settings.clearAll')}</button>
              </>)}
            </div>

            {/* -- Devices -- */}
            <h2 className="settings-header" ref={setSectionRef('devices')}>{t('settings.devices')}</h2>
            <div className="settings-section">
              <div className="settings-row-col">
                <div className="settings-row-label">{t('settings.microphone')}</div>
                <Select value={settings.audioInputDeviceId || ''} onChange={(v) => onUpdate({ audioInputDeviceId: v })} options={audioInputOptions} />
                <MicTester
                  deviceId={settings.audioInputDeviceId || undefined}
                  monitoring={micMonitor}
                  onMonitoringChange={setMicMonitor}
                  silenceGate={settings.silenceGate}
                  onSilenceGateChange={(v) => onUpdate({ silenceGate: v })}
                />
              </div>
              <div className="settings-row-col">
                <div className="settings-row-label">{t('settings.speaker')}</div>
                <Select value={settings.audioOutputDeviceId || ''} onChange={(v) => onUpdate({ audioOutputDeviceId: v })} options={audioOutputOptions} />
              </div>
              <div className="settings-row-col">
                <div className="settings-row-label">{t('settings.camera')}</div>
                <Select value={settings.videoInputDeviceId || ''} onChange={(v) => onUpdate({ videoInputDeviceId: v })} options={videoInputOptions} />
              </div>
            </div>

            {/* -- Audio -- */}
            <h2 className="settings-header" ref={setSectionRef('audio')}>{t('settings.audio')}</h2>

            <div className="settings-section">
              <div className="settings-section-title">{t('settings.quality')}</div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t('settings.micPreset')}</div>
                  <div className="settings-row-desc">{t('settings.micPresetHint')}</div>
                </div>
                <Select value={settings.audioQuality} onChange={(v) => onUpdate({ audioQuality: v as AudioQualityPreset })} options={QUALITY_OPTIONS} className="lala-select-wide" />
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">{t('settings.processing')}</div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t('settings.agc')}</div>
                  <div className="settings-row-desc">{t('settings.agcHint')}</div>
                </div>
                <label className="toggle">
                  <input type="checkbox" className="toggle-input" checked={settings.autoGainControl} onChange={(e) => onUpdate({ autoGainControl: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t('settings.noiseSuppression')}</div>
                  <div className="settings-row-desc">{t('settings.noiseSuppressionHint')}</div>
                </div>
                <Select
                  value={settings.noiseSuppressionMode}
                  onChange={(v) => onUpdate({ noiseSuppressionMode: v as NoiseSuppressionMode })}
                  options={NS_OPTIONS}
                  className="lala-select-wide"
                />
              </div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t('settings.echoCancellation')}</div>
                  <div className="settings-row-desc">{t('settings.echoCancellationHint')}</div>
                </div>
                <label className="toggle">
                  <input type="checkbox" className="toggle-input" checked={settings.echoCancellation} onChange={(e) => onUpdate({ echoCancellation: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">{t('settings.ptt')}</div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t('settings.enablePTT')}</div>
                  <div className="settings-row-desc">{t('settings.pttHint')}</div>
                </div>
                <label className="toggle">
                  <input type="checkbox" className="toggle-input" checked={settings.pushToTalk} onChange={(e) => onUpdate({ pushToTalk: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>
              {settings.pushToTalk && (
                <div className="settings-row ptt-keybind-row">
                  <div className="settings-row-label">{t('settings.keybind')}</div>
                  <button
                    className="btn ptt-keybind-btn"
                    onClick={() => {
                      keybindCleanupRef.current?.();
                      const handleKey = (e: KeyboardEvent) => {
                        e.preventDefault();
                        onUpdate({ pushToTalkKey: e.code });
                        window.removeEventListener('keydown', handleKey);
                        keybindCleanupRef.current = null;
                      };
                      window.addEventListener('keydown', handleKey);
                      keybindCleanupRef.current = () => window.removeEventListener('keydown', handleKey);
                    }}
                  >
                    {settings.pushToTalkKey || t('settings.clickToSet')}
                  </button>
                </div>
              )}
            </div>

            {/* -- Video -- */}
            <h2 className="settings-header" ref={setSectionRef('video')}>{t('settings.video')}</h2>
            <div className="settings-section">
              <div className="settings-section-title">{t('settings.camera')}</div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t('settings.resolution')}</div>
                  <div className="settings-row-desc">{t('settings.maxResolution')}</div>
                </div>
                <Select value={settings.videoResolution || 'h720'} onChange={(v) => onUpdate({ videoResolution: v })} options={RESOLUTION_OPTIONS} className="lala-select-wide" />
              </div>
            </div>

            {/* -- Appearance -- */}
            <h2 className="settings-header" ref={setSectionRef('appearance')}>{t('settings.appearance')}</h2>
            <div className="settings-section">
              <div className="settings-section-title">{t('settings.theme')}</div>
              <div className="settings-row">
                <div><div className="settings-row-label">{t('settings.theme')}</div></div>
                <Select value={theme} onChange={(v) => setTheme(v as Theme)} options={THEME_OPTIONS} className="lala-select-wide" />
              </div>
              <div className="settings-row">
                <div><div className="settings-row-label">{t('settings.language')}</div></div>
                <Select value={i18next.language?.startsWith('ru') ? 'ru' : 'en'} onChange={(v) => { i18next.changeLanguage(v); onUpdate({ language: v }); }} options={LANGUAGE_OPTIONS} className="lala-select-wide" />
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">{t('settings.video')}</div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t('settings.ambientMode')}</div>
                  <div className="settings-row-desc">{t('settings.ambientModeHint')}</div>
                </div>
                <label className="toggle">
                  <input type="checkbox" className="toggle-input" checked={settings.ambientMode} onChange={(e) => onUpdate({ ambientMode: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t('settings.simulcast')}</div>
                  <div className="settings-row-desc">{t('settings.simulcastHint')}</div>
                </div>
                <label className="toggle">
                  <input type="checkbox" className="toggle-input" checked={settings.simulcast ?? false} onChange={(e) => onUpdate({ simulcast: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">{t('settings.colors')}</div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t('settings.accentColor')}</div>
                  <div className="settings-row-desc">{t('settings.accentColorHint')}</div>
                </div>
                <div className="accent-picker-row">
                  <label className="accent-swatch-label">
                    <input type="color" className="accent-color-input" value={settings.accentColor || '#7c3aed'} onChange={(e) => onUpdate({ accentColor: e.target.value })} />
                    <span className="accent-swatch" style={{ background: settings.accentColor || 'var(--accent)' }} />
                  </label>
                  {settings.accentColor && <button className="accent-reset-btn" onClick={() => onUpdate({ accentColor: undefined })}>{t('settings.reset')}</button>}
                </div>
              </div>
            </div>

            {/* -- Screen Share -- */}
            <h2 className="settings-header" ref={setSectionRef('screenshare')}>{t('settings.screenShare')}</h2>
            <div className="settings-section">
              <div className="settings-section-title">{t('settings.defaultQuality')}</div>

              <div className="settings-row">
                <div><div className="settings-row-label">{t('settings.quality')}</div></div>
                <Select
                  value={String(settings.screenShareBrIdx)}
                  onChange={(v) => onUpdate({ screenShareBrIdx: Number(v) })}
                  options={SCREEN_SHARE_BITRATE_STEPS.map((v, i) => ({ value: String(i), label: screenShareBitrateLabel(v) }))}
                />
              </div>

              <div className="settings-row">
                <div><div className="settings-row-label">{t('settings.frameRate')}</div></div>
                <Select
                  value={String(settings.screenShareFpsIdx)}
                  onChange={(v) => onUpdate({ screenShareFpsIdx: Number(v) })}
                  options={SCREEN_SHARE_FPS_STEPS.map((v, i) => ({ value: String(i), label: `${v} FPS` }))}
                />
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">{t('settings.behaviour')}</div>
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t('settings.dontAskAgain')}</div>
                  <div className="settings-row-desc">{t('settings.skipPicker')}</div>
                </div>
                <label className="toggle">
                  <input type="checkbox" className="toggle-input" checked={settings.screenShareSkipDialog} onChange={(e) => onUpdate({ screenShareSkipDialog: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>
            </div>

            {/* -- Chat -- */}
            <h2 className="settings-header" ref={setSectionRef('chat')}>{t('settings.chat')}</h2>
            <div className="settings-section">
              <div className="settings-section-title">{t('settings.tts')}</div>

              <div className="settings-row">
                <div>
                  <div className="settings-row-label">{t('settings.ttsRead')}</div>
                  <div className="settings-row-desc">{t('settings.ttsReadHint')}</div>
                </div>
                <label className="toggle">
                  <input type="checkbox" className="toggle-input" checked={settings.chatTTS} onChange={(e) => onUpdate({ chatTTS: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>

              {settings.chatTTS && (<>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">{t('settings.ttsReadOwn')}</div>
                    <div className="settings-row-desc">{t('settings.ttsReadOwnHint')}</div>
                  </div>
                  <label className="toggle">
                    <input type="checkbox" className="toggle-input" checked={settings.ttsReadOwn} onChange={(e) => onUpdate({ ttsReadOwn: e.target.checked })} />
                    <span className="toggle-slider" />
                  </label>
                </div>

                <div className="settings-row-col">
                  <div className="settings-row-label">
                    {t('settings.ttsVolume')}
                    <span className="settings-row-badge">{settings.ttsVolume}%</span>
                  </div>
                  <input
                    type="range" min={0} max={100} step={5}
                    value={settings.ttsVolume}
                    onChange={(e) => onUpdate({ ttsVolume: Number(e.target.value) })}
                    className="settings-range"
                  />
                </div>

                <div className="settings-row">
                  <div className="settings-row-label">{t('settings.ttsMaxLength')}</div>
                  <input
                    type="number"
                    min={20} max={1000} step={10}
                    value={settings.ttsMaxLength}
                    onChange={(e) => {
                      const v = Math.max(20, Math.min(1000, Number(e.target.value)));
                      if (!isNaN(v)) onUpdate({ ttsMaxLength: v });
                    }}
                    style={{ width: 72, textAlign: 'right', padding: '4px 8px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', color: 'var(--text-primary)', fontSize: 13 }}
                  />
                </div>

                {ttsVoices.length > 0 && (
                  <div className="settings-row">
                    <div className="settings-row-label">{t('settings.ttsVoice')}</div>
                    <Select
                      value={settings.ttsVoice}
                      onChange={(v) => onUpdate({ ttsVoice: v })}
                      options={[
                        { value: '', label: t('settings.ttsDefault') },
                        ...ttsVoices.map(v => ({ value: v.name, label: `${v.name} (${v.lang})` })),
                      ]}
                    />
                  </div>
                )}
              </>)}
            </div>

            {/* -- Sounds -- */}
            <h2 className="settings-header" ref={setSectionRef('sounds')}>{t('settings.sounds')}</h2>
            <div className="settings-section">
              {(() => {
                const SOUND_KEYS = ['soundJoinLeave', 'soundChat', 'soundScreenShare', 'soundMicFeedback', 'soundTalkingWhileMuted'] as const;
                const allOn = SOUND_KEYS.every(k => settings[k] ?? true);
                return (<>
                  <div className="settings-row">
                    <div>
                      <div className="settings-row-label">{t('settings.allSounds')}</div>
                      <div className="settings-row-desc">{t('settings.allSoundsHint')}</div>
                    </div>
                    <label className="toggle">
                      <input type="checkbox" className="toggle-input" checked={allOn}
                        onChange={(e) => onUpdate(Object.fromEntries(SOUND_KEYS.map(k => [k, e.target.checked])))}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
                  {([
                    { key: 'soundJoinLeave',        label: t('settings.joinLeave'),       desc: t('settings.joinLeaveHint') },
                    { key: 'soundChat',              label: t('settings.newMessage'),      desc: t('settings.newMessageHint') },
                    { key: 'soundScreenShare',       label: t('settings.screenShareChime'), desc: t('settings.screenShareChimeHint') },
                    { key: 'soundMicFeedback',       label: t('settings.muteClick'),       desc: t('settings.muteClickHint') },
                    { key: 'soundTalkingWhileMuted', label: t('settings.talkingMuted'),    desc: t('settings.talkingMutedHint') },
                  ] as const).map(({ key, label, desc }) => (
                    <div className="settings-row" key={key}>
                      <div>
                        <div className="settings-row-label">{label}</div>
                        <div className="settings-row-desc">{desc}</div>
                      </div>
                      <label className="toggle">
                        <input type="checkbox" className="toggle-input"
                          checked={settings[key] ?? true}
                          onChange={(e) => onUpdate({ [key]: e.target.checked })}
                        />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                  ))}
                </>);
              })()}
            </div>

            {/* -- Keybinds (hidden on touch devices) -- */}
            {!isTouchDevice && <>
            <h2 className="settings-header" ref={setSectionRef('keybinds')}>{t('settings.keybinds')}</h2>
            <div className="settings-section">
              <div className="settings-row" style={{ marginBottom: 8 }}>
                <div>
                  <div className="settings-row-label">{t('settings.enableShortcuts')}</div>
                  <div className="settings-row-desc">{t('settings.shortcutsHint')}</div>
                </div>
                <label className="toggle">
                  <input type="checkbox" className="toggle-input"
                    checked={settings.shortcutsEnabled ?? true}
                    onChange={(e) => onUpdate({ shortcutsEnabled: e.target.checked })}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
              {(() => {
                const [listening, setListening] = useState<string | null>(null);
                const BINDS = [
                  { key: 'keyMic',         label: t('settings.keyMic') },
                  { key: 'keyCam',         label: t('settings.keyCam') },
                  { key: 'keyDeafen',      label: t('settings.keyDeafen') },
                  { key: 'keyChat',        label: t('settings.keyChat') },
                  { key: 'keyFullscreen',  label: t('settings.keyFullscreen') },
                  { key: 'keyScreenShare', label: t('settings.keyScreenShare') },
                ] as const;
                const label = (code: string) => {
                  if (code.startsWith('Key')) return code.slice(3);
                  if (code.startsWith('Digit')) return code.slice(5);
                  return code;
                };
                const startListen = (settingKey: string) => {
                  keybindCleanupRef.current?.();
                  setListening(settingKey);
                  const handler = (e: KeyboardEvent) => {
                    e.preventDefault();
                    if (e.code !== 'Escape') onUpdate({ [settingKey]: e.code });
                    setListening(null);
                    window.removeEventListener('keydown', handler, true);
                    keybindCleanupRef.current = null;
                  };
                  window.addEventListener('keydown', handler, true);
                  keybindCleanupRef.current = () => { window.removeEventListener('keydown', handler, true); setListening(null); };
                };
                return (
                  <table className="keybinds-table">
                    <tbody>
                      {BINDS.map(({ key, label: desc }) => (
                        <tr key={key} className="keybinds-row">
                          <td>
                            <button
                              className={`btn ptt-keybind-btn${listening === key ? ' ptt-keybind-btn--listening' : ''}`}
                              onClick={() => startListen(key)}
                            >
                              {listening === key ? '...' : label(settings[key] ?? '')}
                            </button>
                          </td>
                          <td className="keybinds-desc">{desc}</td>
                          <td>
                            <button
                              className="btn"
                              style={{ fontSize: 11, padding: '2px 7px', opacity: 0.5 }}
                              onClick={() => onUpdate({ [key]: ({ keyMic:'KeyM',keyCam:'KeyV',keyDeafen:'KeyD',keyChat:'KeyC',keyFullscreen:'KeyF',keyScreenShare:'KeyS' })[key] })}
                              title={t('settings.resetDefaults')}
                            >↩</button>
                          </td>
                        </tr>
                      ))}
                      <tr className="keybinds-row">
                        <td><kbd className="keybinds-key">Space</kbd></td>
                        <td className="keybinds-desc">{t('settings.keyPTT')}</td>
                        <td />
                      </tr>
                      <tr className="keybinds-row">
                        <td><kbd className="keybinds-key">Esc</kbd></td>
                        <td className="keybinds-desc">{t('settings.keyEsc')}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                );
              })()}
              <p className="keybinds-note">{t('settings.keybindsNote')}</p>
            </div>
            </>}

            {/* -- Desktop (Electron only) -- */}
            {isElectron && (<>
              <h2 className="settings-header" ref={setSectionRef('desktop')}>{t('settings.desktop')}</h2>
              <div className="settings-section">
                <div className="settings-section-title">{t('settings.startup')}</div>
                {(() => {
                  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null);
                  useEffect(() => {
                    window.electronAPI?.getAutoLaunch?.().then(setAutoLaunch);
                  }, []);
                  return (
                    <div className="settings-row">
                      <div>
                        <div className="settings-row-label">{t('settings.launchOnStartup')}</div>
                        <div className="settings-row-desc">{t('settings.launchOnStartupHint')}</div>
                      </div>
                      <label className="toggle">
                        <input
                          type="checkbox"
                          className="toggle-input"
                          checked={autoLaunch ?? false}
                          disabled={autoLaunch === null}
                          onChange={async (e) => {
                            const enabled = e.target.checked;
                            await window.electronAPI?.setAutoLaunch?.(enabled);
                            setAutoLaunch(enabled);
                          }}
                        />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                  );
                })()}
              </div>
              <div className="settings-section">
                <div className="settings-section-title">{t('settings.appIcon')}</div>
                <div className="settings-row-desc" style={{ marginBottom: 12 }}>{t('settings.appIconHint')}</div>
                {(() => {
                  const [currentIcon, setCurrentIcon] = useState<string>('voice-wave');
                  const [initialIcon, setInitialIcon] = useState<string>('voice-wave');
                  const [appInfo, setAppInfo] = useState<{ platform?: string }>({});
                  useEffect(() => {
                    window.electronAPI?.getAppIcon?.().then(v => { setCurrentIcon(v); setInitialIcon(v); });
                    window.electronAPI?.getAppInfo?.().then(setAppInfo);
                  }, []);
                  const isLinux = appInfo.platform === 'linux';
                  const needsRestart = isLinux && currentIcon !== initialIcon;
                  return (
                    <>
                      <div className="settings-icon-picker">
                        {ICON_VARIANTS.map(v => (
                          <button
                            key={v.id}
                            className={`settings-icon-option${currentIcon === v.id ? ' settings-icon-option--active' : ''}`}
                            onClick={async () => {
                              const ok = await window.electronAPI?.setAppIcon?.(v.id);
                              if (ok) setCurrentIcon(v.id);
                            }}
                          >
                            <div className="settings-icon-preview">{v.svg}</div>
                            <span className="settings-icon-label">{t(v.labelKey)}</span>
                          </button>
                        ))}
                      </div>
                      {needsRestart && (
                        <button
                          className="settings-restart-btn"
                          onClick={() => window.electronAPI?.relaunch?.()}
                        >
                          {t('settings.restartToApply')}
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
              <div className="settings-section">
                <div className="settings-section-title">{t('settings.updates')}</div>
                {(() => {
                  const [updateStatus, setUpdateStatus] = useState<import('../../types/electron').UpdateStatus | null>(null);
                  const [appVersion, setAppVersion] = useState<string>('');

                  useEffect(() => {
                    window.electronAPI?.getAppInfo?.().then(info => setAppVersion(info.version));
                    return window.electronAPI?.onUpdateStatus?.(setUpdateStatus);
                  }, []);

                  const statusText = (() => {
                    if (!updateStatus) return null;
                    switch (updateStatus.status) {
                      case 'checking': return t('settings.updateChecking');
                      case 'not-available': return t('settings.updateUpToDate');
                      case 'available': return t('settings.updateFound', { version: updateStatus.version });
                      case 'downloading': return t('settings.updateDownloading', { percent: updateStatus.percent ?? 0 });
                      case 'ready': return t('settings.updateReady', { version: updateStatus.version });
                      case 'error': return t('settings.updateError');
                      default: return null;
                    }
                  })();

                  const isChecking = updateStatus?.status === 'checking';
                  const isDownloading = updateStatus?.status === 'downloading';

                  return (
                    <>
                      <div className="settings-row">
                        <div>
                          <div className="settings-row-label">{t('settings.checkUpdates')}</div>
                          <div className="settings-row-desc">
                            {appVersion && t('settings.currentVersion', { version: appVersion })}
                            {!appVersion && t('settings.checkUpdatesHint')}
                          </div>
                        </div>
                        <button
                          className="btn"
                          disabled={isChecking || isDownloading}
                          onClick={async () => {
                            setUpdateStatus({ status: 'checking' });
                            try { await window.electronAPI?.checkForUpdate?.(); } catch { /* ignore */ }
                          }}
                        >
                          {isChecking ? '...' : t('settings.check')}
                        </button>
                      </div>
                      {statusText && (
                        <div className={`settings-update-status settings-update-status--${updateStatus!.status}`}>
                          {statusText}
                          {updateStatus!.status === 'ready' && (
                            <button
                              className="btn btn--small"
                              onClick={() => window.electronAPI?.installUpdate()}
                            >
                              {t('update.restart')}
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </>)}

          {/* -- About -- */}
          <div className="settings-about">
            <span className="settings-about-name">Lala</span>
            <span className="settings-about-sep">&middot;</span>
            <a href="https://github.com/eeegoloauq/lala" target="_blank" rel="noopener noreferrer" className="settings-about-link">
              {t('settings.sourceCode')}
            </a>
            <span className="settings-about-sep">&middot;</span>
            {(() => {
              const [copied, setCopied] = useState(false);
              return (
                <button
                  className="settings-about-link settings-about-btn"
                  onClick={() => {
                    navigator.clipboard.writeText('bc1qrs4mqlc5kv697te3wkxc36sjpqcm8phlajk39t');
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? t('settings.copied') : t('settings.donate')}
                </button>
              );
            })()}
          </div>

          </div>
        </div>
      </div>
    </div>
  );
}
