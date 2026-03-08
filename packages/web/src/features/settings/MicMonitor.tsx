import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface MicMonitorProps {
  active: boolean;
  deviceId?: string;
  onChange: (v: boolean) => void;
}

export function MicMonitor({ active, deviceId, onChange }: MicMonitorProps) {
  const { t } = useTranslation();
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!active) {
      streamRef.current?.getTracks().forEach(t => t.stop());
      ctxRef.current?.close();
      streamRef.current = null;
      ctxRef.current = null;
      return;
    }

    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
          video: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        src.connect(ctx.destination);

        streamRef.current = stream;
        ctxRef.current = ctx;
      } catch {
        if (!cancelled) onChange(false);
      }
    };

    start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      ctxRef.current?.close();
      streamRef.current = null;
      ctxRef.current = null;
    };
  }, [active, deviceId]);

  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{t('mic.micMonitor')}</div>
        <div className="settings-row-desc">{t('mic.micMonitorHint')}</div>
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          className="toggle-input"
          checked={active}
          onChange={e => onChange(e.target.checked)}
        />
        <span className="toggle-slider" />
      </label>
    </div>
  );
}
