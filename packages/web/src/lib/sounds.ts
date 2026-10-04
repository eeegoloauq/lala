/** Ambient system sounds synthesized with Web Audio — zero dependencies */

let ctx: AudioContext | null = null;
let reverbIn: GainNode;
let noise: AudioBuffer;

function getCtx(): AudioContext {
    if (ctx) return ctx;
    ctx = new AudioContext();

    // Synthetic room: decaying stereo noise impulse, lowpassed so tails stay soft.
    const len = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = 4200;
    reverbIn = ctx.createGain();
    reverbIn.connect(conv);
    conv.connect(dark);
    dark.connect(ctx.destination);

    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const n = noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
    return ctx;
}

function play(build: (ac: AudioContext) => void) {
    try {
        const ac = getCtx();
        if (ac.state === 'running') return build(ac);
        // On gesture-less page load the context starts 'suspended' and
        // currentTime is frozen at 0 — anything scheduled now would queue up
        // and all fire at once the moment the context resumes (first click).
        // Inside a click (the settings preview) resuming first is safe.
        const resumed = ac.resume();
        if (navigator.userActivation?.isActive) resumed.then(() => build(ac)).catch(() => {});
        else resumed.catch(() => {});
    } catch {
        // AudioContext blocked or unavailable — silently ignore
    }
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function route(ac: AudioContext, node: AudioNode, rev: number) {
    const dry = ac.createGain();
    dry.gain.value = 1 - rev * 0.5;
    const wet = ac.createGain();
    wet.gain.value = rev;
    node.connect(dry).connect(ac.destination);
    node.connect(wet).connect(reverbIn);
}

interface Tone {
    f: number;
    at?: number;
    dur: number;
    gain: number;
    attack: number;
    rev: number;
    type?: OscillatorType;
    /** [frequency ratio, amplitude, decay as a fraction of dur] */
    partials?: [number, number, number?][];
    glide?: number;
    glideTime?: number;
    lp?: number;
    lpEnd?: number;
}

function tone(ac: AudioContext, o: Tone) {
    const t0 = ac.currentTime + 0.02 + (o.at ?? 0);
    const env = ac.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(o.gain, t0 + o.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    let out: AudioNode = env;
    if (o.lp) {
        const fl = ac.createBiquadFilter();
        fl.type = 'lowpass';
        fl.Q.value = 0.7;
        fl.frequency.setValueAtTime(o.lp, t0);
        if (o.lpEnd) fl.frequency.exponentialRampToValueAtTime(o.lpEnd, t0 + o.dur * 0.8);
        out = env.connect(fl);
    }
    route(ac, out, o.rev);
    for (const [ratio, amp, decay = 1] of o.partials ?? [[1, 1]]) {
        const osc = ac.createOscillator();
        osc.type = o.type ?? 'sine';
        osc.frequency.setValueAtTime(o.f * ratio, t0);
        if (o.glide) osc.frequency.exponentialRampToValueAtTime(o.glide * ratio, t0 + (o.glideTime ?? 0.06));
        const pg = ac.createGain();
        pg.gain.setValueAtTime(amp, t0);
        pg.gain.exponentialRampToValueAtTime(amp * 0.0001, t0 + o.dur * decay);
        osc.connect(pg).connect(env);
        osc.start(t0);
        osc.stop(t0 + o.dur + 0.05);
    }
}

/** Filtered-noise breath: a bandpass sweeping from → to */
function puff(ac: AudioContext, { dur, gain, from, to, attack, rev }:
    { dur: number; gain: number; from: number; to: number; attack: number; rev: number }) {
    const t0 = ac.currentTime + 0.02;
    const src = ac.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(from, t0);
    bp.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const env = ac.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    route(ac, src.connect(bp).connect(env), rev);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
}

/** Lowpassed kalimba note with a slow-ish attack, no click or metallic overtone */
const softKalimba = (ac: AudioContext, n: number, at: number, gain: number) => tone(ac, {
    f: midi(n), at, dur: 1.5, gain, attack: 0.015, lp: 2600, rev: 0.55,
    partials: [[1, 1], [2, 0.05, 0.3]],
});

/** Water drop: a short sine gliding between two pitches */
const drop = (ac: AudioContext, from: number, to: number) => tone(ac, {
    f: from, glide: to, dur: 0.2, gain: 0.12, attack: 0.002, rev: 0.35,
});

/** Detuned-saw pad swelling through a moving lowpass */
const pad = (ac: AudioContext, notes: number[], lp: number, lpEnd: number) => notes.forEach(n => tone(ac, {
    f: midi(n), dur: 1.3, gain: 0.07, attack: 0.39, type: 'sawtooth', lp, lpEnd, rev: 0.7,
    partials: [[1, 1], [1.006, 0.8]],
}));

/** Two kalimba notes rising — someone joined */
export function playJoinSound() {
    play(ac => { softKalimba(ac, 74, 0, 0.14); softKalimba(ac, 81, 0.14, 0.13); });
}

/** Two kalimba notes falling — someone left */
export function playLeaveSound() {
    play(ac => { softKalimba(ac, 81, 0, 0.13); softKalimba(ac, 74, 0.16, 0.14); });
}

/** High airy note — new chat message received */
export function playChatSound() {
    play(ac => {
        tone(ac, { f: midi(78), dur: 1.0, gain: 0.09, attack: 0.02, rev: 0.8 });
        puff(ac, { dur: 0.25, gain: 0.06, from: 3000, to: 5000, attack: 0.03, rev: 0.5 });
    });
}

/** Falling drop — local mic muted */
export function playMuteSound() {
    play(ac => drop(ac, 700, 420));
}

/** Rising drop — local mic unmuted */
export function playUnmuteSound() {
    play(ac => drop(ac, 420, 700));
}

/** Two soft pulses — speaking into muted mic */
export function playTalkingWhileMutedSound() {
    play(ac => [0, 0.2].forEach(at =>
        tone(ac, { f: midi(69), at, dur: 0.25, gain: 0.5, attack: 0.03, rev: 0.25 })));
}

/** Opening pad and rising breath — remote participant started screen share */
export function playScreenShareStartSound() {
    play(ac => {
        pad(ac, [74, 81], 500, 3000);
        puff(ac, { dur: 1.0, gain: 0.17, from: 600, to: 4500, attack: 0.4, rev: 0.7 });
    });
}

/** Closing pad and falling breath — remote participant stopped screen share */
export function playScreenShareStopSound() {
    play(ac => {
        pad(ac, [74, 69], 3000, 400);
        puff(ac, { dur: 1.0, gain: 0.17, from: 4500, to: 500, attack: 0.3, rev: 0.7 });
    });
}
