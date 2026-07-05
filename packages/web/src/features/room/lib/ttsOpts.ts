import type { AppSettings } from '../../settings/types';
import type { TtsOptions } from '../../../lib/tts';

/** Builds `speak()` options from the relevant TTS fields of AppSettings. */
export function ttsOptsFromSettings(settings: AppSettings): TtsOptions {
    return {
        volume: settings.ttsVolume,
        voice: settings.ttsVoice,
        maxLength: settings.ttsMaxLength,
    };
}
