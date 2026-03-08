import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface MicLevelMeterProps {
  deviceId?: string;
}

export function MicLevelMeter({ deviceId }: MicLevelMeterProps) {
  const { t } = useTranslation();
  const [level, setLevel] = useState(0);
  const [error, setError] = useState(false);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      try {
        const constraints: MediaStreamConstraints = {
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
          video: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;

        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.5;
        ctx.createMediaStreamSource(stream).connect(analyser);

        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          // rms typically 0–0.5 when speaking, scale to 0–1
          setLevel(Math.min(1, rms * 4));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) setError(true);
      }
    };

    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      ctxRef.current?.close();
      streamRef.current = null;
      ctxRef.current = null;
    };
  }, [deviceId]);

  if (error) {
    return <div className="mic-meter-error">{t('mic.noAccess')}</div>;
  }

  return (
    <div className="mic-meter">
      <span className="mic-meter-label">{t('mic.inputLevel')}</span>
      <div className="mic-meter-track">
        <div
          className="mic-meter-fill"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
    </div>
  );
}
