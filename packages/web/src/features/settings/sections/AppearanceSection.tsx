import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings } from '../types';
import { useTheme } from '../ThemeProvider';
import { THEME_LABELS, THEMES } from '../../../themes';
import type { ThemeChoice } from '../ThemeProvider';
import { Select } from '../../../ui/Select';
import type { SelectOption } from '../../../ui/Select';
import { LANGUAGES, languageName } from '../../../lib/i18n';

const LANGUAGE_OPTIONS: SelectOption[] = LANGUAGES.map(code => ({ value: code, label: languageName(code) }));

interface AppearanceSectionProps {
  headerRef: (el: HTMLElement | null) => void;
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export function AppearanceSection({ headerRef, settings, onUpdate }: AppearanceSectionProps) {
  const { t, i18n } = useTranslation();
  const { theme, choice, setChoice, serverTheme, userCss, setUserCss } = useTheme();

  // The server's theme comes first when it has one, and is what follows when nothing is picked.
  const themeOptions: SelectOption[] = useMemo(() => [
    ...(serverTheme ? [{ value: 'server', label: t('settings.themeServer', { name: t(THEME_LABELS[serverTheme.base]) }) }] : []),
    ...THEMES.map(id => ({ value: id, label: t(THEME_LABELS[id]) })),
  ], [t, serverTheme]);
  const followsServer = choice === null || choice === 'server';
  const selected = followsServer ? (serverTheme ? 'server' : theme) : choice;

  return (
    <>
      <h2 className="settings-header" ref={headerRef}>{t('settings.appearance')}</h2>
      <div className="settings-section">
        <div className="settings-section-title">{t('settings.theme')}</div>
        <div className="settings-row">
          <div><div className="settings-row-label">{t('settings.theme')}</div></div>
          <Select label={t('settings.theme')} value={selected} onChange={(v) => setChoice(v as ThemeChoice)} options={themeOptions} className="lala-select-wide" />
        </div>
        <div className="settings-row">
          <div><div className="settings-row-label">{t('settings.language')}</div></div>
          <Select label={t('settings.language')} value={i18n.resolvedLanguage ?? 'en'} onChange={(v) => i18n.changeLanguage(v)} options={LANGUAGE_OPTIONS} className="lala-select-wide" />
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
            <input type="checkbox" className="toggle-input" checked={settings.simulcast} onChange={(e) => onUpdate({ simulcast: e.target.checked })} />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t('settings.colors')}</div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.accentColor')}</div>
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

      <div className="settings-section">
        <div className="settings-section-title">{t('settings.userCss')}</div>
        <div className="settings-row settings-row-stacked">
          <div>
            <label className="settings-row-label" htmlFor="user-css">{t('settings.userCssLabel')}</label>
            <div className="settings-row-desc">{t('settings.userCssHint')}</div>
          </div>
          <textarea
            id="user-css"
            className="input settings-css-input"
            value={userCss}
            onChange={(e) => setUserCss(e.target.value)}
            spellCheck={false}
            placeholder=".p-tile { border-radius: 4px; }"
            rows={6}
          />
        </div>
      </div>
    </>
  );
}
