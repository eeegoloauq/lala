import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPassPool, removeFromPool, clearAllPasswords } from '../../../lib/passwords';

interface SecuritySectionProps {
  headerRef: (el: HTMLElement | null) => void;
}

export function SecuritySection({ headerRef }: SecuritySectionProps) {
  const { t } = useTranslation();
  const [savedPasswords, setSavedPasswords] = useState<string[]>(getPassPool);

  const removePassword = (idx: number) => {
    setSavedPasswords(removeFromPool(idx));
  };

  const clearPasswords = () => {
    setSavedPasswords([]);
    clearAllPasswords();
  };

  return (
    <>
      <h2 className="settings-header" ref={headerRef}>{t('settings.security')}</h2>
      <div className="settings-section">
        <div className="settings-section-title">{t('settings.savedPasswords')}</div>
        <p className="settings-row-desc" style={{ marginBottom: '16px' }}>{t('settings.savedPasswordsHint')}</p>
        {savedPasswords.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('settings.noPasswords')}</p>
        ) : (<>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
            {savedPasswords.map((pw, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '120px', fontFamily: 'monospace', fontSize: '13px', letterSpacing: '0.15em', color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {'•'.repeat(Math.min(pw.length, 12))}
                </span>
                <button className="accent-reset-btn" onClick={() => removePassword(i)}>{t('settings.remove')}</button>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={clearPasswords}>{t('settings.clearAll')}</button>
        </>)}
      </div>
    </>
  );
}
