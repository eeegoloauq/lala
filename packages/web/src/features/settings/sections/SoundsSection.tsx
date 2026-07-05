import { useTranslation } from 'react-i18next';
import type { AppSettings } from '../types';

const SOUND_KEYS = ['soundJoinLeave', 'soundChat', 'soundScreenShare', 'soundMicFeedback', 'soundTalkingWhileMuted'] as const;

interface SoundsSectionProps {
  headerRef: (el: HTMLElement | null) => void;
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export function SoundsSection({ headerRef, settings, onUpdate }: SoundsSectionProps) {
  const { t } = useTranslation();
  const allOn = SOUND_KEYS.every(k => settings[k] ?? true);

  const SOUND_ROWS = [
    { key: 'soundJoinLeave',        label: t('settings.joinLeave'),       desc: t('settings.joinLeaveHint') },
    { key: 'soundChat',              label: t('settings.newMessage'),      desc: t('settings.newMessageHint') },
    { key: 'soundScreenShare',       label: t('settings.screenShareChime'), desc: t('settings.screenShareChimeHint') },
    { key: 'soundMicFeedback',       label: t('settings.muteClick'),       desc: t('settings.muteClickHint') },
    { key: 'soundTalkingWhileMuted', label: t('settings.talkingMuted'),    desc: t('settings.talkingMutedHint') },
  ] as const;

  return (
    <>
      <h2 className="settings-header" ref={headerRef}>{t('settings.sounds')}</h2>
      <div className="settings-section">
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
        {SOUND_ROWS.map(({ key, label, desc }) => (
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
      </div>
    </>
  );
}
