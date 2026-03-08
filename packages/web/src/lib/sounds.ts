/** Minimal Web Audio tone generator — zero dependencies */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
    if (!ctx) ctx = new AudioContext();
    return ctx;
}

function playTone(startHz: number, endHz: number, durationSec: number, gain = 0.12) {
    try {
        const ac = getCtx();
        const osc = ac.createOscillator();
        const g = ac.createGain();

        osc.connect(g);
        g.connect(ac.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(startHz, ac.currentTime);
        osc.frequency.exponentialRampToValueAtTime(endHz, ac.currentTime + durationSec);

        g.gain.setValueAtTime(0, ac.currentTime);
        g.gain.linearRampToValueAtTime(gain, ac.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + durationSec);

        osc.start(ac.currentTime);
        osc.stop(ac.currentTime + durationSec);
    } catch {
        // AudioContext blocked or unavailable — silently ignore
    }
}

/** Soft ascending tone — someone joined */
export function playJoinSound() {
    playTone(480, 720, 0.28);
}

/** Soft descending tone — someone left */
export function playLeaveSound() {
    playTone(720, 360, 0.32);
}

/** Subtle blip — new chat message received */
export function playChatSound() {
    playTone(880, 1100, 0.12, 0.07);
}

/** Brief descending blip — local mic muted */
export function playMuteSound() {
    playTone(500, 280, 0.12, 0.08);
}

/** Brief ascending blip — local mic unmuted */
export function playUnmuteSound() {
    playTone(280, 500, 0.12, 0.08);
}

/** Two flat beeps — speaking into muted mic (Mumble-style warning) */
export function playTalkingWhileMutedSound() {
    playTone(900, 900, 0.07, 0.20);
    setTimeout(() => playTone(900, 900, 0.07, 0.20), 130);
}

/** Two-step ascending sweep — remote participant started screen share */
export function playScreenShareStartSound() {
    playTone(440, 550, 0.2, 0.09);
    setTimeout(() => playTone(550, 770, 0.22, 0.08), 160);
}

/** Two-step descending sweep — remote participant stopped screen share */
export function playScreenShareStopSound() {
    playTone(660, 500, 0.2, 0.08);
    setTimeout(() => playTone(500, 370, 0.22, 0.07), 150);
}
