import { useTranslation } from 'react-i18next';
import { keyLabel, useKeyCapture } from '../useKeyCapture';
import { DEFAULT_SETTINGS, type AppSettings } from '../types';

interface KeybindsSectionProps {
  headerRef: (el: HTMLElement | null) => void;
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export function KeybindsSection({ headerRef, settings, onUpdate }: KeybindsSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <h2 className="settings-header" ref={headerRef}>{t('settings.keybinds')}</h2>
      <div className="settings-section">
        <div className="settings-row" style={{ marginBottom: 8 }}>
          <div>
            <div className="settings-row-label">{t('settings.enableShortcuts')}</div>
            <div className="settings-row-desc">{t('settings.shortcutsHint')}</div>
          </div>
          <label className="toggle">
            <input type="checkbox" className="toggle-input"
              checked={settings.shortcutsEnabled}
              onChange={(e) => onUpdate({ shortcutsEnabled: e.target.checked })}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <KeybindsTable settings={settings} onUpdate={onUpdate} />
        <p className="keybinds-note">{t('settings.keybindsNote')}</p>
      </div>
    </>
  );
}

interface KeybindsTableProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

function KeybindsTable({ settings, onUpdate }: KeybindsTableProps) {
  const { t } = useTranslation();
  const BINDS = [
    { key: 'keyMic',         label: t('settings.keyMic') },
    { key: 'keyCam',         label: t('settings.keyCam') },
    { key: 'keyDeafen',      label: t('settings.keyDeafen') },
    { key: 'keyChat',        label: t('settings.keyChat') },
    { key: 'keyFullscreen',  label: t('settings.keyFullscreen') },
    { key: 'keyScreenShare', label: t('settings.keyScreenShare') },
  ] as const;

  const { listening, listen } = useKeyCapture<typeof BINDS[number]['key']>((key, code) => onUpdate({ [key]: code }));

  return (
    <table className="keybinds-table">
      <tbody>
        {BINDS.map(({ key, label: desc }) => (
          <tr key={key} className="keybinds-row">
            <td>
              <button
                className={`btn ptt-keybind-btn${listening === key ? ' ptt-keybind-btn--listening' : ''}`}
                onClick={() => listen(key)}
              >
                {listening === key ? '...' : keyLabel(settings[key])}
              </button>
            </td>
            <td className="keybinds-desc">{desc}</td>
            <td>
              <button
                className="btn"
                style={{ fontSize: 11, padding: '2px 7px', opacity: 0.5 }}
                onClick={() => onUpdate({ [key]: DEFAULT_SETTINGS[key] })}
                title={t('settings.resetDefaults')}
              >↩</button>
            </td>
          </tr>
        ))}
        {settings.pushToTalk && (
          <tr className="keybinds-row">
            <td><kbd className="keybinds-key">{keyLabel(settings.pushToTalkKey)}</kbd></td>
            <td className="keybinds-desc">{t('settings.keyPTT')}</td>
            <td />
          </tr>
        )}
        <tr className="keybinds-row">
          <td><kbd className="keybinds-key">Esc</kbd></td>
          <td className="keybinds-desc">{t('settings.keyEsc')}</td>
          <td />
        </tr>
      </tbody>
    </table>
  );
}
