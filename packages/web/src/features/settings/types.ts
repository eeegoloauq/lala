export type AudioQualityPreset = 'speech' | 'music' | 'musicHighQuality' | 'musicHighQualityStereo';
export type NoiseSuppressionMode = 'disabled' | 'browser' | 'rnnoise';

export interface AppSettings {
  audioQuality: AudioQualityPreset;
  autoGainControl: boolean;
  echoCancellation: boolean;
  noiseSuppressionMode: NoiseSuppressionMode;
  silenceGate: number; // 0 = off, otherwise dBFS threshold e.g. -40 to -10
  audioInputDeviceId?: string;
  audioOutputDeviceId?: string;
  videoInputDeviceId?: string;
  pushToTalk: boolean;
  pushToTalkKey: string;
  videoResolution: string;
  screenShareFpsIdx: number;
  screenShareBrIdx: number;
  screenShareSkipDialog: boolean;
  screenShareAudio: boolean;
  accentColor?: string;
  chatTTS: boolean;
  ttsVolume: number;       // 0–100, default 50
  ttsReadOwn: boolean;     // read own messages aloud
  ttsMaxLength: number;    // truncate message at this char count
  ttsVoice: string;        // SpeechSynthesis voice name, '' = default
  ambientMode: boolean;    // Ambient glow behind video (default on)
  simulcast: boolean;      // Encode multiple quality layers (off = saves CPU/upload for small rooms)
  soundJoinLeave: boolean;
  soundChat: boolean;
  soundScreenShare: boolean;
  soundMicFeedback: boolean;
  soundTalkingWhileMuted: boolean;
  shortcutsEnabled: boolean;
  keyMic: string;
  keyCam: string;
  keyDeafen: string;
  keyChat: string;
  keyFullscreen: string;
  keyScreenShare: string;
  language: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  audioQuality: 'musicHighQuality',
  autoGainControl: false,
  echoCancellation: false,
  pushToTalk: false,
  pushToTalkKey: 'Space',
  videoResolution: 'h720',
  screenShareFpsIdx: 0,     // 30fps
  screenShareBrIdx: 2,      // 5 Mbps (1080p)
  screenShareSkipDialog: false,
  screenShareAudio: true,
  noiseSuppressionMode: 'browser',
  silenceGate: 0,
  chatTTS: true,
  ttsVolume: 15,
  ttsReadOwn: false,
  ttsMaxLength: 200,
  ttsVoice: '',
  ambientMode: true,
  simulcast: true,
  soundJoinLeave: true,
  soundChat: true,
  soundScreenShare: true,
  soundMicFeedback: true,
  soundTalkingWhileMuted: true,
  shortcutsEnabled: true,
  keyMic: 'KeyM',
  keyCam: 'KeyV',
  keyDeafen: 'KeyD',
  keyChat: 'KeyC',
  keyFullscreen: 'KeyF',
  keyScreenShare: 'KeyS',
  language: 'en',
};
