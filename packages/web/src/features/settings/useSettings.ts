import { useState } from 'react';
import { STORAGE_KEYS } from '../../lib/constants';
import { safeJsonParse } from '../../lib/utils';
import { DEFAULT_SETTINGS } from './types';
import type { AppSettings } from './types';

// Bump when adding a migration. Stored as `_v` inside the settings JSON.
// v2: force echoCancellation/autoGainControl on for everyone — old defaults
//     were OFF and caused mobile speakerphone echo for other listeners.
const SETTINGS_VERSION = 2;

type StoredSettings = Partial<AppSettings> & { _v?: number };

function migrate(parsed: StoredSettings): Partial<AppSettings> {
  const { _v, ...rest } = parsed;
  let next: Partial<AppSettings> = rest;
  if ((_v ?? 1) < 2) {
    next = { ...next, echoCancellation: true, autoGainControl: true };
  }
  return next;
}

function loadSettings(): AppSettings {
  const parsed = safeJsonParse<StoredSettings>(localStorage.getItem(STORAGE_KEYS.settings), {});
  const migrated = migrate(parsed);
  const merged = { ...DEFAULT_SETTINGS, ...migrated };
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
