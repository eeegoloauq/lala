export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

export interface TtsOptions {
    volume?: number;   // 0–100
    voice?: string;    // voice name, '' = default
    maxLength?: number;
}

export function speak(text: string, opts: TtsOptions = {}) {
    if (!ttsSupported) return;
    const { volume = 50, voice = '', maxLength = 200 } = opts;
    const trimmed = maxLength > 0 && text.length > maxLength
        ? text.slice(0, maxLength) + '…'
        : text;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(trimmed);
    u.volume = volume / 100;
    u.rate = 1.1;
    if (voice) {
        const found = window.speechSynthesis.getVoices().find(v => v.name === voice);
        if (found) u.voice = found;
    }
    window.speechSynthesis.speak(u);
}

export function getVoices(): SpeechSynthesisVoice[] {
    if (!ttsSupported) return [];
    return window.speechSynthesis.getVoices();
}
