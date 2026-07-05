import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UpdateStatus } from '../../../types/electron';
import { ICON_VARIANTS } from '../../../lib/iconVariants';

interface DesktopSectionProps {
  headerRef: (el: HTMLElement | null) => void;
}

export function DesktopSection({ headerRef }: DesktopSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      <h2 className="settings-header" ref={headerRef}>{t('settings.desktop')}</h2>
      <div className="settings-section">
        <div className="settings-section-title">{t('settings.server')}</div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{window.location.host}</div>
            <div className="settings-row-desc">{t('settings.connectedTo')}</div>
          </div>
          <button className="accent-reset-btn" style={{ color: 'var(--color-danger, #e74c3c)', fontSize: '13px' }} onClick={() => window.electronAPI?.navigateBack()}>
            {t('settings.disconnect')}
          </button>
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-title">{t('settings.startup')}</div>
        <AutoLaunchToggle />
      </div>
      <div className="settings-section">
        <div className="settings-section-title">{t('settings.appIcon')}</div>
        <div className="settings-row-desc" style={{ marginBottom: 12 }}>{t('settings.appIconHint')}</div>
        <AppIconPicker />
      </div>
      <div className="settings-section">
        <div className="settings-section-title">{t('settings.updates')}</div>
        <UpdateSection />
      </div>
    </>
  );
}

function AutoLaunchToggle() {
  const { t } = useTranslation();
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null);

  useEffect(() => {
    window.electronAPI?.getAutoLaunch?.().then(setAutoLaunch);
  }, []);

  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{t('settings.launchOnStartup')}</div>
        <div className="settings-row-desc">{t('settings.launchOnStartupHint')}</div>
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          className="toggle-input"
          checked={autoLaunch ?? false}
          disabled={autoLaunch === null}
          onChange={async (e) => {
            const enabled = e.target.checked;
            await window.electronAPI?.setAutoLaunch?.(enabled);
            setAutoLaunch(enabled);
          }}
        />
        <span className="toggle-slider" />
      </label>
    </div>
  );
}

function AppIconPicker() {
  const { t } = useTranslation();
  const [currentIcon, setCurrentIcon] = useState<string>('voice-wave');

  useEffect(() => {
    window.electronAPI?.getAppIcon?.().then(setCurrentIcon);
  }, []);

  return (
    <div className="settings-icon-picker">
      {ICON_VARIANTS.map(v => (
        <button
          key={v.id}
          className={`settings-icon-option${currentIcon === v.id ? ' settings-icon-option--active' : ''}`}
          onClick={async () => {
            const ok = await window.electronAPI?.setAppIcon?.(v.id);
            if (ok) setCurrentIcon(v.id);
          }}
        >
          <div className="settings-icon-preview">{v.svg}</div>
          <span className="settings-icon-label">{t(v.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}

function UpdateSection() {
  const { t } = useTranslation();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    window.electronAPI?.getAppInfo?.().then(info => setAppVersion(info.version));
    return window.electronAPI?.onUpdateStatus?.(setUpdateStatus);
  }, []);

  const statusText = (() => {
    if (!updateStatus) return null;
    switch (updateStatus.status) {
      case 'checking': return t('settings.updateChecking');
      case 'not-available': return t('settings.updateUpToDate');
      case 'available': return t('settings.updateFound', { version: updateStatus.version });
      case 'downloading': return t('settings.updateDownloading', { percent: updateStatus.percent ?? 0 });
      case 'installing': return t('settings.updateInstalling');
      case 'ready': return t('settings.updateReady', { version: updateStatus.version });
      case 'package-manager': return t('settings.updatePackageManager');
      case 'error': return updateStatus.error
        ? `${t('settings.updateError')}\n${updateStatus.error}`
        : t('settings.updateError');
      default: return null;
    }
  })();

  const isChecking = updateStatus?.status === 'checking';
  const isDownloading = updateStatus?.status === 'downloading';
  const isInstalling = updateStatus?.status === 'installing';

  return (
    <>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{t('settings.checkUpdates')}</div>
          <div className="settings-row-desc">
            {appVersion && t('settings.currentVersion', { version: appVersion })}
            {!appVersion && t('settings.checkUpdatesHint')}
          </div>
        </div>
        <button
          className="btn"
          disabled={isChecking || isDownloading || isInstalling}
          onClick={async () => {
            setUpdateStatus({ status: 'checking' });
            try { await window.electronAPI?.checkForUpdate?.(); } catch { /* ignore */ }
          }}
        >
          {isChecking ? '...' : t('settings.check')}
        </button>
      </div>
      {statusText && (
        <div className={`settings-update-status settings-update-status--${updateStatus!.status}`} style={{ whiteSpace: 'pre-wrap' }}>
          {statusText}
          {updateStatus!.status === 'ready' && (
            <button
              className="btn btn--small"
              onClick={() => window.electronAPI?.installUpdate()}
            >
              {t('update.restart')}
            </button>
          )}
        </div>
      )}
    </>
  );
}
