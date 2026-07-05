import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import type { AppSettings } from '../types';
import { useTheme, type Theme } from '../ThemeProvider';
import { Select } from '../../../ui/Select';
import type { SelectOption } from '../../../ui/Select';

const LANGUAGE_OPTIONS: SelectOption[] = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
];

interface AppearanceSectionProps {
  headerRef: (el: HTMLElement | null) => void;
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export function AppearanceSection({ headerRef, settings, onUpdate }: AppearanceSectionProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  const THEME_OPTIONS: SelectOption[] = useMemo(() => [
    { value: 'dark', label: t('settings.themeDark') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'amoled', label: t('settings.themeAmoled') },
    { value: 'discord', label: t('settings.themeDiscord') },
    { value: 'retro', label: t('settings.themeRetro') },
    { value: 'winxp', label: t('settings.themeWinXP') },
  ], [t]);

  return (
    <>
      <h2 className="settings-header" ref={headerRef}>{t('settings.appearance')}</h2>
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
    </>
  );
}
