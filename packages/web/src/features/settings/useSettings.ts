import { useState } from 'react';
import { STORAGE_KEYS } from '../../lib/constants';
import { safeJsonParse } from '../../lib/utils';
import { DEFAULT_SETTINGS, AUDIO_QUALITY_PRESETS, NOISE_SUPPRESSION_MODES } from './types';
import type { AppSettings } from './types';

// Bump when adding a migration. Stored as `_v` inside the settings JSON.
// v2: force echoCancellation/autoGainControl on for everyone — old defaults
//     were OFF and caused mobile speakerphone echo for other listeners.
// v3: keybinds moved from bare letter values ('M', 'V', ...) to
//     KeyboardEvent.code format ('KeyM', 'KeyV', ...) to match useRoomKeyboard's
//     `e.code` comparison — old stored binds would otherwise silently never fire.
const SETTINGS_VERSION = 3;

type StoredSettings = Partial<AppSettings> & { _v?: number };

const KEYBIND_FIELDS = ['keyMic', 'keyCam', 'keyDeafen', 'keyChat', 'keyFullscreen', 'keyScreenShare'] as const;

/** Pre-v3 keybinds stored a bare uppercase letter or digit ('M', '5').
 *  Convert to the KeyboardEvent.code format the keyboard hook expects.
 *  Anything already in code form (e.g. 'KeyM', 'Space') passes through. */
function migrateKeybindValue(value: string): string {
  if (/^[A-Z]$/.test(value)) return `Key${value}`;
  if (/^[0-9]$/.test(value)) return `Digit${value}`;
  return value;
}

function migrate(parsed: StoredSettings): Partial<AppSettings> {
  const { _v, ...rest } = parsed;
  let next: Partial<AppSettings> = rest;
  const version = _v ?? 1;
  if (version < 2) {
    next = { ...next, echoCancellation: true, autoGainControl: true };
  }
  if (version < 3) {
    for (const field of KEYBIND_FIELDS) {
      const value = next[field];
      if (typeof value === 'string') {
        next = { ...next, [field]: migrateKeybindValue(value) };
      }
    }
  }
  return next;
}

const ACCENT_COLOR_RE = /^#[0-9a-f]{6}$/i;
// Optional free-form device-id strings — no entry in DEFAULT_SETTINGS to
// typeof-check against, so they get an explicit string check instead.
const OPTIONAL_STRING_FIELDS = new Set<keyof AppSettings>([
  'audioInputDeviceId', 'audioOutputDeviceId', 'videoInputDeviceId',
]);

/**
 * Drop any stored field that doesn't match the expected shape so a corrupted
 * or hand-edited `lala-settings` entry can't crash the app — DEFAULT_SETTINGS
 * wins for anything invalid instead.
 */
function sanitize(partial: Partial<AppSettings>): Partial<AppSettings> {
  const clean: Partial<AppSettings> = {};
  for (const key of Object.keys(partial) as (keyof AppSettings)[]) {
    const value = partial[key];
    if (value === undefined) continue;

    if (key === 'accentColor') {
      if (typeof value === 'string' && ACCENT_COLOR_RE.test(value)) clean.accentColor = value;
      continue;
    }
    if (key === 'audioQuality') {
      if (typeof value === 'string' && (AUDIO_QUALITY_PRESETS as readonly string[]).includes(value)) {
        clean.audioQuality = value as AppSettings['audioQuality'];
      }
      continue;
    }
    if (key === 'noiseSuppressionMode') {
      if (typeof value === 'string' && (NOISE_SUPPRESSION_MODES as readonly string[]).includes(value)) {
        clean.noiseSuppressionMode = value as AppSettings['noiseSuppressionMode'];
      }
      continue;
    }
    if (OPTIONAL_STRING_FIELDS.has(key)) {
      if (typeof value === 'string') (clean as Record<string, unknown>)[key] = value;
      continue;
    }

    const defaultValue = DEFAULT_SETTINGS[key];
    if (defaultValue !== undefined && typeof value === typeof defaultValue) {
      (clean as Record<string, unknown>)[key] = value;
    }
    // else: wrong typeof for a field with a known default — drop it, default wins
  }
  return clean;
}

function loadSettings(): AppSettings {
  const parsedRaw = safeJsonParse<unknown>(localStorage.getItem(STORAGE_KEYS.settings), {});
  // Guard against corrupted storage: literal "null", arrays, or any non-object
  // JSON value would otherwise blow up the `{ _v, ...rest }` destructure below.
  const parsed: StoredSettings =
    parsedRaw !== null && typeof parsedRaw === 'object' && !Array.isArray(parsedRaw)
      ? (parsedRaw as StoredSettings)
      : {};
  const migrated = migrate(parsed);
  const sanitized = sanitize(migrated);
  const merged = { ...DEFAULT_SETTINGS, ...sanitized };
  if (parsed._v !== SETTINGS_VERSION) {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ ...merged, _v: SETTINGS_VERSION }));
  }
  return merged;
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  const updateSettings = (patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ ...next, _v: SETTINGS_VERSION }));
      return next;
    });
  };

  return { settings, updateSettings };
}
