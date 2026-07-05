import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { supportsBackgroundProcessors } from '@livekit/track-processors';
import type { AppSettings, CameraEffect } from '../types';
import { Select } from '../../../ui/Select';
import type { SelectOption } from '../../../ui/Select';

interface VideoSectionProps {
  headerRef: (el: HTMLElement | null) => void;
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export function VideoSection({ headerRef, settings, onUpdate }: VideoSectionProps) {
  const { t } = useTranslation();

  const RESOLUTION_OPTIONS: SelectOption[] = useMemo(() => [
    { value: 'h1080', label: t('settings.res1080') },
    { value: 'h720', label: t('settings.res720') },
    { value: 'vga', label: t('settings.res480') },
  ], [t]);

  const CAMERA_EFFECT_OPTIONS: SelectOption[] = useMemo(() => [
    { value: 'none', label: t('settings.cameraEffectNone') },
    { value: 'blur', label: t('settings.cameraEffectBlur') },
  ], [t]);

  // Computed once per mount — checks WebCodecs/MediaStreamTrackProcessor support,
  // not something that changes at runtime, so no need for state/effect.
  const cameraEffectSupported = useMemo(() => {
    try {
      return supportsBackgroundProcessors();
    } catch {
      return false;
    }
  }, []);

  return (
    <>
      <h2 className="settings-header" ref={headerRef}>{t('settings.video')}</h2>
      <div className="settings-section">
        <div className="settings-section-title">{t('settings.camera')}</div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.resolution')}</div>
            <div className="settings-row-desc">{t('settings.maxResolution')}</div>
          </div>
          <Select value={settings.videoResolution || 'h720'} onChange={(v) => onUpdate({ videoResolution: v })} options={RESOLUTION_OPTIONS} className="lala-select-wide" />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.cameraEffect')}</div>
            <div className="settings-row-desc">
              {cameraEffectSupported ? t('settings.cameraEffectHint') : t('settings.cameraEffectUnsupported')}
            </div>
          </div>
          <Select
            value={cameraEffectSupported ? (settings.cameraEffect || 'none') : 'none'}
            onChange={(v) => onUpdate({ cameraEffect: v as CameraEffect })}
            options={CAMERA_EFFECT_OPTIONS}
            className="lala-select-wide"
            disabled={!cameraEffectSupported}
          />
        </div>
      </div>
    </>
  );
}
