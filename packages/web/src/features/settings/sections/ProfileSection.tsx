import { useTranslation } from 'react-i18next';
import { compressAvatar } from '../../../lib/avatarUtils';

interface ProfileSectionProps {
  headerRef: (el: HTMLElement | null) => void;
  displayName?: string;
  onRename?: (name: string) => void;
  myAvatar?: string | null;
  onAvatarChange?: (dataUrl: string | null) => void;
}

export function ProfileSection({ headerRef, displayName, onRename, myAvatar, onAvatarChange }: ProfileSectionProps) {
  const { t } = useTranslation();

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressAvatar(file);
      onAvatarChange?.(dataUrl);
    } catch (err) {
      console.warn('Avatar compression failed', err);
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
            maxLength={20}
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
          </div>
          <div className="avatar-upload-controls">
            {myAvatar ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <img
                  src={myAvatar}
                  alt="Avatar preview"
                  style={{ width: 40, height: 40, borderRadius: 'var(--avatar-radius, 50%)', objectFit: 'cover', border: '1px solid var(--border-color)' }}
                />
                <button className="accent-reset-btn" onClick={() => onAvatarChange?.(null)}>
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
      </div>
    </>
  );
}
