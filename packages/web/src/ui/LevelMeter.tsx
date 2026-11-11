import './level-meter.css';

/** Three moving bars: a bot playing audio, where a person would get the speaking ring. */
export function LevelMeter() {
    return <span className="level-meter" aria-hidden="true"><i /><i /><i /></span>;
}
