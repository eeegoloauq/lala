import { useTranslation } from 'react-i18next';
import type { AppSettings } from '../types';
import { Select } from '../../../ui/Select';
import { SCREEN_SHARE_FPS_STEPS, SCREEN_SHARE_BITRATE_STEPS, screenShareBitrateLabel } from '../../../lib/constants';

interface ScreenShareSectionProps {
  headerRef: (el: HTMLElement | null) => void;
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export function ScreenShareSection({ headerRef, settings, onUpdate }: ScreenShareSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <h2 className="settings-header" ref={headerRef}>{t('settings.screenShare')}</h2>
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
    </>
  );
}
