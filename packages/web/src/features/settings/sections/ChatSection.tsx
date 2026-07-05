import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings } from '../types';
import { Select } from '../../../ui/Select';
import { getVoices, ttsSupported } from '../../../lib/tts';

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

interface ChatSectionProps {
  headerRef: (el: HTMLElement | null) => void;
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

export function ChatSection({ headerRef, settings, onUpdate }: ChatSectionProps) {
  const { t } = useTranslation();
  const ttsVoices = useTtsVoices();

  return (
    <>
      <h2 className="settings-header" ref={headerRef}>{t('settings.chat')}</h2>
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
    </>
  );
}
