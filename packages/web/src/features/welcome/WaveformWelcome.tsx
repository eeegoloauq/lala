import './waveform-welcome.css';

const BARS = Array.from({ length: 32 });

export function WaveformWelcome() {
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
    </div>
  );
}
