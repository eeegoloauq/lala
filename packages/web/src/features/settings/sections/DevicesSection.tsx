import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings } from '../types';
import { Select } from '../../../ui/Select';
import type { SelectOption } from '../../../ui/Select';
import { MicTester } from '../MicTester';

interface DevicesSectionProps {
  headerRef: (el: HTMLElement | null) => void;
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  micMonitor: boolean;
  setMicMonitor: (v: boolean) => void;
}

export function DevicesSection({ headerRef, settings, onUpdate, micMonitor, setMicMonitor }: DevicesSectionProps) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    const show = (list: MediaDeviceInfo[]) => { if (!cancelled) setDevices(list); };
    const list = async () => {
      let found = await navigator.mediaDevices.enumerateDevices();
      // Browsers hide device names until a capture is allowed. The microphone is expected
      // here; the camera is not asked for, so cameras keep plain numbered names until used.
      if (found.some(d => d.kind === 'audioinput' && !d.label)) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        stream?.getTracks().forEach(track => track.stop());
        if (stream) found = await navigator.mediaDevices.enumerateDevices();
      }
      show(found);
    };
    list().catch(err => console.warn('[DevicesSection] Listing devices failed:', err));
    const onChange = () => { navigator.mediaDevices.enumerateDevices().then(show, () => {}); };
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', onChange);
    };
  }, []);

  const optionsFor = useCallback((kind: MediaDeviceKind, unnamed: string): SelectOption[] => [
    { value: '', label: t('settings.defaultDevice') },
    ...devices.filter(d => d.kind === kind).map((d, i) => ({ value: d.deviceId, label: d.label || t(unnamed, { n: i + 1 }) })),
  ], [devices, t]);
  const audioInputOptions = useMemo(() => optionsFor('audioinput', 'settings.microphoneN'), [optionsFor]);
  const audioOutputOptions = useMemo(() => optionsFor('audiooutput', 'settings.speakerN'), [optionsFor]);
  const videoInputOptions = useMemo(() => optionsFor('videoinput', 'settings.cameraN'), [optionsFor]);

  return (
    <>
      <h2 className="settings-header" ref={headerRef}>{t('settings.devices')}</h2>
      <div className="settings-section">
        <div className="settings-row-col">
          <div className="settings-row-label">{t('settings.microphone')}</div>
          <Select value={settings.audioInputDeviceId || ''} onChange={(v) => onUpdate({ audioInputDeviceId: v })} options={audioInputOptions} />
          <MicTester
            deviceId={settings.audioInputDeviceId || undefined}
            monitoring={micMonitor}
            onMonitoringChange={setMicMonitor}
            silenceGate={settings.silenceGate}
            onSilenceGateChange={(v) => onUpdate({ silenceGate: v })}
          />
        </div>
        <div className="settings-row-col">
          <div className="settings-row-label">{t('settings.speaker')}</div>
          <Select value={settings.audioOutputDeviceId || ''} onChange={(v) => onUpdate({ audioOutputDeviceId: v })} options={audioOutputOptions} />
        </div>
        <div className="settings-row-col">
          <div className="settings-row-label">{t('settings.camera')}</div>
          <Select value={settings.videoInputDeviceId || ''} onChange={(v) => onUpdate({ videoInputDeviceId: v })} options={videoInputOptions} />
        </div>
      </div>
    </>
  );
}
