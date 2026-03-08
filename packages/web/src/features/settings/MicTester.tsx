import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface MicTesterProps {
  deviceId?: string;
  monitoring: boolean;
  onMonitoringChange: (v: boolean) => void;
  silenceGate: number;
  onSilenceGateChange: (v: number) => void;
}

export function MicTester({ deviceId, monitoring, onMonitoringChange, silenceGate, onSilenceGateChange }: MicTesterProps) {
  const { t } = useTranslation();
  const [level, setLevel] = useState(0);
  const [error, setError] = useState(false);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
          video: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        streamRef.current = stream;
        const ctx = new AudioContext();
        ctxRef.current = ctx;

        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.4;

        const gain = ctx.createGain();
        gain.gain.value = 0;
        gainRef.current = gain;

        src.connect(analyser);
        src.connect(gain);
        gain.connect(ctx.destination);

        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          // dBFS: -60dB (silence) → 0, 0dB (max) → 1
          const db = 20 * Math.log10(Math.max(rms, 1e-9));
          setLevel(Math.max(0, Math.min(1, (db + 60) / 60)));
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
      gainRef.current = null;
    };
  }, [deviceId]);

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = monitoring ? 1 : 0;
  }, [monitoring]);

  if (error) return <div className="mic-meter-error">{t('settings.noMicAccess')}</div>;

  // silenceGate is in dBFS (e.g. -40), level is 0..1 (dBFS mapped 0..1)
  // Gate position on bar: map -50..-10 dB range → 0..100%
  const DB_MIN = -50;
  const DB_MAX = -10;
  const gatePercent = silenceGate !== 0
    ? Math.max(0, Math.min(100, (silenceGate - DB_MIN) / (DB_MAX - DB_MIN) * 100))
    : 0;
  const levelPercent = Math.round(level * 100);
  const levelDb = level > 0 ? (level * 60 - 60) : -Infinity;
  const gated = silenceGate !== 0 && levelDb < silenceGate;

  return (
    <div className="mic-tester">
      {/* Level bar + gate overlay */}
      <div className="mic-tester-bar-row">
        <span className="mic-meter-label">{t('settings.inputLevel')}</span>
        <div className="mic-tester-track-wrap">
          <div className="mic-tester-track">
            {/* Gate region (left = will be silenced) */}
            {silenceGate > 0 && (
              <div
                className="mic-tester-gate-region"
                style={{ width: `${gatePercent}%` }}
              />
            )}
            {/* Live level fill */}
            <div
              className={`mic-tester-level${gated && silenceGate > 0 ? ' gated' : ''}`}
              style={{ width: `${levelPercent}%` }}
            />
            {/* Gate threshold line */}
            {silenceGate > 0 && (
              <div
                className="mic-tester-gate-line"
                style={{ left: `${gatePercent}%` }}
              />
            )}
          </div>
          {/* Silence gate slider overlaid */}
          <input
            type="range"
            min={DB_MIN}
            max={DB_MAX}
            step={1}
            value={silenceGate !== 0 ? silenceGate : DB_MIN}
            onChange={(e) => {
              const v = Number(e.target.value);
              onSilenceGateChange(v === DB_MIN ? 0 : v);
            }}
            className="mic-tester-gate-slider"
            title={silenceGate !== 0 ? t('mic.silenceGate', { value: silenceGate }) : t('mic.silenceGateOff')}
          />
        </div>
        {silenceGate !== 0 && (
          <span className="mic-tester-gate-val">{silenceGate} dB</span>
        )}
      </div>

      {/* Monitor button */}
      <button
        className={`mic-monitor-btn${monitoring ? ' active' : ''}`}
        onClick={() => onMonitoringChange(!monitoring)}
        title={monitoring ? t('mic.stopMonitoring') : t('mic.listenToMic')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
        </svg>
        {monitoring ? t('settings.stop') : t('settings.monitor')}
      </button>
    </div>
  );
}
