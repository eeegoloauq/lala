import { useTranslation } from 'react-i18next';
import './waveform-welcome.css';

const BARS = Array.from({ length: 32 });

export function WaveformWelcome() {
  const { t } = useTranslation();
  return (
    <div className="waveform-welcome">
      <div className="waveform-bars">
        {BARS.map((_, i) => (
          <div
            key={i}
            className="waveform-bar"
            style={{ '--i': i } as React.CSSProperties}
          />
        ))}
      </div>
      <p className="waveform-welcome-hint">{t('welcome.lobbyHint')}</p>
    </div>
  );
}
