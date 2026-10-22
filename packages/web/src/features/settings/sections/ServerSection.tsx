import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getServerBans, unbanFromServer } from '../../../lib/api';
import { ApiError, type ServerBan } from '../../../lib/types';

interface ServerSectionProps {
  headerRef: (el: HTMLElement | null) => void;
}

/** Server admins: people banned from the whole server. */
export function ServerSection({ headerRef }: ServerSectionProps) {
  const { t, i18n } = useTranslation();
  const [bans, setBans] = useState<ServerBan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const errorText = useCallback(
    (err: unknown) => t('room.errorCode', { code: err instanceof ApiError ? err.code : 'server_error' }),
    [t],
  );

  useEffect(() => {
    getServerBans().then(setBans, (err) => setError(errorText(err)));
  }, [errorText]);

  const unban = (identity: string) => {
    setError(null);
    unbanFromServer(identity).then(
      () => setBans(prev => prev?.filter(b => b.identity !== identity) ?? prev),
      (err) => setError(errorText(err)),
    );
  };

  const time = (ms: number) => new Date(ms).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <h2 className="settings-header" ref={headerRef}>{t('settings.server')}</h2>
      <div className="settings-section">
        <div className="settings-section-title">{t('settings.serverBans')}</div>
        <p className="settings-row-desc" style={{ marginBottom: '16px' }}>{t('settings.serverBansHint')}</p>
        {error && <p className="settings-row-desc" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        {bans?.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t('roomAdmin.noBans')}</p>}
        {bans?.map(ban => (
          <div className="settings-row" key={ban.identity}>
            <div>
              <div className="settings-row-label">{ban.name}</div>
              <div className="settings-row-desc">
                {ban.ipBannedUntil ? t('settings.ipBannedUntil', { time: time(ban.ipBannedUntil) }) : ban.identity}
              </div>
            </div>
            <button className="accent-reset-btn" onClick={() => unban(ban.identity)}>{t('roomAdmin.unban')}</button>
          </div>
        ))}
      </div>
    </>
  );
}
