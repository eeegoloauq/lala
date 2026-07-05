import { useMemo, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, AudioQualityPreset, NoiseSuppressionMode } from '../types';
import { Select } from '../../../ui/Select';
import type { SelectOption } from '../../../ui/Select';

interface AudioSectionProps {
  headerRef: (el: HTMLElement | null) => void;
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  keybindCleanupRef: MutableRefObject<(() => void) | null>;
}

export function AudioSection({ headerRef, settings, onUpdate, keybindCleanupRef }: AudioSectionProps) {
  const { t } = useTranslation();

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

  return (
    <>
      <h2 className="settings-header" ref={headerRef}>{t('settings.audio')}</h2>

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
    </>
  );
}
