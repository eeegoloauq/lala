import { useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings } from '../types';

interface KeybindsSectionProps {
  headerRef: (el: HTMLElement | null) => void;
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  keybindCleanupRef: MutableRefObject<(() => void) | null>;
}

export function KeybindsSection({ headerRef, settings, onUpdate, keybindCleanupRef }: KeybindsSectionProps) {
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
              checked={settings.shortcutsEnabled ?? true}
              onChange={(e) => onUpdate({ shortcutsEnabled: e.target.checked })}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <KeybindsTable settings={settings} onUpdate={onUpdate} keybindCleanupRef={keybindCleanupRef} />
        <p className="keybinds-note">{t('settings.keybindsNote')}</p>
      </div>
    </>
  );
}

const RESET_DEFAULTS: Record<string, string> = {
  keyMic: 'KeyM', keyCam: 'KeyV', keyDeafen: 'KeyD', keyChat: 'KeyC', keyFullscreen: 'KeyF', keyScreenShare: 'KeyS',
};

interface KeybindsTableProps {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  keybindCleanupRef: MutableRefObject<(() => void) | null>;
}

function KeybindsTable({ settings, onUpdate, keybindCleanupRef }: KeybindsTableProps) {
  const { t } = useTranslation();
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
                onClick={() => onUpdate({ [key]: RESET_DEFAULTS[key] })}
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
}
