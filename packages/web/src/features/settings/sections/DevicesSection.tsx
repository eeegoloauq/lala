import { useEffect, useMemo, useState } from 'react';
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
    const fetchDevices = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        stream.getTracks().forEach(t => t.stop());
        const dev = await navigator.mediaDevices.enumerateDevices();
        setDevices(dev);
      } catch (err) {
        console.warn('Could not list devices', err);
      }
    };
    fetchDevices();
    navigator.mediaDevices.addEventListener('devicechange', fetchDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', fetchDevices);
  }, []);

  const DEFAULT_DEVICE: SelectOption = useMemo(() => ({ value: '', label: t('settings.defaultDevice') }), [t]);

  const audioInputOptions = useMemo<SelectOption[]>(() => [
    DEFAULT_DEVICE,
    ...devices.filter(d => d.kind === 'audioinput').map(d => ({
      value: d.deviceId,
      label: d.label || 'Unknown Microphone',
    })),
  ], [devices, DEFAULT_DEVICE]);

  const audioOutputOptions = useMemo<SelectOption[]>(() => [
    DEFAULT_DEVICE,
    ...devices.filter(d => d.kind === 'audiooutput').map(d => ({
      value: d.deviceId,
      label: d.label || 'Unknown Speaker',
    })),
  ], [devices, DEFAULT_DEVICE]);

  const videoInputOptions = useMemo<SelectOption[]>(() => [
    DEFAULT_DEVICE,
    ...devices.filter(d => d.kind === 'videoinput').map(d => ({
      value: d.deviceId,
      label: d.label || 'Unknown Camera',
    })),
  ], [devices, DEFAULT_DEVICE]);

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
