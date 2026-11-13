import { useTranslation } from 'react-i18next';
import { compressAvatar } from '../../../lib/avatarUtils';
import { useMeContext } from '../../../lib/meContext';
import { MAX_NAME_LENGTH } from '../../../lib/constants';
import { useTimedValue } from '../../../hooks/useTimedValue';
import { IS_ELECTRON } from '../../../lib/env';
import type { AppSettings } from '../types';

/** As the server keeps it (packages/api/src/lib/profile.ts). */
const ABOUT_MAX = 190;

interface ProfileSectionProps {
  headerRef: (el: HTMLElement | null) => void;
  displayName?: string;
  onRename?: (name: string) => void;
  myAvatar?: string | null;
  onAvatarChange?: (dataUrl: string | null) => Promise<void>;
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{label}</div>
        {desc && <div className="settings-row-desc">{desc}</div>}
      </div>
      <label className="toggle">
        <input type="checkbox" className="toggle-input" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
        <span className="toggle-slider" />
      </label>
    </div>
  );
}

export function ProfileSection({ headerRef, displayName, onRename, myAvatar, onAvatarChange, settings, onUpdate }: ProfileSectionProps) {
  const { t } = useTranslation();
  const identity = useMeContext()?.identity;
  const [copied, showCopied] = useTimedValue<true>(1500);
  const [avatarFailed, showAvatarFailed] = useTimedValue<true>(6000);
  const changeAvatar = (dataUrl: string | null) => {
    onAvatarChange?.(dataUrl).catch((err) => {
      console.warn('[ProfileSection] Changing the avatar failed:', err);
      showAvatarFailed(true);
    });
  };

  const copyIdentity = () => {
    if (!identity) return;
    navigator.clipboard.writeText(identity).then(() => {
      showCopied(true);
    }, (err) => console.warn('[ProfileSection] Copying the ID failed:', err));
  };

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressAvatar(file);
      changeAvatar(dataUrl);
    } catch (err) {
      console.warn('Avatar compression failed', err);
      showAvatarFailed(true);
    }
    e.target.value = '';
  };

  return (
    <>
      <h2 className="settings-header" ref={headerRef}>{t('settings.profile')}</h2>
      <div className="settings-section">
        <div className="settings-row">
          <div className="settings-row-label">{t('settings.displayName')}</div>
          <input
            className="input"
            defaultValue={displayName ?? ''}
            maxLength={MAX_NAME_LENGTH}
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
            {avatarFailed && <div className="settings-row-desc" role="alert" style={{ color: 'var(--color-danger)' }}>{t('settings.avatarFailed')}</div>}
          </div>
          <div className="avatar-upload-controls">
            {myAvatar ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <img
                  src={myAvatar}
                  alt={t('settings.avatar')}
                  style={{ width: 40, height: 40, borderRadius: 'var(--avatar-radius, 50%)', objectFit: 'cover', border: '1px solid var(--border-color)' }}
                />
                <button className="accent-reset-btn" onClick={() => changeAvatar(null)}>
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
        <div className="settings-row settings-row-stacked">
          <div>
            <label className="settings-row-label" htmlFor="profile-about">{t('settings.aboutMe')}</label>
            <div className="settings-row-desc">{t('settings.aboutMeHint')}</div>
          </div>
          <textarea
            id="profile-about"
            className="input settings-about-input"
            defaultValue={settings.profileAbout}
            maxLength={ABOUT_MAX}
            rows={3}
            onBlur={(e) => {
              const about = e.target.value.trim();
              if (about !== settings.profileAbout) onUpdate({ profileAbout: about });
            }}
          />
        </div>
        <Toggle
          label={t('settings.shareLocalTime')}
          checked={settings.shareLocalTime}
          onChange={(on) => onUpdate({ shareLocalTime: on })}
        />
        {IS_ELECTRON && window.electronAPI?.watchActivity && (<>
          <Toggle
            label={t('settings.shareActivity')}
            checked={settings.shareActivity === 'on'}
            onChange={(on) => onUpdate({ shareActivity: on ? 'on' : 'off' })}
          />
          {settings.shareActivity === 'on' && (
            <Toggle
              label={t('settings.shareBrowserMedia')}
              checked={settings.shareBrowserMedia}
              onChange={(on) => onUpdate({ shareBrowserMedia: on })}
            />
          )}
        </>)}
        {identity && (
          // Only an admin setting up the server config needs it.
          <details className="settings-advanced">
            <summary>{t('settings.advanced')}</summary>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">{t('settings.yourId')}</div>
                <div className="settings-row-desc">{t('settings.yourIdHint')}</div>
                <code className="settings-identity">{identity}</code>
              </div>
              <button className="accent-reset-btn" onClick={copyIdentity}>
                {copied ? t('settings.copied') : t('settings.copy')}
              </button>
            </div>
          </details>
        )}
      </div>
    </>
  );
}
